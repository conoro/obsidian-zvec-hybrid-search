/*
 * Serialized and executed in a worker. Keep this function self-contained.
 */
export function embeddingWorkerEntrypoint(): void {
  const workerThreads = require('node:worker_threads') as {
    parentPort: {
      on(event: 'message', listener: (message: WorkerRequest) => void): void;
      postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
    } | null;
    workerData: WorkerData | null;
  };
  const { createRequire } = require('node:module') as typeof import('node:module');
  const { join } = require('node:path') as typeof import('node:path');

  interface WorkerRequest {
    id: number;
    method: string;
    args: { texts?: string[] };
  }
  interface WorkerData {
    runtimeDirectory: string;
    cacheDir: string;
    backend: 'minilm' | 'hash';
    model: string;
    dtype: 'q4' | 'fp16' | 'fp32';
    dimension: number;
  }

  const childData = process.env.OBSIDIAN_ZVEC_CHILD_DATA;
  const workerData = childData
    ? JSON.parse(childData) as WorkerData
    : workerThreads.workerData as WorkerData;
  const parentPort = childData
    ? {
      on(_event: 'message', listener: (message: WorkerRequest) => void): void {
        process.on('message', listener);
      },
      postMessage(message: unknown): void {
        if (process.send) process.send(message);
      },
    }
    : workerThreads.parentPort;
  if (!parentPort) throw new Error('No isolated runtime IPC channel is available.');
  const ipc = parentPort;

  type Extractor = (
    input: string[],
    options: { pooling: 'mean'; normalize: true },
  ) => Promise<{ data: Float32Array; dims: number[] }>;

  let extractor: Extractor | null = null;
  let loading: Promise<Extractor> | null = null;
  let queue = Promise.resolve();

  function addFeature(
    vector: Float32Array,
    feature: string,
    weight: number,
  ): void {
    let hash = 2166136261;
    for (let index = 0; index < feature.length; index += 1) {
      hash ^= feature.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const position = Math.abs(hash) % vector.length;
    const sign = (hash & 1) === 0 ? 1 : -1;
    vector[position] = (vector[position] ?? 0) + sign * weight;
  }

  function hashEmbedding(text: string): Float32Array {
    const vector = new Float32Array(workerData.dimension);
    const normalized = text.toLowerCase().normalize('NFKD');
    const words = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? [];
    for (const word of words) {
      addFeature(vector, `w:${word}`, 1.5);
      const padded = `^${word}$`;
      for (let size = 3; size <= 5; size += 1) {
        for (let index = 0; index <= padded.length - size; index += 1) {
          addFeature(vector, `c:${padded.slice(index, index + size)}`, 0.35);
        }
      }
    }
    let norm = 0;
    for (const value of vector) norm += value * value;
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let index = 0; index < vector.length; index += 1) {
        vector[index] = (vector[index] ?? 0) / norm;
      }
    }
    return vector;
  }

  async function getExtractor(): Promise<Extractor> {
    if (extractor) return extractor;
    if (loading) return loading;
    loading = (async () => {
      ipc.postMessage({
        kind: 'progress',
        value: {
          phase: 'downloading-model',
          message: 'Loading the isolated local semantic model…',
        },
      });
      const pluginRequire = createRequire(
        join(workerData.runtimeDirectory, 'main.js'),
      );
      const transformers = pluginRequire(
        '@huggingface/transformers',
      ) as typeof import('@huggingface/transformers');
      transformers.env.cacheDir = workerData.cacheDir;
      transformers.env.allowRemoteModels = true;
      transformers.env.allowLocalModels = true;
      const pipeline = await transformers.pipeline(
        'feature-extraction',
        workerData.model,
        {
          dtype: workerData.dtype,
          progress_callback: (event: unknown) => {
            const progress = event as {
              status?: string;
              file?: string;
              progress?: number;
            };
            if (progress.status !== 'progress') return;
            const percent = Number.isFinite(progress.progress)
              ? ` ${Math.round(progress.progress ?? 0)}%`
              : '';
            ipc.postMessage({
              kind: 'progress',
              value: {
                phase: 'downloading-model',
                message: `Downloading ${progress.file ?? 'model'}${percent}`,
              },
            });
          },
        },
      );
      extractor = pipeline as unknown as Extractor;
      return extractor;
    })();
    try {
      return await loading;
    } catch (error) {
      loading = null;
      throw error;
    }
  }

  async function embed(texts: string[]): Promise<Float32Array[]> {
    if (workerData.backend === 'hash') {
      return texts.map((text) => hashEmbedding(text));
    }
    const model = await getExtractor();
    const output = await model(texts, { pooling: 'mean', normalize: true });
    const dimension = output.dims.at(-1) ?? workerData.dimension;
    const vectors: Float32Array[] = [];
    for (let index = 0; index < texts.length; index += 1) {
      const start = index * dimension;
      vectors.push(output.data.slice(start, start + dimension));
    }
    return vectors;
  }

  function errorPayload(error: unknown): { message: string; stack?: string } {
    return {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
  }

  ipc.on('message', (request) => {
    queue = queue.then(async () => {
      try {
        if (request.method === 'embed') {
          const vectors = await embed(request.args.texts ?? []);
          ipc.postMessage(
            { id: request.id, ok: true, result: vectors },
            vectors.map((vector) => vector.buffer as ArrayBuffer),
          );
          return;
        }
        if (request.method === 'dispose') {
          const disposable = extractor as {
            dispose?: () => Promise<void>;
          } | null;
          if (disposable?.dispose) await disposable.dispose();
          extractor = null;
          loading = null;
          ipc.postMessage({ id: request.id, ok: true, result: null });
          return;
        }
        throw new Error(`Unknown embedding worker method: ${request.method}`);
      } catch (error) {
        ipc.postMessage({
          id: request.id,
          ok: false,
          error: errorPayload(error),
        });
      }
    });
  });
}

export function createEmbeddingWorkerSource(): string {
  return `const __name = (target) => target;\n(${embeddingWorkerEntrypoint.toString()})();`;
}
