import assert from 'node:assert/strict';
import test from 'node:test';
import { resultActivationFor } from '../src/ui/result-activation';

function event(
  type: string,
  button: number,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {},
) {
  return {
    type,
    button,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
  };
}

test('a primary click opens a result in the current tab', () => {
  assert.deepEqual(resultActivationFor(event('click', 0)), {
    newTab: false,
    preventDefault: false,
  });
});

test('Command-click and Control-click open a result in a new tab', () => {
  assert.equal(
    resultActivationFor(event('click', 0, { metaKey: true }))?.newTab,
    true,
  );
  assert.equal(
    resultActivationFor(event('click', 0, { ctrlKey: true }))?.newTab,
    true,
  );
});

test('a middle click opens a result in a new tab and suppresses browser handling', () => {
  assert.deepEqual(resultActivationFor(event('auxclick', 1)), {
    newTab: true,
    preventDefault: true,
  });
});

test('right click and unrelated auxiliary events do not open a result', () => {
  assert.equal(resultActivationFor(event('auxclick', 2)), null);
  assert.equal(resultActivationFor(event('click', 1)), null);
});
