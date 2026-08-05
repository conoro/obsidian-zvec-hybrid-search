import { join } from 'node:path';
import type { ZVecDoc, ZVecDocInput } from '@zvec/zvec';
import { WorkerRpcClient } from '../runtime/worker-rpc';
import {
  errorMessage,
  PluginRuntimeError,
} from '../runtime/safety';
import {
  EMBEDDING_DIMENSION,
  type MatchMode,
  type Passage,
} from '../types';
import { escapeFilterString, escapeFtsPhrase } from './text';
import { createZVecWorkerSource } from './zvec-worker';

const OUTPUT_FIELDS = [
  'path',
  'title',
  'heading',
  'preview',
  'startLine',
  'mtime',
  'ctime',
];
const OPEN_TIMEOUT_MS = 5000;
const QUERY_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 30_000;
const OPTIMIZE_TIMEOUT_MS = 120_000;
const RETRY_COOLDOWN_MS = 15_000;

interface WorkerResult<T = undefined> {
  value?: T;
  stats?: ZVecStats;
}

interface ZVecStats {
  docCount: number;
  indexCompleteness: Record<string, number>;
}

const EMPTY_STATS: ZVecStats = {
  docCount: 0,
  indexCompleteness: {},
};

export class ZVecStore {
  private client: WorkerRpcClient | null = null;
  private openPromise: Promise<void> | null = null;
  private ready = false;
  private stopped = false;
  private retryAfter = 0;
  private cachedStats: ZVecStats = EMPTY_STATS;

  constructor(
    private readonly collectionPath: string,
    private readonly runtimeDirectory = process.cwd(),
    private readonly nodeExecutable?: string,
  ) {}

  get stats(): ZVecStats {
    return this.cachedStats;
  }

  get isAvailable(): boolean {
    return this.ready && !this.stopped;
  }

  async open(forceRetry = false): Promise<void> {
    if (this.stopped) {
      throw new PluginRuntimeError(
        'PLUGIN_STOPPED',
        'ZVec Hybrid Search has been stopped.',
      );
    }
    if (this.ready) return;
    if (this.openPromise) return this.openPromise;
    if (!forceRetry && Date.now() < this.retryAfter) {
      const seconds = Math.max(1, Math.ceil((this.retryAfter - Date.now()) / 1000));
      throw new PluginRuntimeError(
        'RUNTIME_UNAVAILABLE',
        `ZVec storage is temporarily unavailable. Retry in ${seconds} seconds or remount the vault disk.`,
        { retryable: true },
      );
    }

    this.openPromise = this.openIsolatedWorker().finally(() => {
      this.openPromise = null;
    });
    return this.openPromise;
  }

