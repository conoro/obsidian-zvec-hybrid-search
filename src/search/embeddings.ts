import { WorkerRpcClient } from '../runtime/worker-rpc';
import {
  errorMessage,
  PluginRuntimeError,
} from '../runtime/safety';
import {
  EMBEDDING_DIMENSION,
  type EmbeddingBackend,
  type IndexStatus,
} from '../types';
import { createEmbeddingWorkerSource } from './embedding-worker';

type ProgressCallback = (status: Partial<IndexStatus>) => void;
const MODEL_LOAD_TIMEOUT_MS = 10 * 60_000;
const EMBED_TIMEOUT_MS = 120_000;
const RETRY_COOLDOWN_MS = 15_000;
const DEFAULT_IDLE_SHUTDOWN_MS = 10 * 60_000;

export class LocalEmbeddingService {
  private client: WorkerRpcClient | null = null;
  private loadedOnce = false;
  private disposed = false;
  private retryAfter = 0;
  private activeRequests = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly cacheDir: string,
    private readonly backend: EmbeddingBackend,
    private readonly model: string,
    private readonly dtype: 'q4' | 'fp16' | 'fp32',
    private readonly onProgress: ProgressCallback,
    private readonly runtimeDirectory = process.cwd(),
    private readonly idleShutdownMs = DEFAULT_IDLE_SHUTDOWN_MS,
    private readonly nodeExecutable?: string,
  ) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    if (this.disposed) {
      throw new PluginRuntimeError(
        'PLUGIN_STOPPED',
        'The local embedding worker has been stopped.',
      );
    }
    if (Date.now() < this.retryAfter) {
      throw new PluginRuntimeError(
        'RUNTIME_UNAVAILABLE',
        'The embedding worker is cooling down after a failure. Retry shortly.',
        { retryable: true },
      );
    }
    this.clearIdleTimer();
    const client = this.getClient();
    this.activeRequests += 1;
    try {
      const vectors = await client.request<Float32Array[]>(
        'embed',
        { texts },
        this.loadedOnce ? EMBED_TIMEOUT_MS : MODEL_LOAD_TIMEOUT_MS,
      );
      this.loadedOnce = true;
      this.retryAfter = 0;
      return vectors;
    } catch (error) {
      const wasActiveClient = this.client === client;
      if (wasActiveClient) this.client = null;
      this.loadedOnce = false;
      this.retryAfter = wasActiveClient
        ? Date.now() + RETRY_COOLDOWN_MS
        : 0;
      await client.stop();
      throw new PluginRuntimeError(
        'RUNTIME_UNAVAILABLE',
        `Local embedding failed in its isolated worker. ${errorMessage(error)}`,
        { cause: error, retryable: true },
      );
    } finally {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
      if (
        !this.disposed
        && this.activeRequests === 0
        && this.client === client
      ) {
        this.scheduleIdleShutdown(client);
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.clearIdleTimer();
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      await client.request('dispose', {}, 2000);
    } catch (error) {
      console.warn('ZVec embedding worker did not dispose cleanly', error);
    } finally {
      await client.stop();
    }
  }

  async cancelActive(): Promise<void> {
    if (this.disposed) return;
    this.clearIdleTimer();
    const client = this.client;
    this.client = null;
    this.loadedOnce = false;
    this.retryAfter = 0;
    if (client) await client.stop();
  }

  private getClient(): WorkerRpcClient {
    if (this.client) return this.client;
    const client = new WorkerRpcClient(
      createEmbeddingWorkerSource(),
      {
        runtimeDirectory: this.runtimeDirectory,
        cacheDir: this.cacheDir,
        backend: this.backend,
        model: this.model,
        dtype: this.dtype,
        dimension: EMBEDDING_DIMENSION,
      },
      (error) => {
        if (this.client === client) this.client = null;
        this.loadedOnce = false;
        this.clearIdleTimer();
        this.retryAfter = Date.now() + RETRY_COOLDOWN_MS;
        console.error('ZVec embedding worker failure', error);
      },
      (message) => {
        if (!this.disposed) {
          this.onProgress(message as Partial<IndexStatus>);
        }
      },
      false,
      this.nodeExecutable,
    );
    this.client = client;
    return client;
  }

  private scheduleIdleShutdown(client: WorkerRpcClient): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (
        this.disposed
        || this.activeRequests > 0
        || this.client !== client
      ) {
        return;
      }
      this.client = null;
      this.loadedOnce = false;
      void this.stopIdleClient(client);
    }, this.idleShutdownMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer === null) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private async stopIdleClient(client: WorkerRpcClient): Promise<void> {
    try {
      await client.request('dispose', {}, 2000);
    } catch (error) {
      console.warn('ZVec embedding worker idle shutdown was force-bounded', error);
    } finally {
      await client.stop();
    }
  }
}

export function hashEmbedding(text: string, dimension = 384): Float32Array {
  const vector = new Float32Array(dimension);
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

function addFeature(vector: Float32Array, feature: string, weight: number): void {
  let hash = 2166136261;
  for (let index = 0; index < feature.length; index += 1) {
    hash ^= feature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const position = Math.abs(hash) % vector.length;
  const sign = (hash & 1) === 0 ? 1 : -1;
  vector[position] = (vector[position] ?? 0) + sign * weight;
}
