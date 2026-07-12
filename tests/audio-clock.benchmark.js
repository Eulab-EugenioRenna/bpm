const { performance } = require('node:perf_hooks');
const { AudioClockScheduler } = require('../audio-clock.js');

const durationMs = 120_000;
const interval = 0.125;
const wakeDelays = [];
const scheduleLeads = [];
const gridErrors = [];
let expectedWake = 0;
let firstTime = null;
let previousStep = -1;
let skippedSteps = 0;

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] || 0;
};

const scheduler = new AudioClockScheduler({
  currentTime: () => performance.now() / 1000,
  interval: () => interval,
  setTimer: (callback, delay) => {
    expectedWake = performance.now() + delay;
    return setTimeout(() => {
      wakeDelays.push(Math.max(0, performance.now() - expectedWake));
      callback();
    }, delay);
  },
  clearTimer: clearTimeout,
});

scheduler.start((time, step) => {
  const now = performance.now() / 1000;
  if (firstTime === null) firstTime = time;
  if (previousStep >= 0 && step > previousStep + 1) skippedSteps += step - previousStep - 1;
  previousStep = step;
  scheduleLeads.push((time - now) * 1000);
  gridErrors.push(Math.abs(time - (firstTime + step * interval)) * 1000);
});

const stallTimer = setInterval(() => {
  const until = performance.now() + 45;
  while (performance.now() < until) {}
}, 5_000);

setTimeout(() => {
  clearInterval(stallTimer);
  scheduler.stop();
  const result = {
    durationSeconds: durationMs / 1000,
    bpm: 120,
    subdivision: '1/16',
    scheduledEvents: scheduleLeads.length,
    skippedSteps,
    jsWakeDelayMs: {
      p95: Number(percentile(wakeDelays, 0.95).toFixed(3)),
      max: Number(Math.max(...wakeDelays).toFixed(3)),
    },
    audioScheduleLeadMs: {
      min: Number(Math.min(...scheduleLeads).toFixed(3)),
      p95: Number(percentile(scheduleLeads, 0.95).toFixed(3)),
    },
    audioGridErrorMs: {
      max: Number(Math.max(...gridErrors).toFixed(6)),
    },
  };
  console.log(JSON.stringify(result, null, 2));
  if (skippedSteps > 0 || result.audioGridErrorMs.max > 0.001 || result.audioScheduleLeadMs.min < 0) process.exitCode = 1;
}, durationMs);
