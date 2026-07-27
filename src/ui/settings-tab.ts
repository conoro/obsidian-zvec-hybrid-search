import {
  Notice,
  PluginSettingTab,
  Setting,
} from 'obsidian';
import type { ZVecPluginApi } from '../plugin-api';
import { parseTopLevelFolders } from '../settings';
import {
  ROOT_FOLDER,
  type EmbeddingBackend,
  type MatchMode,
  type ResultGrouping,
  type SearchMode,
  type SortOrder,
} from '../types';

export class ZVecSearchSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: ZVecPluginApi) {
    super(plugin.app, plugin as never);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName('ZVec Hybrid Search')
      .setHeading();
    containerEl.createEl('p', {
      text: 'Vault text, embeddings, and index files stay local. The verified desktop runtime and semantic model are downloaded once and cached locally.',
      cls: 'setting-item-description',
    });

    this.renderIndexScope();
    this.renderSearchDefaults();
    this.renderIndexTuning();
    this.renderIndexActions();
  }

  private renderIndexScope(): void {
    new Setting(this.containerEl)
      .setName('Index scope')
      .setHeading();
    let scope: 'all' | 'selected' =
      this.plugin.settings.indexedFolders.includes(ROOT_FOLDER)
        ? 'all'
        : 'selected';
    let includedFolders = scope === 'selected'
      ? this.plugin.settings.indexedFolders.join('\n')
      : '';
    let includedFoldersSetting: Setting | null = null;

    new Setting(this.containerEl)
      .setName('Included notes')
      .setDesc('Index the entire vault or only selected top-level folders.')
      .addDropdown((dropdown) => dropdown
        .addOptions({
          all: 'Entire vault',
          selected: 'Selected top-level folders',
        })
        .setValue(scope)
        .onChange((value) => {
          scope = value as typeof scope;
          if (includedFoldersSetting) {
            includedFoldersSetting.settingEl.toggleClass(
              'zvec-setting-hidden',
              scope === 'all',
            );
          }
        }));

    includedFoldersSetting = new Setting(this.containerEl)
      .setName('Included top-level folders')
      .setDesc('One vault-relative folder name per line. No filesystem paths are used.')
      .addTextArea((text) => text
        .setPlaceholder('Projects\nArchive')
        .setValue(includedFolders)
        .onChange((value) => {
          includedFolders = value;
        }));
    includedFoldersSetting.settingEl.toggleClass(
      'zvec-setting-hidden',
      scope === 'all',
    );

    new Setting(this.containerEl)
      .setName('Excluded paths')
      .setDesc('One vault-relative glob per line. ** crosses folder boundaries.')
      .addTextArea((text) => text
        .setPlaceholder('.trash/**')
        .setValue(this.plugin.settings.excludePatterns.join('\n'))
        .onChange((value) => {
          this.plugin.settings.excludePatterns = value
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        }));

    new Setting(this.containerEl)
      .setName('Apply scope and rebuild')
      .setDesc('Folder, exclusion, chunking, and model changes require a new index.')
      .addButton((button) => button
        .setButtonText('Save and rebuild')
        .setCta()
        .onClick(async () => {
          const folders = parseTopLevelFolders(includedFolders);
          if (scope === 'selected' && folders.length === 0) {
            new Notice('Add at least one top-level folder, or select Entire vault.');
            return;
          }
          this.plugin.settings.indexedFolders =
            scope === 'all' ? [ROOT_FOLDER] : folders;
          await this.plugin.saveSettings();
          await this.plugin.restartRuntimeAndReindex();
          this.display();
        }));
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
    new Setting(this.containerEl)
      .setName('Results shown')
      .setDesc('Maximum result cards shown for a search.')
      .addDropdown((dropdown) => dropdown
        .addOptions({ 10: '10', 20: '20', 50: '50', 100: '100' })
        .setValue(String(this.plugin.settings.resultLimit))
        .onChange(async (value) => {
          this.plugin.settings.resultLimit = Number(value);
          await this.plugin.saveSettings();
        }));
  }

  private renderIndexTuning(): void {
    new Setting(this.containerEl)
      .setName('Local indexing')
      .setHeading();
    new Setting(this.containerEl)
      .setName('Automatic incremental indexing')
      .setDesc('Queue changed notes after 1.2 seconds; optimize after 45 idle seconds.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoIndex)
        .onChange(async (value) => {
          this.plugin.settings.autoIndex = value;
          await this.plugin.saveSettings();
        }));
    new Setting(this.containerEl)
      .setName('Embedding backend')
      .setDesc('ZVec indexes and ranks vectors; MiniLM creates those vectors from note text. Feature hash is a lightweight fallback.')
      .addDropdown((dropdown) => dropdown
        .addOptions({
          minilm: 'MiniLM semantic model (recommended)',
          hash: 'Feature hash (no model download)',
        })
        .setValue(this.plugin.settings.embeddingBackend)
        .onChange((value) => {
          this.plugin.settings.embeddingBackend = value as EmbeddingBackend;
        }));
    new Setting(this.containerEl)
      .setName('Passage size')
      .setDesc('Approximate characters per indexed passage (600–2400).')
      .addSlider((slider) => slider
        .setLimits(600, 2400, 100)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.chunkSize)
        .onChange((value) => {
          this.plugin.settings.chunkSize = value;
        }));
    new Setting(this.containerEl)
      .setName('Passage overlap')
      .setDesc('Characters carried into the next passage (0–400).')
      .addSlider((slider) => slider
        .setLimits(0, 400, 20)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.chunkOverlap)
        .onChange((value) => {
          this.plugin.settings.chunkOverlap = value;
        }));
    new Setting(this.containerEl)
      .setName('Title boost')
      .setDesc('Extra relevance weight when query terms occur in the note title or heading.')
      .addSlider((slider) => slider
        .setLimits(0, 1, 0.05)
        .setDynamicTooltip()
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
    new Setting(this.containerEl)
      .setName(this.plugin.indexStatus.message)
      .setDesc(this.plugin.indexStatus.error ?? `${this.plugin.indexStatus.passagesIndexed.toLocaleString()} passages stored`)
      .addButton((button) => button
        .setButtonText('Incremental reindex')
        .onClick(() => this.plugin.runSafely(
          'Incremental reindex',
          async () => {
            await this.plugin.ensureRuntimeReady();
            const indexer = this.plugin.indexer;
            if (!indexer) throw new Error('The search runtime is unavailable.');
            await indexer.run(false);
          },
        )))
      .addButton((button) => button
        .setButtonText('Reset and rebuild')
        .setWarning()
        .onClick(() => this.plugin.restartRuntimeAndReindex()))
      .addButton((button) => button
        .setButtonText('Cancel')
        .onClick(() => this.plugin.cancelIndexing()));
  }
}
