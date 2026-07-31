/*
 * This function is serialized with Function#toString and executed inside a
 * Node worker. Keep it self-contained: it cannot reference module scope.
 */
export function zvecWorkerEntrypoint(): void {
  const workerThreads = require('node:worker_threads') as {
    parentPort: {
      on(event: 'message', listener: (message: WorkerRequest) => void): void;
      postMessage(message: unknown): void;
    } | null;
    workerData: WorkerData | null;
  };
  const {
    existsSync,
    mkdirSync,
  } = require('node:fs') as typeof import('node:fs');
  const { createRequire } = require('node:module') as typeof import('node:module');
  const { dirname, join } = require('node:path') as typeof import('node:path');

  interface WorkerRequest {
    id: number;
    method: string;
    args: Record<string, unknown>;
  }
  interface WorkerData {
    collectionPath: string;
    runtimeDirectory: string;
    embeddingDimension: number;
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

  let collection: import('@zvec/zvec').ZVecCollection | null = null;
  let api: typeof import('@zvec/zvec') | null = null;
  let queue = Promise.resolve();
  if (childData) {
    process.once('disconnect', () => {
      try {
        collection?.closeSync();
      } finally {
        process.exit(0);
      }
    });
  }

  function getApi(): typeof import('@zvec/zvec') {
    if (api) return api;
    const pluginRequire = createRequire(join(workerData.runtimeDirectory, 'main.js'));
    api = pluginRequire('@zvec/zvec') as typeof import('@zvec/zvec');
    return api;
  }

  function requireCollection(): import('@zvec/zvec').ZVecCollection {
    if (!collection) throw new Error('The ZVec collection is not open.');
    return collection;
  }

  function createSchema(
    zvec: typeof import('@zvec/zvec'),
  ): import('@zvec/zvec').ZVecCollectionSchema {
    const invert = { indexType: zvec.ZVecIndexType.INVERT } as const;
    const fts = {
      indexType: zvec.ZVecIndexType.FTS,
      tokenizerName: 'standard',
      filters: ['lowercase', 'ascii_folding', 'stemmer'],
      extraParams: JSON.stringify({ stemmer_lang: 'english' }),
    };
    return new zvec.ZVecCollectionSchema({
      name: 'obsidian_passages_v1',
      fields: [
        { name: 'path', dataType: zvec.ZVecDataType.STRING, indexParams: invert },
        { name: 'title', dataType: zvec.ZVecDataType.STRING },
        { name: 'heading', dataType: zvec.ZVecDataType.STRING },
        { name: 'content', dataType: zvec.ZVecDataType.STRING },
        { name: 'searchText', dataType: zvec.ZVecDataType.STRING, indexParams: fts },
        { name: 'titleText', dataType: zvec.ZVecDataType.STRING, indexParams: fts },
        { name: 'preview', dataType: zvec.ZVecDataType.STRING },
        { name: 'tags', dataType: zvec.ZVecDataType.ARRAY_STRING },
        { name: 'folder', dataType: zvec.ZVecDataType.STRING, indexParams: invert },
        { name: 'startLine', dataType: zvec.ZVecDataType.INT32 },
        { name: 'chunkIndex', dataType: zvec.ZVecDataType.INT32 },
        { name: 'mtime', dataType: zvec.ZVecDataType.INT64 },
        { name: 'ctime', dataType: zvec.ZVecDataType.INT64 },
      ],
      vectors: [{
        name: 'embedding',
        dataType: zvec.ZVecDataType.VECTOR_FP32,
        dimension: workerData.embeddingDimension,
        indexParams: {
          indexType: zvec.ZVecIndexType.HNSW,
          metricType: zvec.ZVecMetricType.COSINE,
          m: 32,
          efConstruction: 200,
        },
      }],
    });
  }

  function stats(): {
    docCount: number;
    indexCompleteness: Record<string, number>;
  } {
    return requireCollection().stats;
  }

  async function handle(
    method: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === 'open') {
      if (!collection) {
        const zvec = getApi();
        mkdirSync(dirname(workerData.collectionPath), { recursive: true });
        const existingCollection = existsSync(workerData.collectionPath);
        try {
          collection = zvec.ZVecOpen(workerData.collectionPath);
        } catch (error) {
          if (existingCollection) {
            const message = error instanceof Error
              ? error.message
              : String(error);
            throw new Error(
              `The existing ZVec collection could not be opened and was left untouched: ${message}`,
            );
          }
          collection = zvec.ZVecCreateAndOpen(
            workerData.collectionPath,
            createSchema(zvec),
          );
        }
      }
      return { stats: stats() };
    }
    if (method === 'recreate') {
      const zvec = getApi();
      if (collection) {
        try {
          collection.destroySync();
        } finally {
          collection = null;
        }
      }
      mkdirSync(dirname(workerData.collectionPath), { recursive: true });
      collection = zvec.ZVecCreateAndOpen(
        workerData.collectionPath,
        createSchema(zvec),
      );
      return { stats: stats() };
    }
    if (method === 'upsert') {
      const statuses = requireCollection().upsertSync(
        args.docs as import('@zvec/zvec').ZVecDocInput[],
      );
      const failed = statuses.find((status) => !status.ok);
      if (failed) {
        throw new Error(`upsert failed (${failed.code}): ${failed.message}`);
      }
      return { stats: stats() };
    }
    if (method === 'deleteByFilter') {
      const status = await requireCollection().deleteByFilter(
        String(args.filter),
      );
      if (!status.ok) {
        throw new Error(`delete failed (${status.code}): ${status.message}`);
      }
      return { stats: stats() };
    }
    if (method === 'optimize') {
      await requireCollection().optimize();
      return { stats: stats() };
    }
    if (method === 'keywordQuery') {
      const zvec = getApi();
      const matchMode = String(args.matchMode);
      const query = String(args.query);
      const docs = await requireCollection().query({
        fieldName: String(args.fieldName),
        fts: matchMode === 'phrase'
          ? { queryString: String(args.phraseQuery) }
          : { matchString: query },
        topk: Number(args.topk),
        includeVector: false,
        outputFields: args.outputFields as string[],
        params: {
          indexType: zvec.ZVecIndexType.FTS,
          defaultOperator: matchMode === 'any' ? 'OR' : 'AND',
        },
      });
      return { value: docs, stats: stats() };
    }
    if (method === 'semanticQuery') {
      const zvec = getApi();
      const docs = await requireCollection().query({
        fieldName: 'embedding',
        vector: Array.from(args.vector as Float32Array),
        topk: Number(args.topk),
        includeVector: false,
        outputFields: args.outputFields as string[],
        params: {
          indexType: zvec.ZVecIndexType.HNSW,
          ef: Math.max(100, Number(args.topk)),
        },
      });
      return { value: docs, stats: stats() };
    }
    if (method === 'close') {
      collection?.closeSync();
      collection = null;
      return {};
    }
    throw new Error(`Unknown worker method: ${method}`);
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
        const result = await handle(request.method, request.args);
        ipc.postMessage({ id: request.id, ok: true, result });
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

export function createZVecWorkerSource(): string {
  // esbuild/tsx may annotate nested function names with this helper. Defining
  // it inside the eval worker keeps Function#toString output self-contained.
  return `const __name = (target) => target;\n(${zvecWorkerEntrypoint.toString()})();`;
}
