import type { App } from 'obsidian';
import type { VaultIndexer } from './indexing/vault-indexer';
import type { HybridSearchEngine } from './search/engine';
import type { HybridSearchSettings, IndexStatus } from './types';

export interface ZVecPluginApi {
  app: App;
  settings: HybridSearchSettings;
  indexStatus: IndexStatus;
  engine: HybridSearchEngine;
  indexer: VaultIndexer;
  saveSettings(): Promise<void>;
  restartRuntimeAndReindex(): Promise<void>;
  runSafely(
    context: string,
    action: () => Promise<void>,
    showNotice?: boolean,
  ): Promise<void>;
}
