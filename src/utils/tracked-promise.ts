/**
 * The state of a Promise: pending, fulfilled, or rejected.
 */
export type PromiseState = 'pending' | 'fulfilled' | 'rejected';

/**
 * A custom error class that captures useful information
 * about the associated TrackedPromise, including timestamps
 * and the optional promise ID.
 */
export class TrackedPromiseError extends Error {
  /**
   * The optional ID provided when the TrackedPromise was constructed.
   */
  public readonly promiseId?: string;

  /**
   * The creation time in a human-readable ISO format.
   */
  public readonly creationTime: string;

  /**
   * The settle time in a human-readable ISO format (if settled).
   */
  public readonly settleTime?: string;

  /**
   * The original error (if any) that caused the TrackedPromise to reject.
   */
  public readonly cause?: unknown;

  /**
   * Creates a new TrackedPromiseError.
   *
   * @param id - The optional ID of the TrackedPromise.
   * @param creationTimestamp - The creation timestamp (UNIX ms) of the TrackedPromise.
   * @param settleTimestamp - The settle timestamp (UNIX ms) if the TrackedPromise is settled.
   * @param message - A descriptive error message.
   * @param cause - The original error that caused the promise to reject, if any.
   */
  constructor(
    id: string | undefined,
    creationTimestamp: number,
    settleTimestamp: number | undefined,
    message: string,
    cause?: unknown
  ) {
    // Convert numeric timestamps to human-readable ISO strings
    const creationTime = new Date(creationTimestamp).toISOString();
    const settleTime = settleTimestamp
      ? new Date(settleTimestamp).toISOString()
      : undefined;

    // Construct a user-facing message
    const finalMessage = [
      `TrackedPromiseError: ${message}`,
      `ID: ${id ?? 'N/A'}`,
      `Created: ${creationTime}`,
      `Settled: ${settleTime ?? 'Not settled yet'}`,
    ].join('\n');

    super(finalMessage);
    this.name = 'TrackedPromiseError';
    this.promiseId = id;
    this.creationTime = creationTime;
    this.settleTime = settleTime;
    this.cause = cause;

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TrackedPromiseError);
    }
  }
}

/**
 * A wrapper class that tracks the state of an underlying Promise
 * and provides convenient access to the fulfillment value or rejection reason.
 *
 * @template T The type of the value returned by the wrapped Promise.
 */
export class TrackedPromise<T> {
  /** @internal The internally tracked Promise. */
  private readonly _internalPromise: Promise<T>;
  /** @internal The current state of the wrapped Promise. */
  private _currentState: PromiseState = 'pending';
  /** @internal The fulfillment value of the wrapped Promise, if any. */
  private _resultValue: T | undefined;
  /** @internal The rejection reason of the wrapped Promise, if any. */
  private _errorValue: unknown;

  /**
   * An optional ID for the TrackedPromise, if provided at construction.
   */
  private readonly _id?: string;

  /**
   * The timestamp (in UNIX ms) when this TrackedPromise instance was created.
   */
  private readonly _creationTimestamp: number;

  /**
   * The timestamp (in UNIX ms) when this TrackedPromise settled,
   * or `undefined` if it is still pending.
   */
  private _settleTimestamp?: number;

  /**
   * Creates a new TrackedPromise instance.
   *
   * @param promise - A function returning a Promise to wrap.
   * @param id - (optional) A string identifying this TrackedPromise.
   */
  constructor(promise: () => Promise<T>, id?: string) {
    this._id = id;
    this._creationTimestamp = Date.now();

    this._internalPromise = promise()
      .then((value) => {
        this._currentState = 'fulfilled';
        this._resultValue = value;
        this._settleTimestamp = Date.now();
        return value;
      })
      .catch((err) => {
        this._currentState = 'rejected';
        this._errorValue = err;
        this._settleTimestamp = Date.now();
        throw err;
      });
  }

  /**
   * Returns the current state of the wrapped Promise: 'pending', 'fulfilled', or 'rejected'.
   */
  public get state(): PromiseState {
    return this._currentState;
  }

