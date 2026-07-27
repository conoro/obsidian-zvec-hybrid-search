import assert from 'node:assert/strict';
import test from 'node:test';
import { CHANGE_DEBOUNCE_MS } from '../src/indexing/cadence';
import { SearchSession } from '../src/ui/search-session';

test('automatic indexing waits for a ten-second quiet period', () => {
  assert.equal(CHANGE_DEBOUNCE_MS, 10_000);
});

test('editing or clearing a query invalidates stale search results', () => {
  const session = new SearchSession();
  const generation = session.begin('Obsidian');

  assert.equal(session.isCurrent(generation, 'Obsidian'), true);
  assert.equal(session.invalidateIfInputChanged('Obsidian'), false);
  assert.equal(session.invalidateIfInputChanged(''), true);
  assert.equal(session.hasActiveSearch, false);
  assert.equal(session.isCurrent(generation, 'Obsidian'), false);
});

test('a late response cannot restore results after clear', () => {
  const session = new SearchSession();
  const generation = session.begin('runtime provisioning');

  session.clear();

  assert.equal(
    session.isCurrent(generation, 'runtime provisioning'),
    false,
  );
});
