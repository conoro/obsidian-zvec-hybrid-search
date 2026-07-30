import { join } from 'node:path';
import {
  FileSystemAdapter,
  Notice,
  Plugin,
  TFile,
  type TAbstractFile,
  type WorkspaceLeaf,
} from 'obsidian';
import { VaultIndexer } from './src/indexing/vault-indexer';
import type { ZVecPluginApi } from './src/plugin-api';
import {
  errorMessage,
  PluginRuntimeError,
  withTimeout,
} from './src/runtime/safety';
import { RuntimeManager } from './src/runtime/runtime-manager';
import { LocalEmbeddingService } from './src/search/embeddings';
import { HybridSearchEngine } from './src/search/engine';
import { ZVecStore } from './src/search/zvec-store';
import { normalizeSettings } from './src/settings';
import {
  DEFAULT_SETTINGS,
  type HybridSearchSettings,
  type IndexStatus,
} from './src/types';
import {
  HybridSearchView,
  VIEW_TYPE_ZVEC_SEARCH,
} from './src/ui/search-view';
import { ZVecSearchSettingTab } from './src/ui/settings-tab';

const INITIAL_STATUS: IndexStatus = {
  phase: 'loading',
  message: 'Loading ZVec…',
  completed: 0,
  total: 0,
  filesIndexed: 0,
  passagesIndexed: 0,
  background: false,
};
const STARTUP_RECONCILIATION_DELAY_MS = 30_000;