  async recreate(): Promise<void> {
    await this.open(true);
    await this.perform<void>('recreate', {}, WRITE_TIMEOUT_MS);
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      await client.request('close', {}, 1000);
    } catch (error) {
      console.warn('ZVec Hybrid Search worker did not close cleanly', error);
    } finally {
      await client.stop();
    }
  }

  async upsert(passages: Passage[], embeddings: Float32Array[]): Promise<void> {
    if (passages.length !== embeddings.length) {
      throw new Error('Passage and embedding batch lengths do not match.');
    }
    const docs: ZVecDocInput[] = passages.map((passage, index) => ({
      id: passage.id,
      fields: {
        path: passage.path,
        title: passage.title,
        heading: passage.heading,
        content: passage.content,
        searchText: passage.searchText,
        titleText: passage.titleText,
        preview: passage.preview,
        tags: passage.tags,
        folder: passage.folder,
        startLine: passage.startLine,
        chunkIndex: passage.chunkIndex,
        mtime: passage.mtime,
        ctime: passage.ctime,
      },
      vectors: {
        embedding: Array.from(
          embeddings[index] ?? new Float32Array(EMBEDDING_DIMENSION),
        ),
      },
    }));
    await this.perform<void>('upsert', { docs }, WRITE_TIMEOUT_MS);
  }

  async deletePath(path: string): Promise<void> {
    await this.perform<void>('deleteByFilter', {
      filter: `path = ${escapeFilterString(path)}`,
    }, WRITE_TIMEOUT_MS);
  }

  async optimize(): Promise<void> {
    await this.perform<void>('optimize', {}, OPTIMIZE_TIMEOUT_MS);
  }

  async keywordQuery(
    query: string,
    matchMode: MatchMode,
    topk: number,
    fieldName = 'searchText',
    filter?: string,
  ): Promise<ZVecDoc[]> {
    return this.perform<ZVecDoc[]>('keywordQuery', {
      query,
      phraseQuery: escapeFtsPhrase(query),
      matchMode,
      topk,
      fieldName,
      filter,
      outputFields: OUTPUT_FIELDS,
    }, QUERY_TIMEOUT_MS);
  }

  async semanticQuery(
    vector: Float32Array,
    topk: number,
    filter?: string,
  ): Promise<ZVecDoc[]> {
    return this.perform<ZVecDoc[]>('semanticQuery', {
      vector,
      topk,
      filter,
      outputFields: OUTPUT_FIELDS,
    }, QUERY_TIMEOUT_MS);
  }

  private async openIsolatedWorker(): Promise<void> {
    await this.stopClient();
    const client = new WorkerRpcClient(
      createZVecWorkerSource(),
      {
        collectionPath: this.collectionPath,
        runtimeDirectory: this.runtimeDirectory,
        embeddingDimension: EMBEDDING_DIMENSION,
      },
      (error) => this.handleWorkerFailure(error),
      undefined,
      false,
      this.nodeExecutable,
    );
    this.client = client;
    try {
      const result = await client.request<WorkerResult>(
        'open',
        {},
        OPEN_TIMEOUT_MS,
      );
      this.updateStats(result.stats);
      this.ready = true;
      this.retryAfter = 0;
    } catch (error) {
      this.ready = false;
      this.retryAfter = Date.now() + RETRY_COOLDOWN_MS;
      await client.stop();
      if (this.client === client) this.client = null;
      throw new PluginRuntimeError(
        'RUNTIME_UNAVAILABLE',
        `ZVec storage could not be opened. Obsidian remains available; remount the vault disk and retry. ${errorMessage(error)}`,
        { cause: error, retryable: true },
      );
    }
  }

  private async perform<T>(
    method: string,
    args: unknown,
    timeoutMs: number,
  ): Promise<T> {
    await this.open();
    const client = this.client;
    if (!client) {
      throw new PluginRuntimeError(
        'RUNTIME_UNAVAILABLE',
        'The isolated ZVec worker is unavailable.',
        { retryable: true },
      );
    }
    try {
      const result = await client.request<WorkerResult<T>>(
        method,
        args,
        timeoutMs,
      );
      this.updateStats(result.stats);
      return result.value as T;
    } catch (error) {
      if (isFatalWorkerError(error) || !method.endsWith('Query')) {
        await this.quarantineClient(client);
      }
      throw new PluginRuntimeError(
        'STORAGE_ERROR',
        `ZVec ${method} failed inside its isolated worker. ${errorMessage(error)}`,
        { cause: error, retryable: true },
      );
    }
  }

  private updateStats(stats: ZVecStats | undefined): void {
    if (stats) this.cachedStats = stats;
  }

  private handleWorkerFailure(error: Error): void {
    this.ready = false;
    this.retryAfter = Date.now() + RETRY_COOLDOWN_MS;
    console.error('ZVec Hybrid Search isolated worker failure', error);
  }

  private async quarantineClient(client: WorkerRpcClient): Promise<void> {
    if (this.client === client) this.client = null;
    this.ready = false;
    this.retryAfter = Date.now() + RETRY_COOLDOWN_MS;
    await client.stop();
  }

  private async stopClient(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.ready = false;
    if (client) await client.stop();
  }
}

function isFatalWorkerError(error: unknown): boolean {
  return error instanceof PluginRuntimeError
    && (
      error.code === 'OPERATION_TIMEOUT'
      || error.code === 'WORKER_ERROR'
      || error.code === 'PLUGIN_STOPPED'
    );
}
