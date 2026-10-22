export const flush = async () => {for (let i = 0; i < 30; i++) await Promise.resolve();};
export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};
export const plain = value => JSON.parse(JSON.stringify(value));

export class Clock {
  now = 0;
  timers = new Map();
  sequence = 0;
  setTimeout = (callback, delay) => {
    const id = ++this.sequence;
    this.timers.set(id, {at: this.now + Math.max(0, delay), callback});
    return id;
  };
  clearTimeout = id => this.timers.delete(id);
  async tick(ms) {
    const target = this.now + ms;
    while (true) {
      const next = [...this.timers].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      this.now = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
      await flush();
    }
    this.now = target;
    await flush();
  }
}
