import assert from 'node:assert/strict';
import test from 'node:test';
import { modifiedDateRangeFromInputs } from '../src/search/date-range';

test('an empty modified-date range means all dates', () => {
  assert.deepEqual(modifiedDateRangeFromInputs('', ''), {});
});

test('From alone runs from local midnight through now', () => {
  const now = Date.now();
  const range = modifiedDateRangeFromInputs('2026-07-01', '', now);
  assert.equal(range.modifiedFrom, localMidnight(2026, 6, 1));
  assert.equal(range.modifiedTo, now);
});

test('To alone includes the entire selected local day', () => {
  const range = modifiedDateRangeFromInputs('', '2026-07-31');
  assert.equal(range.modifiedFrom, undefined);
  assert.equal(range.modifiedTo, localMidnight(2026, 7, 1) - 1);
});

test('From and To may name the same day', () => {
  const range = modifiedDateRangeFromInputs('2026-07-31', '2026-07-31');
  assert.equal(range.modifiedFrom, localMidnight(2026, 6, 31));
  assert.equal(range.modifiedTo, localMidnight(2026, 7, 1) - 1);
});

test('a reversed modified-date range is rejected', () => {
  assert.throws(
    () => modifiedDateRangeFromInputs('2026-08-01', '2026-07-31'),
    /From date must be on or before the To date/,
  );
});

function localMidnight(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month, day);
  return date.getTime();
}
