export const MAX_SEARCH_HISTORY_ITEMS = 20;
export const MAX_SEARCH_QUERY_LENGTH = 1000;

export function normalizeSearchHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const history: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const query = normalizeQuery(item);
    const key = query.toLowerCase();
    if (!query || seen.has(key)) continue;
    history.push(query);
    seen.add(key);
    if (history.length >= MAX_SEARCH_HISTORY_ITEMS) break;
  }
  return history;
}

export function addSearchHistoryEntry(
  history: readonly string[],
  value: string,
): string[] {
  const query = normalizeQuery(value);
  if (!query) return normalizeSearchHistory(history);
  return normalizeSearchHistory([
    query,
    ...history.filter((item) => item.toLowerCase() !== query.toLowerCase()),
  ]);
}

export function searchHistoryMenuTitle(query: string): string {
  return query.length <= 80 ? query : `${query.slice(0, 79)}…`;
}

export class SearchHistoryCursor {
  private index = -1;
  private draft = '';

  reset(): void {
    this.index = -1;
    this.draft = '';
  }

  move(
    history: readonly string[],
    currentValue: string,
    direction: 'older' | 'newer',
  ): string | null {
    if (history.length === 0) return null;
    if (direction === 'older') {
      if (this.index === -1) this.draft = currentValue;
      if (this.index < history.length - 1) this.index += 1;
      return history[this.index] ?? currentValue;
    }
    if (this.index === -1) return null;
    this.index -= 1;
    return this.index === -1
      ? this.draft
      : history[this.index] ?? this.draft;
  }
}

function normalizeQuery(value: string): string {
  return value.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
}
