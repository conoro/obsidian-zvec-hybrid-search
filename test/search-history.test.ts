import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addSearchHistoryEntry,
  MAX_SEARCH_HISTORY_ITEMS,
  MAX_SEARCH_QUERY_LENGTH,
  normalizeSearchHistory,
  SearchHistoryCursor,
  searchHistoryMenuTitle,
} from '../src/search/history';

test('search history is newest-first, bounded, and case-insensitively unique', () => {
  let history: string[] = [];
  for (let index = 0; index < MAX_SEARCH_HISTORY_ITEMS + 5; index += 1) {
    history = addSearchHistoryEntry(history, `query ${index}`);
  }
  assert.equal(history.length, MAX_SEARCH_HISTORY_ITEMS);
  assert.equal(history[0], `query ${MAX_SEARCH_HISTORY_ITEMS + 4}`);

  history = addSearchHistoryEntry(history, '  QUERY 24  ');
  assert.equal(history[0], 'QUERY 24');
  assert.equal(
    history.filter((query) => query.toLowerCase() === 'query 24').length,
    1,
  );
});

test('persisted history normalization rejects malformed and oversized values', () => {
  const longQuery = 'x'.repeat(MAX_SEARCH_QUERY_LENGTH + 100);
  assert.deepEqual(
    normalizeSearchHistory([null, '', '  Alpha  ', 'alpha', longQuery]),
    ['Alpha', 'x'.repeat(MAX_SEARCH_QUERY_LENGTH)],
  );
  assert.deepEqual(normalizeSearchHistory('not a list'), []);
  assert.equal(searchHistoryMenuTitle('x'.repeat(100)).length, 80);
});

test('arrow navigation restores the draft after walking recent searches', () => {
  const cursor = new SearchHistoryCursor();
  const history = ['newest', 'older'];

  assert.equal(cursor.move(history, 'draft', 'older'), 'newest');
  assert.equal(cursor.move(history, 'newest', 'older'), 'older');
  assert.equal(cursor.move(history, 'older', 'older'), 'older');
  assert.equal(cursor.move(history, 'older', 'newer'), 'newest');
  assert.equal(cursor.move(history, 'newest', 'newer'), 'draft');
  assert.equal(cursor.move(history, 'draft', 'newer'), null);

  cursor.reset();
  assert.equal(cursor.move([], 'draft', 'older'), null);
});
