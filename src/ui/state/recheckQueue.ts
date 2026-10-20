/**
 * Typing → re-check timing: holds the latest typed text until a pause, and chains every check so
 * `settled()` can wait for all of them. A failed check never blocks the ones after it; `run` and
 * tracked work report their own errors.
 */
export class RecheckQueue {
  private pendingText: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly delayMs: number,
    private readonly run: (text: string) => Promise<void>,
  ) {}

  /** The text as typed; it is checked `delayMs` after the last call. */
  push(text: string): void {
    this.pendingText = text;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.track(this.runPending()), this.delayMs);
  }

  /** Drops typed text that has not been checked yet (a new document replaces it). */
  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pendingText = null;
  }

  /** Adds `work` to the chain that settled() waits for. */
  track(work: Promise<void>): Promise<void> {
    // The chain only orders the waiting: whoever started `work` handles its error.
    this.inFlight = this.inFlight.then(() => work).catch(() => undefined);
    return work;
  }

  /** Checks typed text now instead of after the pause, then waits for every check. */
  async flush(): Promise<void> {
    if (this.pendingText !== null) await this.track(this.runPending());
    await this.settled();
  }

  /** Resolves once no check is running (a pending typing pause is not waited for). */
  async settled(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.inFlight;
      await current;
    } while (current !== this.inFlight);
  }

  private async runPending(): Promise<void> {
    const text = this.pendingText;
    this.cancel();
    if (text !== null) await this.run(text);
  }
}
