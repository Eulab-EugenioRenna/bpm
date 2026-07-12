(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AudioClockScheduler = api.AudioClockScheduler;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  class AudioClockScheduler {
    constructor({ currentTime, interval, setTimer = setTimeout, clearTimer = clearTimeout, lookAhead = 0.1, wakeEvery = 25, startLead = 0.01 }) {
      this.currentTime = currentTime;
      this.interval = interval;
      this.setTimer = setTimer;
      this.clearTimer = clearTimer;
      this.lookAhead = lookAhead;
      this.wakeEvery = wakeEvery;
      this.startLead = startLead;
      this.timer = null;
      this.running = false;
      this.nextTime = 0;
      this.step = 0;
      this.lastInterval = 0;
      this.onSchedule = null;
    }

    start(onSchedule) {
      this.stop();
      this.running = true;
      const now = this.currentTime();
      this.nextTime = now + this.startLead;
      this.step = 0;
      this.lastInterval = this.interval();
      this.onSchedule = onSchedule;
      this.tick(now);
    }

    stop() {
      if (this.timer !== null) this.clearTimer(this.timer);
      this.timer = null;
      this.running = false;
    }

    retime() {
      if (!this.running) return;
      const now = this.currentTime();
      while (this.nextTime - this.lastInterval > now) {
        this.nextTime -= this.lastInterval;
        this.step -= 1;
      }
      const previousTime = this.nextTime - this.lastInterval;
      const progress = Math.max(0, Math.min(1, (now - previousTime) / this.lastInterval));
      this.lastInterval = this.interval();
      this.nextTime = now + (1 - progress) * this.lastInterval;
      if (this.timer !== null) this.clearTimer(this.timer);
      this.tick(now);
    }

    tick(now = this.currentTime()) {
      if (!this.running) return;
      while (this.nextTime < now) {
        this.lastInterval = this.interval();
        this.nextTime += this.lastInterval;
        this.step += 1;
      }
      while (this.nextTime < now + this.lookAhead) {
        this.onSchedule(this.nextTime, this.step);
        this.lastInterval = this.interval();
        this.nextTime += this.lastInterval;
        this.step += 1;
      }
      this.timer = this.setTimer(() => this.tick(), this.wakeEvery);
    }
  }

  return { AudioClockScheduler };
});
