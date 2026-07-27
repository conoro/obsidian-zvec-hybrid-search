import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { App, getAllTags, TFile } from 'obsidian';
import {
  errorMessage,
  isMissingFileError,
  withTimeout,
} from '../runtime/safety';
import type {
  HybridSearchSettings,
  IndexStatus,
  Passage,
  PersistedIndexState,
} from '../types';
import {
  INDEX_SCHEMA_VERSION,
  ROOT_FOLDER,
} from '../types';
import { LocalEmbeddingService } from '../search/embeddings';
import { chunkMarkdown, matchesGlob } from '../search/text';
import { ZVecStore } from '../search/zvec-store';

type StatusSink = (status: Partial<IndexStatus>) => void;

const CHANGE_DEBOUNCE_MS = 1200;
const OPTIMIZE_IDLE_MS = 45_000;
const OPTIMIZE_PASSAGE_THRESHOLD = 100;
const RECONCILIATION_INTERVAL_MS = 60 * 60_000;
const FILE_IO_TIMEOUT_MS = 15_000;
const STATE_IO_TIMEOUT_MS = 5000;
const STOP_TIMEOUT_MS = 3000;
const MAX_PENDING_PATHS = 1000;
const MAX_NOTE_BYTES = 5 * 1024 * 1024;
const SCAN_YIELD_INTERVAL = 500;

interface FileSnapshot {
  path: string;
  mtime: number;
  size: number;
  passages: Passage[];
}

export class VaultIndexer {
  private state: PersistedIndexState | null = null;
  private activeRun: Promise<void> | null = null;
  private cancelRequested = false;
  private scheduledTimer: number | null = null;
  private optimizationTimer: number | null = null;
  private reconciliationTimer: number | null = null;
  private readonly pendingPaths = new Set<string>();
  private fullReconciliationRequested = false;
  private forceRebuildRequested = false;
  private optimizeRequested = false;
  private unoptimizedPassages = 0;
  private recoveryRequested = false;
  private disposed = false;
  private stateWriteGeneration = 0;

  constructor(
    private readonly app: App,
    private readonly store: ZVecStore,
    private readonly embeddings: LocalEmbeddingService,
    private readonly settings: () => HybridSearchSettings,
    private readonly statePath: string,
    private readonly onStatus: StatusSink,
  ) {}

  async initialize(): Promise<void> {
    await withTimeout(
      fs.mkdir(dirname(this.statePath), { recursive: true }),
      STATE_IO_TIMEOUT_MS,
      'Creating the ZVec state directory',
    );
    await this.store.open();
    this.state = await this.readState();
    if (this.state && this.state.embeddingDtype === undefined) {
      this.state.embeddingDtype = this.settings().embeddingDtype;
    }
    this.reconciliationTimer = window.setInterval(() => {
      if (this.settings().autoIndex) this.scheduleReconciliation();
    }, RECONCILIATION_INTERVAL_MS);
    this.onStatus({
      phase: 'idle',
      message: this.store.stats.docCount > 0
        ? `Index ready: ${this.store.stats.docCount.toLocaleString()} passages`
        : 'Index has not been built yet.',
      passagesIndexed: this.store.stats.docCount,
    });
  }

