import {
  ItemView,
  Keymap,
  MarkdownView,
  Notice,
  TFile,
  type WorkspaceLeaf,
} from 'obsidian';
import type { ZVecPluginApi } from '../plugin-api';
import type {
  IndexStatus,
  MatchMode,
  ResultGrouping,
  SearchMode,
  SearchResponse,
  SearchResult,
  SortOrder,
} from '../types';
import { queryTerms } from '../search/text';

export const VIEW_TYPE_ZVEC_SEARCH = 'zvec-hybrid-search-view';

export class HybridSearchView extends ItemView {
  private queryInput: HTMLInputElement | null = null;
  private mode: SearchMode;
  private matchMode: MatchMode;
  private sort: SortOrder;
  private grouping: ResultGrouping;
  private statusEl: HTMLElement | null = null;
  private progressEl: HTMLProgressElement | null = null;
  private cancelButtonEl: HTMLButtonElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private summaryEl: HTMLElement | null = null;
  private searchButtonEl: HTMLButtonElement | null = null;
  private searchGeneration = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ZVecPluginApi,
  ) {
    super(leaf);
    this.mode = plugin.settings.defaultMode;
    this.matchMode = plugin.settings.defaultMatchMode;
    this.sort = plugin.settings.defaultSort;
    this.grouping = plugin.settings.defaultGrouping;
  }

  getViewType(): string {
    return VIEW_TYPE_ZVEC_SEARCH;
  }

  getDisplayText(): string {
    return 'ZVec Search';
  }

  override getIcon(): string {
    return 'scan-search';
  }

  override async onOpen(): Promise<void> {
    this.renderShell();
    this.updateIndexStatus(this.plugin.indexStatus);
    window.setTimeout(() => this.queryInput?.focus(), 0);
  }

  override async onClose(): Promise<void> {
    this.searchGeneration += 1;
    this.queryInput = null;
    this.searchButtonEl = null;
    this.statusEl = null;
    this.progressEl = null;
    this.cancelButtonEl = null;
    this.resultsEl = null;
    this.summaryEl = null;
  }

  updateIndexStatus(status: IndexStatus): void {
    if (!this.statusEl || !this.progressEl) return;
    this.statusEl.setText(status.error
      ? `${status.message} ${status.error}`
      : status.message);
    const isActive = [
      'loading',
      'scanning',
      'downloading-model',
      'embedding',
      'writing',
      'optimizing',
    ].includes(status.phase);
    this.progressEl.toggleAttribute('hidden', !isActive);
    if (status.total > 0) {
      this.progressEl.max = status.total;
      this.progressEl.value = Math.min(status.completed, status.total);
    } else {
      this.progressEl.removeAttribute('value');
    }
    this.cancelButtonEl?.toggleAttribute('hidden', !isActive);
    this.statusEl.toggleClass('is-error', status.phase === 'error');
  }

  focusSearch(): void {
    this.queryInput?.focus();
    this.queryInput?.select();
  }

  private renderShell(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass('zvec-search-view');

    const searchRow = container.createDiv({ cls: 'zvec-search-row' });
    this.queryInput = searchRow.createEl('input', {
      type: 'search',
      placeholder: 'Search every term…',
      attr: {
        'aria-label': 'Search indexed notes',
        autocomplete: 'off',
        spellcheck: 'false',
      },
    });
    this.searchButtonEl = searchRow.createEl('button', {
      text: 'Search',
      cls: 'mod-cta',
      attr: { 'aria-label': 'Run search' },
    });
    this.searchButtonEl.addEventListener('click', () => void this.runSearch());
    this.queryInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void this.runSearch();
      if (event.key === 'Escape') {
        this.queryInput?.value && (this.queryInput.value = '');
        this.resultsEl?.empty();
        this.summaryEl?.empty();
      }
    });

    const options = container.createEl('details', {
      cls: 'zvec-search-options',
    });
    options.createEl('summary', { text: 'Search options' });
    const controls = options.createDiv({ cls: 'zvec-search-controls' });
    this.mode = this.createSelect<SearchMode>(
      controls,
      'Search mode',
      {
        hybrid: 'Hybrid',
        keyword: 'Keywords',
        semantic: 'Semantic',
      },
      this.mode,
      (value) => { this.mode = value; },
    );
    this.matchMode = this.createSelect<MatchMode>(
      controls,
      'Term matching',
      {
        all: 'All terms (AND)',
        any: 'Any term (OR)',
        phrase: 'Exact phrase',
      },
      this.matchMode,
      (value) => { this.matchMode = value; },
    );
    this.sort = this.createSelect<SortOrder>(
      controls,
      'Sort order',
      {
        relevance: 'Relevance',
        'modified-desc': 'Modified: newest',
        'modified-asc': 'Modified: oldest',
        'created-desc': 'Created: newest',
        'created-asc': 'Created: oldest',
        'title-asc': 'Title: A–Z',
        'title-desc': 'Title: Z–A',
      },
      this.sort,
      (value) => {
        this.sort = value;
        if (this.queryInput?.value.trim()) void this.runSearch();
      },
    );
    this.grouping = this.createSelect<ResultGrouping>(
      controls,
      'Result grouping',
      { notes: 'Best passage per note', passages: 'All passages' },
      this.grouping,
      (value) => {
        this.grouping = value;
        if (this.queryInput?.value.trim()) void this.runSearch();
      },
    );

    const indexBar = container.createDiv({ cls: 'zvec-index-bar' });
    const statusWrap = indexBar.createDiv({ cls: 'zvec-index-state' });
    this.statusEl = statusWrap.createDiv({ cls: 'zvec-index-message' });
    this.progressEl = statusWrap.createEl('progress');
    this.progressEl.hidden = true;
    const actionWrap = indexBar.createDiv({ cls: 'zvec-index-actions' });
    this.cancelButtonEl = actionWrap.createEl('button', {
      text: 'Cancel',
      attr: { 'aria-label': 'Cancel indexing' },
    });
    this.cancelButtonEl.hidden = true;
    this.cancelButtonEl.addEventListener(
      'click',
      () => this.plugin.indexer.cancel(),
    );

    this.summaryEl = container.createDiv({ cls: 'zvec-search-summary' });
    this.resultsEl = container.createDiv({
      cls: 'zvec-search-results',
      attr: { 'aria-live': 'polite' },
    });
  }

  private createSelect<T extends string>(
    container: HTMLElement,
    label: string,
    options: Record<T, string>,
    selected: T,
    onChange: (value: T) => void,
  ): T {
    const wrap = container.createDiv({ cls: 'zvec-control' });
    wrap.createEl('label', { text: label });
    const select = wrap.createEl('select', { attr: { 'aria-label': label } });
    for (const [value, text] of Object.entries(options)) {
      select.createEl('option', {
        value,
        text: String(text),
      });
    }
    select.value = selected;
    select.addEventListener('change', () => onChange(select.value as T));
    return selected;
  }

  private async runSearch(): Promise<void> {
    const query = (this.queryInput?.value.trim() ?? '').slice(0, 1000);
    if (!query || !this.resultsEl || !this.summaryEl) return;
    if (this.queryInput && this.queryInput.value !== query) {
      this.queryInput.value = query;
    }
    const generation = ++this.searchGeneration;
    if (this.searchButtonEl) this.searchButtonEl.disabled = true;
    this.resultsEl.empty();
    this.resultsEl.createDiv({ cls: 'zvec-search-loading', text: 'Searching…' });
    this.summaryEl.setText('');

    try {
      const response = await this.plugin.engine.search({
        query,
        mode: this.mode,
        matchMode: this.matchMode,
        sort: this.sort,
        grouping: this.grouping,
        limit: this.plugin.settings.resultLimit,
      });
      if (generation !== this.searchGeneration) return;
      this.renderResults(query, response);
    } catch (error) {
      if (generation !== this.searchGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      this.resultsEl.empty();
      this.resultsEl.createDiv({
        cls: 'zvec-search-empty is-error',
        text: `Search failed: ${message}`,
      });
    } finally {
      if (generation === this.searchGeneration && this.searchButtonEl) {
        this.searchButtonEl.disabled = false;
      }
    }
  }

  private renderResults(query: string, response: SearchResponse): void {
    if (!this.resultsEl || !this.summaryEl) return;
    this.resultsEl.empty();
    this.summaryEl.setText(
      `${response.total.toLocaleString()} result${response.total === 1 ? '' : 's'} · ${Math.round(response.elapsedMs)} ms`,
    );
    if (response.results.length === 0) {
      this.resultsEl.createDiv({
        cls: 'zvec-search-empty',
        text: this.matchMode === 'all'
          ? 'No note contains every term. Try Semantic or Any term mode.'
          : 'No matching notes found.',
      });
      return;
    }
    const terms = queryTerms(query)
      .slice(0, 50)
      .map((term) => term.slice(0, 100));
    for (const result of response.results) {
      this.renderResult(result, terms);
    }
  }

  private renderResult(result: SearchResult, terms: string[]): void {
    if (!this.resultsEl) return;
    const card = this.resultsEl.createEl('button', {
      cls: 'zvec-result',
      attr: { type: 'button' },
    });
    const header = card.createDiv({ cls: 'zvec-result-header' });
    const title = header.createDiv({ cls: 'zvec-result-title' });
    appendHighlighted(title, result.title, terms);
    if (result.heading) {
      const heading = header.createDiv({ cls: 'zvec-result-heading' });
      appendHighlighted(heading, result.heading, terms);
    }
    header.createSpan({
      cls: 'zvec-result-score',
      text: `${Math.round(result.score * 100)}%`,
    });
    card.createDiv({ cls: 'zvec-result-path', text: result.path });
    const preview = card.createDiv({ cls: 'zvec-result-preview' });
    appendHighlighted(preview, result.preview, terms);
    const metadata = card.createDiv({ cls: 'zvec-result-meta' });
    metadata.createSpan({
      text: `Modified ${new Date(result.mtime).toLocaleDateString()}`,
    });
    if (result.lexicalScore !== undefined && result.semanticScore !== undefined) {
      metadata.createSpan({
        text: `BM25 ${Math.round(result.lexicalScore * 100)} · semantic ${Math.round(result.semanticScore * 100)}`,
      });
    }
    card.addEventListener('click', (event) => {
      void this.openResult(result, Boolean(Keymap.isModEvent(event))).catch(
        (error) => {
          console.error('ZVec Hybrid Search could not open a result', error);
          new Notice(`Could not open ${result.path}`);
        },
      );
    });
  }

  private async openResult(result: SearchResult, newLeaf: boolean): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(result.path);
    if (!(file instanceof TFile)) {
      new Notice(`Note no longer exists: ${result.path}`);
      return;
    }
    const leaf = this.app.workspace.getLeaf(newLeaf);
    await leaf.openFile(file);
    if (leaf.view instanceof MarkdownView) {
      leaf.view.editor.setCursor({ line: result.startLine, ch: 0 });
      leaf.view.editor.scrollIntoView({
        from: { line: result.startLine, ch: 0 },
        to: { line: result.startLine, ch: 0 },
      }, true);
    }
  }
}

function appendHighlighted(
  container: HTMLElement,
  text: string,
  terms: string[],
): void {
  if (terms.length === 0) {
    container.appendText(text);
    return;
  }
  const escaped = terms
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) {
    container.appendText(text);
    return;
  }
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  for (const part of text.split(pattern)) {
    if (!part) continue;
    if (pattern.test(part)) container.createEl('mark', { text: part });
    else container.appendText(part);
    pattern.lastIndex = 0;
  }
}