export default class ZVecHybridSearchPlugin
  extends Plugin
  implements ZVecPluginApi {
  override settings: HybridSearchSettings = { ...DEFAULT_SETTINGS };
  indexStatus: IndexStatus = { ...INITIAL_STATUS };
  engine: HybridSearchEngine | null = null;
  indexer: VaultIndexer | null = null;

  private store: ZVecStore | null = null;
  private embeddings: LocalEmbeddingService | null = null;
  private runtimeManager: RuntimeManager | null = null;
  private runtimePromise: Promise<void> | null = null;
  private restartPromise: Promise<void> | null = null;
  private isUnloading = false;

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_ZVEC_SEARCH,
      (leaf) => new HybridSearchView(leaf, this),
    );
    this.addRibbonIcon('scan-search', 'Open ZVec Hybrid Search', () => {
      void this.runSafely(
        'Opening the search sidebar',
        () => this.activateView(),
      );
    });
    this.addCommand({
      id: 'open-zvec-hybrid-search',
      name: 'Open hybrid search',
      callback: () => void this.runSafely(
        'Opening the search sidebar',
        () => this.activateView(),
      ),
    });
    this.addCommand({
      id: 'focus-zvec-hybrid-search',
      name: 'Focus hybrid search input',
      callback: () => void this.runSafely(
        'Focusing the search sidebar',
        () => this.activateView(true),
      ),
    });
    this.addCommand({
      id: 'reindex-zvec-hybrid-search',
      name: 'Incrementally reindex notes',
      callback: () => void this.runSafely(
        'Incremental reindex',
        () => this.withIndexer((indexer) => indexer.run(false)),
      ),
    });
    this.addCommand({
      id: 'rebuild-zvec-hybrid-search',
      name: 'Reset and rebuild search index',
      callback: () => void this.restartRuntimeAndReindex(),
    });
    this.addSettingTab(new ZVecSearchSettingTab(this));
    void this.ensureRuntimeReady().catch((error) => {
      if (!this.isUnloading) {
        console.error('ZVec Hybrid Search runtime startup failed', error);
      }
    });

    this.app.workspace.onLayoutReady(() => {
      const scheduleFile = (file: TAbstractFile): void => {
        if (!this.settings.autoIndex) return;
        if (file instanceof TFile) {
          void this.withIndexer(async (indexer) => {
            indexer.schedulePaths([file.path]);
          }).catch((error) => {
            console.warn('ZVec file update could not be scheduled', error);
          });
        } else {
          void this.withIndexer(async (indexer) => {
            indexer.scheduleReconciliation();
          }).catch((error) => {
            console.warn('ZVec folder update could not be scheduled', error);
          });
        }
      };
      this.registerEvent(this.app.vault.on('create', scheduleFile));
      this.registerEvent(this.app.vault.on('modify', scheduleFile));
      this.registerEvent(this.app.vault.on('delete', scheduleFile));
      this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
        if (!this.settings.autoIndex) return;
        if (file instanceof TFile) {
          void this.withIndexer(async (indexer) => {
            indexer.schedulePaths([oldPath, file.path]);
          }).catch((error) => {
            console.warn('ZVec rename could not be scheduled', error);
          });
        } else {
          void this.withIndexer(async (indexer) => {
            indexer.scheduleReconciliation();
          }).catch((error) => {
            console.warn('ZVec folder rename could not be scheduled', error);
          });
        }
      }));
      if (this.settings.autoIndex) {
        void this.withIndexer(async (indexer) => {
          if (indexer.hasUsablePersistedIndex) {
            indexer.scheduleReconciliation(
              STARTUP_RECONCILIATION_DELAY_MS,
            );
            return;
          }
          await indexer.run(false);
        }).catch((error) => {
          console.error('ZVec Hybrid Search indexing failed', error);
        });
      }
    });
  }

  override async onunload(): Promise<void> {
    this.isUnloading = true;
    this.runtimeManager?.cancel();
    try {
      await withTimeout(
        this.indexer?.stop() ?? Promise.resolve(),
        5000,
        'Stopping ZVec Hybrid Search',
      );
    } catch (error) {
      console.warn('ZVec Hybrid Search unload was force-bounded', error);
      await this.store?.close().catch((closeError) => {
        console.warn('ZVec Hybrid Search forced worker close failed', closeError);
      });
    }
  }

  async saveSettings(): Promise<void> {
    try {
      this.settings = normalizeSettings(this.settings);
      await withTimeout(
        this.saveData(this.settings),
        5000,
        'Saving ZVec settings',
      );
    } catch (error) {
      this.reportError('Settings could not be saved', error, true);
    }
  }

  async restartRuntimeAndReindex(): Promise<void> {
    if (this.restartPromise) return this.restartPromise;
    this.restartPromise = this.runSafely(
      'Reset and rebuild',
      async () => {
        await this.indexer?.stop();
        this.indexer = null;
        this.engine = null;
        await this.createRuntime();
        const indexer = this.requireIndexer();
        await indexer.resetAndReindex();
      },
    ).finally(() => {
      this.restartPromise = null;
    });
    return this.restartPromise;
  }

  async ensureRuntimeReady(): Promise<void> {
    if (this.engine && this.indexer) return;
    if (this.isUnloading) {
      throw new PluginRuntimeError(
        'PLUGIN_STOPPED',
        'ZVec Hybrid Search is stopping.',
      );
    }
    if (this.runtimePromise) return this.runtimePromise;
    this.runtimePromise = this.createRuntime()
      .catch((error) => {
        if (!this.isUnloading) {
          this.updateStatus({
            phase: 'error',
            message: 'Search runtime is unavailable.',
            error: errorMessage(error),
            completed: 0,
            total: 0,
          });
        }
        throw error;
      })
      .finally(() => {
        this.runtimePromise = null;
      });
    return this.runtimePromise;
  }

  cancelIndexing(): void {
    this.runtimeManager?.cancel();
    this.indexer?.cancel();
  }

  async runSafely(
    context: string,
    action: () => Promise<void>,
    showNotice = true,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.reportError(`${context} failed`, error, showNotice);
    }
  }

  private async loadSettings(): Promise<void> {
    try {
      this.settings = normalizeSettings(await withTimeout(
        this.loadData() as Promise<unknown>,
        5000,
        'Loading ZVec settings',
      ));
    } catch (error) {
      this.settings = normalizeSettings(null);
      console.warn(
        'ZVec Hybrid Search could not load settings; using safe defaults',
        error,
      );
    }
  }

  private async createRuntime(): Promise<void> {
    this.updateStatus({ ...INITIAL_STATUS });
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error('ZVec Hybrid Search requires a local desktop vault.');
    }
    const pluginDirectory = this.manifest.dir;
    if (!pluginDirectory) {
      throw new Error('Obsidian did not provide the plugin directory.');
    }
    const dataDirectory = join(
      adapter.getBasePath(),
      pluginDirectory,
      'search-data',
    );
    this.runtimeManager ??= new RuntimeManager(
      dataDirectory,
      this.manifest.version,
      (message, completed = 0, total = 0) => this.updateStatus({
        phase: 'downloading-runtime',
        message,
        completed,
        total,
        background: false,
      }),
    );
    const runtime = await this.runtimeManager.ensure();
    if (this.isUnloading) {
      throw new PluginRuntimeError(
        'PLUGIN_STOPPED',
        'ZVec Hybrid Search stopped during runtime startup.',
      );
    }
    const previousIndexer = this.indexer;
    this.indexer = null;
    this.engine = null;
    if (previousIndexer) await previousIndexer.stop();
    const store = new ZVecStore(
      join(dataDirectory, 'collection'),
      runtime.rootDirectory,
      runtime.nodeExecutable,
    );
    const embeddings = new LocalEmbeddingService(
      join(dataDirectory, 'models'),
      this.settings.embeddingBackend,
      this.settings.embeddingModel,
      this.settings.embeddingDtype,
      (status) => this.updateStatus({
        ...status,
        background: this.indexer?.isRunningInBackground ?? false,
      }),
      runtime.rootDirectory,
      undefined,
      runtime.nodeExecutable,
    );
    const indexer = new VaultIndexer(
      this.app,
      store,
      embeddings,
      () => this.settings,
      join(dataDirectory, 'index-state.json'),
      (status) => this.updateStatus(status),
    );
    const engine = new HybridSearchEngine(
      store,
      embeddings,
      () => this.settings,
    );
    this.store = store;
    this.embeddings = embeddings;
    this.indexer = indexer;
    this.engine = engine;
    try {
      await indexer.initialize();
    } catch (error) {
      this.updateStatus({
        phase: 'error',
        message: 'ZVec is paused; vault storage is unavailable.',
        error: errorMessage(error),
        completed: 0,
        total: 0,
      });
      console.error(
        'ZVec Hybrid Search started in a contained unavailable state',
        error,
      );
    }
  }

  private async withIndexer(
    action: (indexer: VaultIndexer) => Promise<void>,
  ): Promise<void> {
    await this.ensureRuntimeReady();
    const indexer = this.requireIndexer();
    await action(indexer);
  }

  private requireIndexer(): VaultIndexer {
    if (this.indexer) return this.indexer;
    throw new PluginRuntimeError(
      'RUNTIME_UNAVAILABLE',
      'The search runtime is unavailable.',
      { retryable: true },
    );
  }

  private updateStatus(
    update: Partial<IndexStatus> & { completedDelta?: number },
  ): void {
    if (this.isUnloading) return;
    const completedDelta = update.completedDelta ?? 0;
    const { completedDelta: _ignored, ...status } = update;
    const nextError = Object.hasOwn(status, 'error')
      ? status.error
      : status.phase && status.phase !== 'error'
        ? undefined
        : this.indexStatus.error;
    this.indexStatus = {
      ...this.indexStatus,
      ...status,
      error: nextError,
      completed: status.completed
        ?? this.indexStatus.completed + completedDelta,
    };
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ZVEC_SEARCH)) {
      if (leaf.view instanceof HybridSearchView) {
        leaf.view.updateIndexStatus(this.indexStatus);
      }
    }
  }

  private async activateView(focus = true): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_ZVEC_SEARCH);
    let leaf: WorkspaceLeaf | null = existing[0] ?? null;
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) {
        new Notice('Could not open the ZVec search sidebar.');
        return;
      }
      await leaf.setViewState({
        type: VIEW_TYPE_ZVEC_SEARCH,
        active: true,
      });
    }
    this.app.workspace.revealLeaf(leaf);
    if (focus && leaf.view instanceof HybridSearchView) {
      leaf.view.focusSearch();
    }
  }

  private reportError(
    context: string,
    error: unknown,
    showNotice: boolean,
  ): void {
    const message = errorMessage(error);
    console.error(`ZVec Hybrid Search: ${context}`, error);
    this.updateStatus({
      phase: 'error',
      message: context,
      error: message,
    });
    if (showNotice && !this.isUnloading) {
      new Notice(`ZVec Hybrid Search: ${context}. ${message}`, 8000);
    }
  }
}
