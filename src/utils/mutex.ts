/**
 * A Mutex (mutual exclusion) implementation to ensure only one task
 * runs in the critical section at a time.
 */
export class Mutex {
  public constructor(private _debugName?: string) {}

  private locked: boolean = false; // Indicates if the mutex is currently locked
  private waiting: (() => void)[] = []; // Queue of waiting tasks

  private debugLog(message: string): void {
    if (this._debugName) {
      console.log(`[Mutex:${this._debugName}] ${message}`);
    }
  }

  /**
   * Acquires the mutex, blocking execution until the mutex is available.
   * If the mutex is already locked, the method will wait until it is released.
   *
   * @returns A promise that resolves when the mutex is acquired.
   */
  async acquire(): Promise<void> {
    const callSite = new Error().stack?.split('\n')[3]?.trim(); // Get the caller

    this.debugLog(`Acquiring mutex (Called from: ${callSite})`);

    if (this.locked) {
      this.debugLog(
        `Acquiring mutex - Locked. Waiting... (Caller: ${callSite})`
      );
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }

    this.locked = true; // Lock the mutex
    this.debugLog(`Acquiring mutex - Success (Caller: ${callSite})`);
  }

  /**
   * Releases the mutex, allowing the next waiting task to proceed.
   * Throws an error if the mutex is not currently locked.
   */
  release(): void {
    this.debugLog('Releasing mutex');
    if (!this.locked) {
      throw new Error('Cannot release a mutex that is not locked');
    }

    // If there are tasks waiting, wake up the next task in the queue
    const next = this.waiting.shift();
    if (next) {
      this.debugLog('Releasing mutex- Waking up next task in the queue');
      next();
    } else {
      this.debugLog('Releasing mutex- empty - release');
      this.locked = false;
    }
  }

  /**
   * Executes a given callback function within a locked mutex context.
   * Ensures the mutex is acquired before running the callback and released afterward,
   * even if the callback throws an error.
   *
   * @template T The return type of the callback function.
   * @param callback A function to execute in the critical section.
   * @returns A promise that resolves with the return value of the callback.
   */
  async runExclusive<T>(callback: () => Promise<T> | T): Promise<T> {
    await this.acquire(); // Acquire the mutex
    try {
      // Execute the critical section
      return await callback();
    } finally {
      // Ensure the mutex is released even if an error occurs
      this.release();
    }
  }
}
