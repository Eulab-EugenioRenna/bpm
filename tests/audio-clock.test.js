const test = require('node:test');
const assert = require('node:assert/strict');

const { AudioClockScheduler } = require('../audio-clock.js');

function harness(interval = 0.125) {
  let now = 0;
  let wake = null;
  const scheduled = [];
  const scheduler = new AudioClockScheduler({
    currentTime: () => now,
    interval: () => interval,
    setTimer: callback => { wake = callback; return 1; },
    clearTimer: () => {},
  });

  return {
    scheduled,
    start: () => scheduler.start((time, step) => scheduled.push({ time, step })),
    advanceTo: time => { now = time; const callback = wake; wake = null; callback(); },
  };
}

test('schedules beats on absolute audio-clock timestamps despite late JavaScript wakeups', () => {
  const clock = harness();

  clock.start();
  clock.advanceTo(0.08);
  clock.advanceTo(0.21);

  assert.deepEqual(clock.scheduled, [
    { time: 0.01, step: 0 },
    { time: 0.135, step: 1 },
    { time: 0.26, step: 2 },
  ]);
});

test('skips missed beats instead of playing a burst after a long stall', () => {
  const clock = harness();

  clock.start();
  clock.advanceTo(0.411);

  assert.deepEqual(clock.scheduled, [
    { time: 0.01, step: 0 },
    { time: 0.51, step: 4 },
  ]);
});

test('plays the first beat immediately even while the audio clock is advancing', () => {
  let now = 1;
  const scheduled = [];
  const scheduler = new AudioClockScheduler({
    currentTime: () => { now += 0.001; return now; },
    interval: () => 0.5,
    setTimer: () => 1,
    clearTimer: () => {},
  });

  scheduler.start((time, step) => scheduled.push({ time, step }));

  assert.deepEqual(scheduled, [{ time: 1.011, step: 0 }]);
});

test('retimes the next beat on the audio clock when tempo changes', () => {
  let now = 0;
  let interval = 1;
  let wake = null;
  const scheduled = [];
  const scheduler = new AudioClockScheduler({
    currentTime: () => now,
    interval: () => interval,
    setTimer: callback => { wake = callback; return 1; },
    clearTimer: () => {},
  });
  scheduler.start((time, step) => scheduled.push({ time, step }));

  now = 0.25;
  interval = 0.5;
  scheduler.retime();
  now = 0.531;
  wake();

  assert.deepEqual(scheduled, [
    { time: 0.01, step: 0 },
    { time: 0.63, step: 1 },
  ]);
});

test('invokes native browser timers with the global receiver', () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = function () {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    return 1;
  };
  globalThis.clearTimeout = function () {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
  };

  try {
    const scheduler = new AudioClockScheduler({ currentTime: () => 0, interval: () => 0.5 });
    assert.doesNotThrow(() => scheduler.start(() => {}));
    assert.doesNotThrow(() => scheduler.stop());
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