  /**
   * The optional ID of this TrackedPromise, if one was provided.
   */
  public get id(): string | undefined {
    return this._id;
  }

  /**
   * Convenience property that indicates if the promise is still pending.
   */
  public get isPending(): boolean {
    return this._currentState === 'pending';
  }

  /**
   * Convenience property that indicates if the promise has been fulfilled.
   */
  public get isFulfilled(): boolean {
    return this._currentState === 'fulfilled';
  }

  /**
   * Convenience property that indicates if the promise has been rejected.
   */
  public get isRejected(): boolean {
    return this._currentState === 'rejected';
  }

  /**
   * Returns the fulfillment value of the wrapped Promise if it's fulfilled.
   * @throws Error if the wrapped Promise is not in a fulfilled state.
   */
  public get result(): T {
    if (!this.isFulfilled) {
      if (this.isRejected) {
        throw new Error(
          `The promise rejected with errors: ${this._errorValue}`
        );
      }
      throw new Error(
        `Cannot access result: the Promise is ${this._currentState}.`
      );
    }
    return this._resultValue as T;
  }

  /**
   * Returns the rejection reason of the wrapped Promise if it's rejected.
   * @throws Error if the wrapped Promise is not in a rejected state.
   */
  public get error(): unknown {
    if (!this.isRejected) {
      throw new Error(
        `Cannot access error: the Promise is ${this._currentState}.`
      );
    }
    return this._errorValue;
  }

  /**
   * Returns the timestamp (UNIX ms) when the TrackedPromise was created.
   */
  public get creationTimestamp(): number {
    return this._creationTimestamp;
  }

  /**
   * Returns the timestamp (UNIX ms) when the TrackedPromise settled,
   * or `undefined` if it's still pending.
   */
  public get settleTimestamp(): number | undefined {
    return this._settleTimestamp;
  }

  /**
   * Returns the number of milliseconds elapsed between creation time and settle time (if settled).
   * If the promise is not yet settled, returns the time between creation and now.
   */
  public elapsedTime(): number {
    if (this._settleTimestamp !== undefined) {
      return this._settleTimestamp - this._creationTimestamp;
    }
    return Date.now() - this._creationTimestamp;
  }

  /**
   * Access the underlying Promise. Can be used in `async/await` or with standard Promise methods.
   */
  public get promise(): Promise<T> {
    return this._internalPromise;
  }

  /**
   * Attaches callback(s) for the resolution and/or rejection of the wrapped Promise.
   *
   * @param onFulfilled - Called when the wrapped Promise is fulfilled.
   * @param onRejected - Called when the wrapped Promise is rejected.
   * @returns A standard Promise that resolves or rejects based on the callbacks.
   */
  public then<U>(
    onFulfilled?: (value: T) => U | Promise<U>,
    onRejected?: (reason: unknown) => U | Promise<U>
  ): Promise<U> {
    return this._internalPromise.then(onFulfilled, onRejected);
  }

  /**
   * Attaches a callback for only the rejection of the wrapped Promise.
   *
   * @param onRejected - Called when the wrapped Promise is rejected.
   * @returns A standard Promise that resolves or rejects based on the callback.
   */
  public catch<U>(
    onRejected?: (reason: unknown) => U | Promise<U>
  ): Promise<T | U> {
    return this._internalPromise.catch(onRejected);
  }

  /**
   * Attaches a callback that is called when the wrapped Promise is settled (fulfilled or rejected).
   *
   * @param onFinally - Called when the wrapped Promise is settled.
   * @returns A standard Promise for chaining further operations.
   */
  public finally(onFinally?: () => void): Promise<T> {
    return this._internalPromise.finally(onFinally);
  }

  /**
   * Creates a new TrackedPromiseError containing details about this promise,
   * along with the provided message. The original error (if any) is included as `cause`.
   *
   * @param message - A descriptive error message.
   * @returns A TrackedPromiseError with details from this TrackedPromise.
   */
  public createError(message: string): TrackedPromiseError {
    return new TrackedPromiseError(
      this._id,
      this._creationTimestamp,
      this._settleTimestamp,
      message,
      this._errorValue
    );
  }
}
