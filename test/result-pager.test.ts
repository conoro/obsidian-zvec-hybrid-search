import assert from 'node:assert/strict';
import test from 'node:test';
import { ResultPager } from '../src/ui/result-pager';

test('result pages append every match without duplication', () => {
  const pager = new ResultPager<number>();
  pager.reset(Array.from({ length: 35 }, (_, index) => index + 1));

  const first = pager.next(20);
  assert.deepEqual(first.items, Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(first.shown, 20);
  assert.equal(first.remaining, 15);

  const second = pager.next(20);
  assert.deepEqual(second.items, Array.from({ length: 15 }, (_, index) => index + 21));
  assert.equal(second.shown, 35);
  assert.equal(second.remaining, 0);
});

test('clearing a result pager discards unloaded matches', () => {
  const pager = new ResultPager<number>();
  pager.reset([1, 2, 3]);
  pager.next(1);

  pager.clear();

  assert.deepEqual(pager.next(20), {
    items: [],
    shown: 0,
    remaining: 0,
  });
});
