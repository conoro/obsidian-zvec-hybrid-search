// Obsidian provides Window timers; make the same API available in Node tests.
if (typeof window === 'undefined') {
  Object.defineProperty(globalThis, 'window', { value: globalThis });
}