  run(force = false): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error('The ZVec indexer has been stopped.'));
    }
    this.fullReconciliationRequested = true;
    this.forceRebuildRequested ||= force;
    this.recoveryRequested = true;
    return this.ensureRun();
  }

  schedulePaths(
    paths: Iterable<string>,
    delayMs = CHANGE_DEBOUNCE_MS,
  ): void {
    if (this.disposed) return;
    for (const path of paths) this.pendingPaths.add(path);
    if (this.pendingPaths.size > MAX_PENDING_PATHS) {
      this.pendingPaths.clear();
      this.fullReconciliationRequested = true;
    }
    this.schedulePendingWork(delayMs);
  }

  scheduleReconciliation(delayMs = CHANGE_DEBOUNCE_MS): void {
    if (this.disposed) return;
    this.fullReconciliationRequested = true;
    this.schedulePendingWork(delayMs);
  }

  private ensureRun(): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error('The ZVec indexer has been stopped.'));
    }
    if (this.activeRun) return this.activeRun;
    this.cancelRequested = false;
    this.activeRun = this.drainWorkQueue().finally(() => {
      this.activeRun = null;
    });
    return this.activeRun;
  }

  private schedulePendingWork(delayMs: number): void {
    this.clearOptimizationTimer();
    if (this.scheduledTimer !== null) window.clearTimeout(this.scheduledTimer);
    this.scheduledTimer = window.setTimeout(() => {
      this.scheduledTimer = null;
      this.startBackgroundRun('scheduled index update');
    }, delayMs);
  }

  cancel(): void {
    this.cancelRequested = true;
    this.pendingPaths.clear();
    this.fullReconciliationRequested = false;
    this.forceRebuildRequested = false;
    this.optimizeRequested = false;
    if (this.scheduledTimer !== null) {
      window.clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }
    void this.embeddings.cancelActive().catch((error) => {
      console.warn('ZVec Hybrid Search could not stop embedding work', error);
    });
    this.onStatus({ message: 'Cancelling after the current batch…' });
  }

  async resetAndReindex(): Promise<void> {
    if (this.activeRun) {
      this.cancel();
      await this.activeRun;
    }
    this.clearOptimizationTimer();
    this.unoptimizedPassages = 0;
    await this.store.recreate();
    this.state = null;
    try {
      await withTimeout(
        fs.unlink(this.statePath),
        STATE_IO_TIMEOUT_MS,
        'Removing the old index state',
      );
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
    await this.run(true);
  }

  async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.scheduledTimer !== null) window.clearTimeout(this.scheduledTimer);
    this.clearOptimizationTimer();
    if (this.reconciliationTimer !== null) {
      window.clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }
    this.cancelRequested = true;
    await Promise.allSettled([
      this.embeddings.dispose(),
      this.store.close(),
    ]);
  }

  async stop(): Promise<void> {
    if (this.disposed) return;
    this.cancel();
    if (this.activeRun) {
      try {
        await withTimeout(
          this.activeRun,
          STOP_TIMEOUT_MS,
          'Stopping ZVec indexing',
        );
      } catch (error) {
        console.warn(
          'ZVec Hybrid Search stopped without waiting for active work',
          error,
        );
      }
    }
    await this.close();
  }

  private async drainWorkQueue(): Promise<void> {
    let failed = false;
    try {
      await this.store.open(this.recoveryRequested);
      this.recoveryRequested = false;
      while (!this.cancelRequested) {
        if (this.forceRebuildRequested) {
          this.forceRebuildRequested = false;
          this.fullReconciliationRequested = false;
          this.pendingPaths.clear();
          await this.performReconciliation(true);
          continue;
        }
        if (this.fullReconciliationRequested) {
          this.fullReconciliationRequested = false;
          this.pendingPaths.clear();
          await this.performReconciliation(false);
          continue;
        }
        if (this.pendingPaths.size > 0) {
          const paths = [...this.pendingPaths];
          this.pendingPaths.clear();
          await this.performIncrementalUpdate(paths);
          continue;
        }
        if (this.optimizeRequested) {
          this.optimizeRequested = false;
          await this.performOptimization();
          continue;
        }
        break;
      }
    } catch (error) {
      if (this.cancelRequested) {
        this.onStatus({
          phase: 'cancelled',
          message: 'Indexing cancelled.',
          passagesIndexed: this.store.stats.docCount,
        });
        return;
      }
      failed = true;
      const message = errorMessage(error);
      this.onStatus({
        phase: 'error',
        message: 'Indexing failed.',
        error: message,
      });
      throw error;
    } finally {
      if (!failed && !this.cancelRequested && this.unoptimizedPassages > 0) {
        this.scheduleOptimization();
      }
    }
  }

  private async performReconciliation(force: boolean): Promise<void> {
    const settings = this.settings();
    this.onStatus({
      phase: 'scanning',
      message: 'Scanning Markdown files…',
      completed: 0,
      total: 0,
      filesIndexed: 0,
    });

    if (force || !this.state || !stateIsCompatible(this.state, settings)) {
      this.store.recreate();
      this.state = newState(settings);
      this.unoptimizedPassages = 0;
    }

    const currentState = this.state;
    const files: TFile[] = [];
    const livePaths = new Set<string>();
    const changedFiles: TFile[] = [];
    const vaultFiles = this.app.vault.getMarkdownFiles();
    for (let index = 0; index < vaultFiles.length; index += 1) {
      const file = vaultFiles[index];
      if (file && shouldIndex(file, settings)) {
        files.push(file);
        livePaths.add(file.path);
        if (fileHasChanged(file, currentState)) changedFiles.push(file);
      }
      if (index > 0 && index % SCAN_YIELD_INTERVAL === 0) {
        await yieldToRenderer();
        if (this.cancelRequested) {
          this.reportCancelled();
          return;
        }
      }
    }
    const stalePaths: string[] = [];
    const indexedPaths = Object.keys(currentState.files);
    for (let index = 0; index < indexedPaths.length; index += 1) {
      const path = indexedPaths[index];
      if (path && !livePaths.has(path)) stalePaths.push(path);
      if (index > 0 && index % SCAN_YIELD_INTERVAL === 0) {
        await yieldToRenderer();
        if (this.cancelRequested) {
          this.reportCancelled();
          return;
        }
      }
    }

    this.onStatus({
      phase: 'scanning',
      message: `${changedFiles.length.toLocaleString()} changed, ${stalePaths.length.toLocaleString()} removed`,
      completed: 0,
      total: changedFiles.length + stalePaths.length,
    });

    let affectedPassages = 0;
    for (const path of stalePaths) {
      if (this.cancelRequested) break;
      affectedPassages += await this.removePath(path, currentState);
      this.incrementProgress();
    }

    let filesIndexed = 0;
    for (const file of changedFiles) {
      if (this.cancelRequested) break;
      affectedPassages += await this.updateFile(file, settings, currentState);
      filesIndexed += 1;
      this.onStatus({
        filesIndexed,
        passagesIndexed: this.store.stats.docCount,
      });
      this.incrementProgress();
      await this.writeState(currentState);
    }

    await this.finishUpdate(currentState, affectedPassages);
  }

  private async performIncrementalUpdate(paths: string[]): Promise<void> {
    const settings = this.settings();
    if (!this.state || !stateIsCompatible(this.state, settings)) {
      this.fullReconciliationRequested = true;
      return;
    }
    const currentState = this.state;
    const uniquePaths = [...new Set(paths)];
    this.onStatus({
      phase: 'scanning',
      message: `Checking ${uniquePaths.length.toLocaleString()} changed path${uniquePaths.length === 1 ? '' : 's'}…`,
      completed: 0,
      total: uniquePaths.length,
      filesIndexed: 0,
    });

    let filesIndexed = 0;
    let affectedPassages = 0;
    for (const path of uniquePaths) {
      if (this.cancelRequested) break;
      const abstractFile = this.app.vault.getAbstractFileByPath(path);
      if (
        abstractFile instanceof TFile
        && shouldIndex(abstractFile, settings)
      ) {
        if (fileHasChanged(abstractFile, currentState)) {
          affectedPassages += await this.updateFile(
            abstractFile,
            settings,
            currentState,
          );
          filesIndexed += 1;
          await this.writeState(currentState);
        }
      } else if (currentState.files[path]) {
        affectedPassages += await this.removePath(path, currentState);
      }
      this.onStatus({
        completedDelta: 1,
        filesIndexed,
        passagesIndexed: this.store.stats.docCount,
      } as Partial<IndexStatus>);
    }

    await this.finishUpdate(currentState, affectedPassages);
  }

  private async updateFile(
    file: TFile,
    settings: HybridSearchSettings,
    state: PersistedIndexState,
  ): Promise<number> {
    const snapshot = await this.passagesForFile(file, settings);
    this.onStatus({
      phase: 'embedding',
      message: `Embedding ${snapshot.path}`,
    });
    const embeddings = await this.embedPassages(
      snapshot.passages,
      settings.embeddingBatchSize,
    );
    if (this.cancelRequested) return 0;

    const currentFile = this.app.vault.getAbstractFileByPath(snapshot.path);
    if (
      !(currentFile instanceof TFile)
      || currentFile.stat.mtime !== snapshot.mtime
      || currentFile.stat.size !== snapshot.size
    ) {
      this.pendingPaths.add(snapshot.path);
      return 0;
    }

    this.onStatus({
      phase: 'writing',
      message: `Writing ${snapshot.path}`,
    });
    const previousPassages = state.files[snapshot.path]?.passageIds.length ?? 0;
    await this.store.deletePath(snapshot.path);
    for (let offset = 0; offset < snapshot.passages.length; offset += 64) {
      const passageBatch = snapshot.passages.slice(offset, offset + 64);
      const embeddingBatch = embeddings.slice(offset, offset + 64);
      await this.store.upsert(passageBatch, embeddingBatch);
    }

    state.files[snapshot.path] = {
      mtime: Math.trunc(snapshot.mtime),
      size: snapshot.size,
      passageIds: snapshot.passages.map((passage) => passage.id),
    };
    return Math.max(previousPassages, snapshot.passages.length);
  }

  private async removePath(
    path: string,
    state: PersistedIndexState,
  ): Promise<number> {
    const passageCount = state.files[path]?.passageIds.length ?? 0;
    await this.store.deletePath(path);
    delete state.files[path];
    return passageCount;
  }

  private async finishUpdate(
    state: PersistedIndexState,
    affectedPassages: number,
  ): Promise<void> {
    await this.writeState(state);
    if (this.cancelRequested) {
      this.reportCancelled();
      return;
    }

    if (affectedPassages > 0) {
      this.unoptimizedPassages += affectedPassages;
      if (this.unoptimizedPassages >= OPTIMIZE_PASSAGE_THRESHOLD) {
        this.optimizeRequested = true;
      }
    }
    const noteCount = Object.keys(state.files).length;
    this.onStatus({
      phase: 'ready',
      message: `Ready: ${this.store.stats.docCount.toLocaleString()} passages from ${noteCount.toLocaleString()} notes`,
      completed: noteCount,
      total: noteCount,
      passagesIndexed: this.store.stats.docCount,
    });
  }

  private async performOptimization(): Promise<void> {
    if (this.unoptimizedPassages === 0) return;
    this.clearOptimizationTimer();
    this.onStatus({
      phase: 'optimizing',
      message: 'Optimizing the ZVec index during idle time…',
    });
    await this.store.optimize();
    this.unoptimizedPassages = 0;
    const noteCount = Object.keys(this.state?.files ?? {}).length;
    this.onStatus({
      phase: 'ready',
      message: `Ready: ${this.store.stats.docCount.toLocaleString()} passages from ${noteCount.toLocaleString()} notes`,
      passagesIndexed: this.store.stats.docCount,
    });
  }

  private scheduleOptimization(): void {
    if (
      this.optimizationTimer !== null
      || this.optimizeRequested
      || this.unoptimizedPassages === 0
    ) {
      return;
    }
    this.optimizationTimer = window.setTimeout(() => {
      this.optimizationTimer = null;
      this.optimizeRequested = true;
      this.startBackgroundRun('idle index optimization');
    }, OPTIMIZE_IDLE_MS);
  }

  private clearOptimizationTimer(): void {
    if (this.optimizationTimer !== null) {
      window.clearTimeout(this.optimizationTimer);
      this.optimizationTimer = null;
    }
  }

  private async passagesForFile(
    file: TFile,
    settings: HybridSearchSettings,
  ): Promise<FileSnapshot> {
    const path = file.path;
    const mtime = file.stat.mtime;
    const size = file.stat.size;
    if (size > MAX_NOTE_BYTES) {
      console.warn(
        `ZVec Hybrid Search skipped oversized note (${size} bytes): ${path}`,
      );
      return { path, mtime, size, passages: [] };
    }
    const markdown = await withTimeout(
      this.app.vault.cachedRead(file),
      FILE_IO_TIMEOUT_MS,
      `Reading ${path}`,
    );
    const cache = this.app.metadataCache.getFileCache(file);
    const tags = cache ? (getAllTags(cache) ?? []) : [];
    return {
      path,
      mtime,
      size,
      passages: chunkMarkdown({
        path,
        markdown,
        chunkSize: settings.chunkSize,
        chunkOverlap: settings.chunkOverlap,
        tags,
        mtime,
        ctime: file.stat.ctime,
      }),
    };
  }

  private async embedPassages(
    passages: Passage[],
    batchSize: number,
  ): Promise<Float32Array[]> {
    const result: Float32Array[] = [];
    for (let offset = 0; offset < passages.length; offset += batchSize) {
      if (this.cancelRequested) break;
      const batch = passages.slice(offset, offset + batchSize);
      result.push(...await this.embeddings.embed(
        batch.map((passage) => passage.searchText),
      ));
    }
    return result;
  }

  private incrementProgress(): void {
    this.onStatus({ completedDelta: 1 } as Partial<IndexStatus>);
  }

  private async readState(): Promise<PersistedIndexState | null> {
    try {
      const serialized = await withTimeout(
        fs.readFile(this.statePath, 'utf8'),
        STATE_IO_TIMEOUT_MS,
        'Reading the ZVec index state',
      );
      const parsed: unknown = JSON.parse(serialized);
      if (!isPersistedIndexState(parsed)) {
        console.warn(
          'ZVec Hybrid Search index state has an invalid shape and will be rebuilt',
        );
        return null;
      }
      return parsed;
    } catch (error) {
      if (!isMissingFileError(error) && error instanceof SyntaxError) {
        console.warn(
          'ZVec Hybrid Search index state is invalid and will be rebuilt',
          error,
        );
      } else if (!isMissingFileError(error)) {
        throw error;
      }
      return null;
    }
  }

  private async writeState(state: PersistedIndexState): Promise<void> {
    const generation = this.stateWriteGeneration + 1;
    this.stateWriteGeneration = generation;
    const temporary = `${this.statePath}.tmp-${generation}`;
    const write = (async () => {
      await fs.writeFile(
        temporary,
        `${JSON.stringify(state, null, 2)}\n`,
        'utf8',
      );
      if (generation !== this.stateWriteGeneration || this.disposed) {
        await fs.unlink(temporary).catch(() => undefined);
        return;
      }
      await fs.rename(temporary, this.statePath);
    })();
    try {
      await withTimeout(
        write,
        STATE_IO_TIMEOUT_MS,
        'Writing the ZVec index state',
      );
    } catch (error) {
      if (generation === this.stateWriteGeneration) {
        this.stateWriteGeneration += 1;
      }
      void write.catch((lateError) => {
        console.warn('A late ZVec state write failed', lateError);
      });
      throw error;
    }
  }

  private startBackgroundRun(context: string): void {
    void this.ensureRun().catch((error) => {
      console.error(`ZVec Hybrid Search ${context} failed`, error);
    });
  }

  private reportCancelled(): void {
    this.onStatus({
      phase: 'cancelled',
      message: 'Indexing cancelled. Run reindex to continue.',
      passagesIndexed: this.store.stats.docCount,
    });
  }
}

