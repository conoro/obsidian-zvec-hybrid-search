import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expectedPassageCount,
  newIndexState,
  persistedIndexIsUsable,
  RECONCILIATION_MTIME_TOLERANCE_MS,
  storedFileMetadataHasChanged,
} from '../src/indexing/index-state';
import {
  DEFAULT_SETTINGS,
  type PersistedIndexState,
} from '../src/types';

test('a compatible persisted index is usable when every passage is present', () => {
  const state = stateWithPassages();

  assert.equal(expectedPassageCount(state), 3);
  assert.equal(
    persistedIndexIsUsable(state, DEFAULT_SETTINGS, 3),
    true,
  );
});

test('a persisted index is rejected when its collection is incomplete', () => {
  const state = stateWithPassages();

  assert.equal(
    persistedIndexIsUsable(state, DEFAULT_SETTINGS, 2),
    false,
  );
  assert.equal(
    persistedIndexIsUsable(null, DEFAULT_SETTINGS, 0),
    false,
  );
});

test('an empty compatible persisted index remains usable', () => {
  const state = newIndexState(DEFAULT_SETTINGS);

  assert.equal(
    persistedIndexIsUsable(state, DEFAULT_SETTINGS, 0),
    true,
  );
});

test('changed indexing settings invalidate the persisted index', () => {
  const state = stateWithPassages();

  assert.equal(
    persistedIndexIsUsable(
      state,
      { ...DEFAULT_SETTINGS, chunkSize: DEFAULT_SETTINGS.chunkSize + 1 },
      3,
    ),
    false,
  );
});

test('startup reconciliation ignores one-millisecond timestamp jitter', () => {
  const saved = { mtime: 1000, size: 50 };

  assert.equal(
    storedFileMetadataHasChanged(
      saved,
      1001,
      50,
      RECONCILIATION_MTIME_TOLERANCE_MS,
    ),
    false,
  );
  assert.equal(
    storedFileMetadataHasChanged(
      saved,
      1002,
      50,
      RECONCILIATION_MTIME_TOLERANCE_MS,
    ),
    true,
  );
});

test('event-driven checks still detect exact timestamp and size changes', () => {
  const saved = { mtime: 1000, size: 50 };

  assert.equal(storedFileMetadataHasChanged(saved, 1001, 50), true);
  assert.equal(storedFileMetadataHasChanged(saved, 1000, 51), true);
  assert.equal(storedFileMetadataHasChanged(saved, 1000, 50), false);
  assert.equal(storedFileMetadataHasChanged(undefined, 1000, 50), true);
});

function stateWithPassages(): PersistedIndexState {
  const state = newIndexState(DEFAULT_SETTINGS);
  state.files = {
    'First.md': {
      mtime: 1000,
      size: 100,
      passageIds: ['first:0'],
    },
    'Second.md': {
      mtime: 2000,
      size: 200,
      passageIds: ['second:0', 'second:1'],
    },
  };
  return state;
}
