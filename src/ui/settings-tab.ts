import {
  Notice,
  PluginSettingTab,
  Setting,
  type SettingDefinitionItem,
} from 'obsidian';
import type { ZVecPluginApi } from '../plugin-api';
import { normalizeSettings, parseTopLevelFolders } from '../settings';
import {
  ROOT_FOLDER,
  type EmbeddingBackend,
  type HybridSearchSettings,
  type MatchMode,
  type ResultGrouping,
  type SearchMode,
  type SortOrder,
} from '../types';

type SettingsKey = keyof HybridSearchSettings;

interface IndexScopeDraft {
  scope: 'all' | 'selected';
  includedFolders: string;
}

const LOCAL_STORAGE_DESCRIPTION =
  'Search stays on this computer. Generated index, model, and runtime files are stored outside the vault so Dropbox and other sync services do not manage the native database.';

export class ZVecSearchSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: ZVecPluginApi) {
    super(plugin.app, plugin as never);
  }

  override getSettingDefinitions(): SettingDefinitionItem<SettingsKey>[] {
    const scopeDraft = this.createScopeDraft();
    let includedFoldersSetting: Setting | null = null;
    return [
      {
        name: 'Local search storage',
        desc: LOCAL_STORAGE_DESCRIPTION,
      },
      {
        type: 'group',
        heading: 'Index scope',
        items: [
          {
            name: 'Included notes',
            desc: 'Index the entire vault or only selected top-level folders.',
            render: (setting) => this.addIncludedNotesControl(
              setting,
              scopeDraft,
              () => includedFoldersSetting?.settingEl.toggleClass(
                'zvec-setting-hidden',
                scopeDraft.scope === 'all',
              ),
            ),
          },
          {
            name: 'Included top-level folders',
            desc: 'One vault-relative folder name per line. No filesystem paths are used.',
            render: (setting) => {
              includedFoldersSetting = setting;
              this.addIncludedFoldersControl(setting, scopeDraft);
              setting.settingEl.toggleClass(
                'zvec-setting-hidden',
                scopeDraft.scope === 'all',
              );
            },
          },
          {
            name: 'Excluded paths',
            desc: 'One vault-relative glob per line; ** crosses folder boundaries.',
            render: (setting) => this.addExcludedPathsControl(setting),
          },
          {
            name: 'Apply scope and rebuild',
            desc: 'Folder, exclusion, chunking, and model changes require a new index.',
            render: (setting) => this.addApplyScopeControl(
              setting,
              scopeDraft,
              () => undefined,
            ),
          },
        ],
      },
      {
        type: 'group',
        heading: 'Search defaults',
        items: [
          {
            name: 'Default search mode',
            control: {
              type: 'dropdown',
              key: 'defaultMode',
              options: {
                hybrid: 'Hybrid',
                keyword: 'Keywords',
                semantic: 'Semantic',
              },
            },
          },
          {
            name: 'Default term matching',
            desc: 'Choose all terms, any term, or an exact phrase.',
            control: {
              type: 'dropdown',
              key: 'defaultMatchMode',
              options: {
                all: 'All terms (AND)',
                any: 'Any term (OR)',
                phrase: 'Exact phrase',
              },
            },
          },
          {
            name: 'Default sort order',
            control: {
              type: 'dropdown',
              key: 'defaultSort',
              options: {
                relevance: 'Relevance',
                'modified-desc': 'Modified: newest',
                'modified-asc': 'Modified: oldest',
                'created-desc': 'Created: newest',
                'created-asc': 'Created: oldest',
                'title-asc': 'Title: A–Z',
                'title-desc': 'Title: Z–A',
              },
            },
          },
          {
            name: 'Default result grouping',
            control: {
              type: 'dropdown',
              key: 'defaultGrouping',
              options: {
                notes: 'Best passage per note',
                passages: 'All passages',
              },
            },
          },
          {
            name: 'Results per batch',
            desc: 'Result cards shown initially and added in each batch.',
            render: (setting) => this.addResultsPerBatchControl(setting),
          },
        ],
      },
      {
        type: 'group',
        heading: 'Local indexing',
        items: [
          {
            name: 'Automatic incremental indexing',
            desc: 'Queue changed notes after 10 quiet seconds and update only the affected passages.',
            control: {
              type: 'toggle',
              key: 'autoIndex',
            },
          },
          {
            name: 'Embedding backend',
            desc: 'ZVec indexes and ranks vectors; MiniLM creates those vectors from note text. Feature hash is a lightweight fallback.',
            render: (setting) => this.addEmbeddingBackendControl(setting),
          },
          {
            name: 'Passage size',
            desc: 'Approximate characters per indexed passage (600–2400).',
            render: (setting) => this.addPassageSizeControl(setting),
          },
          {
            name: 'Passage overlap',
            desc: 'Characters carried into the next passage (0–400).',
            render: (setting) => this.addPassageOverlapControl(setting),
          },
          {
            name: 'Title boost',
            desc: 'Extra relevance weight when query terms occur in the note title or heading.',
            control: {
              type: 'slider',
              key: 'titleBoost',
              min: 0,
              max: 1,
              step: 0.05,
            },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Index status',
        items: [{
          name: this.plugin.indexStatus.message,
          desc: this.indexStatusDescription(),
          aliases: ['Incremental reindex', 'Reset and rebuild', 'Cancel indexing'],
          render: (setting) => this.addIndexActions(setting),
        }],
      },
    ];
  }

  override getControlValue(key: string): unknown {
    if (!Object.hasOwn(this.plugin.settings, key)) return undefined;
    return this.plugin.settings[key as SettingsKey];
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (!Object.hasOwn(this.plugin.settings, key)) return;
    this.plugin.settings = normalizeSettings({
      ...this.plugin.settings,
      [key]: value,
    });
    await this.plugin.saveSettings();
  }

  /** Fallback for Obsidian versions older than 1.13.0. */
  override display(): void {
    this.renderLegacySettings();
  }

  private renderLegacySettings(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('p', {
      text: LOCAL_STORAGE_DESCRIPTION,
      cls: 'setting-item-description',
    });

    this.renderIndexScope();
    this.renderSearchDefaults();
    this.renderIndexTuning();
    this.renderIndexActions();
  }

  private createScopeDraft(): IndexScopeDraft {
    const scope = this.plugin.settings.indexedFolders.includes(ROOT_FOLDER)
      ? 'all'
      : 'selected';
    return {
      scope,
      includedFolders: scope === 'selected'
        ? this.plugin.settings.indexedFolders.join('\n')
        : '',
    };
  }

  private renderIndexScope(): void {
    new Setting(this.containerEl)
      .setName('Index scope')
      .setHeading();
    const draft = this.createScopeDraft();
    let includedFoldersSetting: Setting | null = null;

    this.addIncludedNotesControl(
      new Setting(this.containerEl)
        .setName('Included notes')
        .setDesc('Index the entire vault or only selected top-level folders.'),
      draft,
      () => includedFoldersSetting?.settingEl.toggleClass(
        'zvec-setting-hidden',
        draft.scope === 'all',
      ),
    );

    includedFoldersSetting = new Setting(this.containerEl)
      .setName('Included top-level folders')
      .setDesc('One vault-relative folder name per line. No filesystem paths are used.');
    this.addIncludedFoldersControl(includedFoldersSetting, draft);
    includedFoldersSetting.settingEl.toggleClass(
      'zvec-setting-hidden',
      draft.scope === 'all',
    );

    this.addExcludedPathsControl(
      new Setting(this.containerEl)
        .setName('Excluded paths')
        .setDesc('One vault-relative glob per line; ** crosses folder boundaries.'),
    );
    this.addApplyScopeControl(
      new Setting(this.containerEl)
        .setName('Apply scope and rebuild')
        .setDesc('Folder, exclusion, chunking, and model changes require a new index.'),
      draft,
      () => this.renderLegacySettings(),
    );
  }

  private renderSearchDefaults(): void {
    new Setting(this.containerEl)
      .setName('Search defaults')
      .setHeading();
    new Setting(this.containerEl)
      .setName('Default search mode')
      .addDropdown((dropdown) => dropdown
        .addOptions({
          hybrid: 'Hybrid',
          keyword: 'Keywords',
          semantic: 'Semantic',
        })
        .setValue(this.plugin.settings.defaultMode)
        .onChange(async (value) => {
          this.plugin.settings.defaultMode = value as SearchMode;
          await this.plugin.saveSettings();
        }));
    new Setting(this.containerEl)
      .setName('Default term matching')
      .setDesc('Choose all terms, any term, or an exact phrase.')
      .addDropdown((dropdown) => dropdown
        .addOptions({
          all: 'All terms (AND)',
          any: 'Any term (OR)',
          phrase: 'Exact phrase',
        })
        .setValue(this.plugin.settings.defaultMatchMode)
        .onChange(async (value) => {
          this.plugin.settings.defaultMatchMode = value as MatchMode;
          await this.plugin.saveSettings();
        }));
    new Setting(this.containerEl)
      .setName('Default sort order')
      .addDropdown((dropdown) => dropdown
        .addOptions({
          relevance: 'Relevance',
          'modified-desc': 'Modified: newest',
          'modified-asc': 'Modified: oldest',
          'created-desc': 'Created: newest',
          'created-asc': 'Created: oldest',
          'title-asc': 'Title: A–Z',
          'title-desc': 'Title: Z–A',
        })
        .setValue(this.plugin.settings.defaultSort)
        .onChange(async (value) => {
          this.plugin.settings.defaultSort = value as SortOrder;
          await this.plugin.saveSettings();
        }));
    new Setting(this.containerEl)
      .setName('Default result grouping')
      .addDropdown((dropdown) => dropdown
        .addOptions({
          notes: 'Best passage per note',
          passages: 'All passages',
        })
        .setValue(this.plugin.settings.defaultGrouping)
        .onChange(async (value) => {
          this.plugin.settings.defaultGrouping = value as ResultGrouping;
          await this.plugin.saveSettings();
        }));
    this.addResultsPerBatchControl(
      new Setting(this.containerEl)
        .setName('Results per batch')
        .setDesc('Result cards shown initially and added in each batch.'),
    );
  }

  private renderIndexTuning(): void {
    new Setting(this.containerEl)
      .setName('Local indexing')
      .setHeading();
    new Setting(this.containerEl)
      .setName('Automatic incremental indexing')
      .setDesc('Queue changed notes after 10 quiet seconds and update only the affected passages.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoIndex)
        .onChange(async (value) => {
          this.plugin.settings.autoIndex = value;
          await this.plugin.saveSettings();
        }));
    this.addEmbeddingBackendControl(
      new Setting(this.containerEl)
        .setName('Embedding backend')
        .setDesc('ZVec indexes and ranks vectors; MiniLM creates those vectors from note text. Feature hash is a lightweight fallback.'),
    );
    this.addPassageSizeControl(
      new Setting(this.containerEl)
        .setName('Passage size')
        .setDesc('Approximate characters per indexed passage (600–2400).'),
    );
    this.addPassageOverlapControl(
      new Setting(this.containerEl)
        .setName('Passage overlap')
        .setDesc('Characters carried into the next passage (0–400).'),
    );
    new Setting(this.containerEl)
      .setName('Title boost')
      .setDesc('Extra relevance weight when query terms occur in the note title or heading.')
      .addSlider((slider) => slider
        .setLimits(0, 1, 0.05)
        .setValue(this.plugin.settings.titleBoost)
        .onChange(async (value) => {
          this.plugin.settings.titleBoost = value;
          await this.plugin.saveSettings();
        }));
  }

  private renderIndexActions(): void {
    new Setting(this.containerEl)
      .setName('Index status')
      .setHeading();
    this.addIndexActions(
      new Setting(this.containerEl)
        .setName(this.plugin.indexStatus.message)
        .setDesc(this.indexStatusDescription()),
    );
  }

  private addIncludedNotesControl(
    setting: Setting,
    draft: IndexScopeDraft,
    onChange: () => void,
  ): void {
    setting.addDropdown((dropdown) => dropdown
      .addOptions({
        all: 'Entire vault',
        selected: 'Selected top-level folders',
      })
      .setValue(draft.scope)
      .onChange((value) => {
        draft.scope = value as IndexScopeDraft['scope'];
        onChange();
      }));
  }

  private addIncludedFoldersControl(
    setting: Setting,
    draft: IndexScopeDraft,
  ): void {
    setting.addTextArea((text) => text
      .setPlaceholder('Projects\nArchive')
      .setValue(draft.includedFolders)
      .onChange((value) => {
        draft.includedFolders = value;
      }));
  }

  private addExcludedPathsControl(setting: Setting): void {
    setting.addTextArea((text) => text
      .setPlaceholder('.trash/**')
      .setValue(this.plugin.settings.excludePatterns.join('\n'))
      .onChange((value) => {
        this.plugin.settings.excludePatterns = value
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
      }));
  }

  private addApplyScopeControl(
    setting: Setting,
    draft: IndexScopeDraft,
    refresh: () => void,
  ): void {
    setting.addButton((button) => button
      .setButtonText('Save and rebuild')
      .setCta()
      .onClick(() => {
        void this.applyScopeAndRebuild(draft, refresh);
      }));
  }

  private async applyScopeAndRebuild(
    draft: IndexScopeDraft,
    refresh: () => void,
  ): Promise<void> {
    const folders = parseTopLevelFolders(draft.includedFolders);
    if (draft.scope === 'selected' && folders.length === 0) {
      new Notice('Add at least one top-level folder, or choose the whole vault.');
      return;
    }
    this.plugin.settings.indexedFolders =
      draft.scope === 'all' ? [ROOT_FOLDER] : folders;
    await this.plugin.saveSettings();
    await this.plugin.restartRuntimeAndReindex();
    refresh();
  }

  private addResultsPerBatchControl(setting: Setting): void {
    setting.addDropdown((dropdown) => dropdown
      .addOptions({ 10: '10', 20: '20', 50: '50', 100: '100' })
      .setValue(String(this.plugin.settings.resultLimit))
      .onChange(async (value) => {
        this.plugin.settings.resultLimit = Number(value);
        await this.plugin.saveSettings();
      }));
  }

  private addEmbeddingBackendControl(setting: Setting): void {
    setting.addDropdown((dropdown) => dropdown
      .addOptions({
        minilm: 'MiniLM semantic model (recommended)',
        hash: 'Feature hash (no model download)',
      })
      .setValue(this.plugin.settings.embeddingBackend)
      .onChange((value) => {
        this.plugin.settings.embeddingBackend = value as EmbeddingBackend;
      }));
  }

  private addPassageSizeControl(setting: Setting): void {
    setting.addSlider((slider) => slider
      .setLimits(600, 2400, 100)
      .setValue(this.plugin.settings.chunkSize)
      .onChange((value) => {
        this.plugin.settings.chunkSize = value;
      }));
  }

  private addPassageOverlapControl(setting: Setting): void {
    setting.addSlider((slider) => slider
      .setLimits(0, 400, 20)
      .setValue(this.plugin.settings.chunkOverlap)
      .onChange((value) => {
        this.plugin.settings.chunkOverlap = value;
      }));
  }

  private addIndexActions(setting: Setting): void {
    setting
      .addButton((button) => button
        .setButtonText('Incremental reindex')
        .onClick(() => {
          void this.plugin.runSafely(
            'Incremental reindex',
            async () => {
              await this.plugin.ensureRuntimeReady();
              const indexer = this.plugin.indexer;
              if (!indexer) throw new Error('The search runtime is unavailable.');
              await indexer.run(false);
            },
          );
        }))
      .addButton((button) => button
        .setButtonText('Reset and rebuild')
        .onClick(() => {
          void this.plugin.restartRuntimeAndReindex();
        }))
      .addButton((button) => button
        .setButtonText('Cancel')
        .onClick(() => this.plugin.cancelIndexing()));
  }

  private indexStatusDescription(): string {
    return this.plugin.indexStatus.error
      ?? `${this.plugin.indexStatus.passagesIndexed.toLocaleString()} passages stored`;
  }
}