function fileHasChanged(
  file: TFile,
  state: PersistedIndexState,
): boolean {
  const saved = state.files[file.path];
  return !saved
    || saved.mtime !== Math.trunc(file.stat.mtime)
    || saved.size !== file.stat.size;
}

function newState(settings: HybridSearchSettings): PersistedIndexState {
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    embeddingBackend: settings.embeddingBackend,
    embeddingModel: settings.embeddingModel,
    embeddingDtype: settings.embeddingDtype,
    chunkSize: settings.chunkSize,
    chunkOverlap: settings.chunkOverlap,
    indexedFolders: [...settings.indexedFolders].sort(),
    excludePatterns: [...settings.excludePatterns].sort(),
    files: {},
  };
}

function stateIsCompatible(
  state: PersistedIndexState,
  settings: HybridSearchSettings,
): boolean {
  const expected = newState(settings);
  return state.schemaVersion === expected.schemaVersion
    && state.embeddingBackend === expected.embeddingBackend
    && state.embeddingModel === expected.embeddingModel
    && (
      state.embeddingDtype === undefined
      || state.embeddingDtype === expected.embeddingDtype
    )
    && state.chunkSize === expected.chunkSize
    && state.chunkOverlap === expected.chunkOverlap
    && JSON.stringify(state.indexedFolders) === JSON.stringify(expected.indexedFolders)
    && JSON.stringify(state.excludePatterns) === JSON.stringify(expected.excludePatterns);
}

