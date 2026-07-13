const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadWorker() {
  const handlers = {};
  const context = {
    URL,
    self: {
      location: { origin: 'https://bpm.local' },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
      addEventListener(type, handler) {
        handlers[type] = handler;
      },
    },
    caches: {
      open: async () => ({ addAll: async () => {}, put: async () => {} }),
      keys: async () => [],
      delete: async () => {},
      match: async () => undefined,
    },
    fetch: async () => ({ clone: () => ({}) }),
  };

  vm.runInNewContext(fs.readFileSync('sw.js', 'utf8'), context);
  return handlers;
}

test('ignores browser-extension requests that Cache Storage cannot store', () => {
  const handlers = loadWorker();
  let intercepted = false;

  handlers.fetch({
    request: { method: 'GET', url: 'chrome-extension://example/content.js' },
    respondWith() { intercepted = true; },
  });

  assert.equal(intercepted, false);
});
