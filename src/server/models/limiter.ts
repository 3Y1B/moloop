/**
 * A queue in front of a model server: at most `max` calls in flight and `perMinute` started in any 60 s.
 * Spark allows 4 at once and 30 a minute per key, so a burst of reports waits its turn instead of eating 429s.
 * Urgent calls (a volunteer holding the pill or reporting) go ahead of background ones (a festival-goer's request).
 * A call whose `signal` aborts while it waits leaves the queue without using a slot.
 */
export class Limiter {
  private active = 0;
  private started: number[] = [];
  private queue: { go: () => void; urgent: boolean }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private max: number, private perMinute: number) {}

  run<T>(urgent: boolean, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const entry = {
        urgent,
        go: () => {
          signal?.removeEventListener('abort', drop);
          (async () => fn())().then(resolve, reject).finally(() => {
            this.active--;
            this.pump();
          });
        },
      };
      const drop = () => {
        const i = this.queue.indexOf(entry);
        if (i >= 0) this.queue.splice(i, 1);
        reject(signal!.reason);
      };
      signal?.addEventListener('abort', drop, { once: true });
      const at = urgent ? this.queue.findIndex((q) => !q.urgent) : -1;
      if (urgent && at >= 0) this.queue.splice(at, 0, entry);
      else this.queue.push(entry);
      this.pump();
    });
  }

  private pump() {
    const now = Date.now();
    this.started = this.started.filter((t) => now - t < 60_000);
    while (this.queue.length && this.active < this.max && this.started.length < this.perMinute) {
      this.active++;
      this.started.push(now);
      this.queue.shift()!.go();
    }
    // Held back by the per-minute window, not by calls in flight: wake when the oldest start ages out.
    if (this.queue.length && this.active < this.max && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, this.started[0] + 60_000 - now + 5);
    }
  }
}