function isPersistedIndexState(
  value: unknown,
): value is PersistedIndexState {
  if (!isRecord(value) || !isRecord(value.files)) return false;
  if (
    typeof value.schemaVersion !== 'number'
    || typeof value.embeddingBackend !== 'string'
    || typeof value.embeddingModel !== 'string'
    || (
      value.embeddingDtype !== undefined
      && typeof value.embeddingDtype !== 'string'
    )
    || !Array.isArray(value.indexedFolders)
    || !Array.isArray(value.excludePatterns)
  ) {
    return false;
  }
  return Object.values(value.files).every((entry) =>
    isRecord(entry)
    && typeof entry.mtime === 'number'
    && Number.isFinite(entry.mtime)
    && typeof entry.size === 'number'
    && Number.isFinite(entry.size)
    && Array.isArray(entry.passageIds)
    && entry.passageIds.every((id) => typeof id === 'string'),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function yieldToRenderer(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

export function shouldIndex(
  file: Pick<TFile, 'path'>,
  settings: Pick<HybridSearchSettings, 'indexedFolders' | 'excludePatterns'>,
): boolean {
  if (!file.path.toLocaleLowerCase().endsWith('.md')) return false;
  if (file.path.split('/').some((segment) => segment.startsWith('.'))) return false;
  if (settings.excludePatterns.some((pattern) => matchesGlob(file.path, pattern))) {
    return false;
  }
  if (settings.indexedFolders.includes(ROOT_FOLDER)) return true;
  const topLevel = file.path.includes('/') ? file.path.split('/')[0] ?? '' : ROOT_FOLDER;
  return settings.indexedFolders.includes(topLevel);
}
