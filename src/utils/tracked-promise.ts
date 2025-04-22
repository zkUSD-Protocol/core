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
    message: any,
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
 * Represents a signal that instructs a TrackedPromise to settle at specific "abort sites."
 *
 * Possible variants:
 * - `{ resolveWith: T }`: forces the promise to resolve with the given value.
 * - `{ rejectWith: any }`: forces the promise to reject with the given error or reason.
 * - `{ settleFast: 'settleFast' }`: a meta-signal that defers the final settle decision
 *   to a secondary (suggested) signal if present, or defaults to rejecting with
 *   a generic "Aborted" error.
 */
export type SettleSignal<T> =
  | { resolveWith: T }
  | { rejectWith: any }
  | { settleFast: 'settleFast' };

/**
 * An interface for cooperative abort handling. Provides methods for:
 * - Checking if an abort signal is present.
 * - Marking an "abort site," where the calling code can either resolve or reject
 *   early based on the signal.
 */
export interface AbortApi<T> {
  /**
   * Returns the current abort signal, if one is set.
   * User code may check this at certain points (abort sites) to decide
   * whether to terminate or continue.
   */
  pollAbortSignal: () => SettleSignal<T> | undefined;

  /**
   * Declares an abort site and optionally provides a suggested abort signal.
   * If an abort signal is active, this method returns an object or throws an error
   * to prematurely settle the promise.
   *
   * @param suggestedSignal - A secondary signal that may override or complement
   *   the existing abort signal if `settleFast` is used.
   * @returns An object with `resolveWith` if the promise should resolve immediately,
   *   or `undefined` if no abort action is necessary. If the signal forces rejection,
   *   this method throws a `TrackedPromiseError`.
   */
  markAbortSite: (
    suggestedSignal?: SettleSignal<T>
  ) => { resolveWith: T } | undefined;

  // this will be triggered by setting the abort signal unless its resolveWith
  installRejector: (rejector: (reason: any) => void) => void;
}

export function convertToNonResolvable<T>(a: AbortApi<T>): AbortApi<any> {
  const pollAbortSignal: () => SettleSignal<any> | undefined =
    a.pollAbortSignal;
  const markAbortSite: (suggestedSignal?: SettleSignal<any>) => undefined = (
    sig
  ) => {
    a.markAbortSite(sig);
  };
  const installRejector: (rejector: (reason: any) => void) => void =
    a.installRejector;
  return { pollAbortSignal, markAbortSite, installRejector };
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
   * Holds the currently active abort signal, if any. When present,
   * the promise may be aborted at the nearest "abort site."
   */
  private _abortSignal: SettleSignal<T> | undefined;

  // /**
  //  */
  private _rejectors: ((reason: any) => void)[] = [];

  /**
   * Creates a new TrackedPromise instance.
   *
   * @param promise - A function returning a Promise to wrap.
   * @param id - (optional) A string identifying this TrackedPromise.
   */
  constructor(
    promise: (args: { abortApi: AbortApi<T> }) => Promise<T>,
    id?: string
  ) {
    this._id = id;
    this._creationTimestamp = Date.now();

    const self = this;
    const abortApi: AbortApi<T> = {
      pollAbortSignal: () => self._abortSignal,
      markAbortSite: (suggestedSignal?: SettleSignal<T>) => {
        return self.handleAbortSite(suggestedSignal)();
      },
      installRejector: (rejector: (reason: any) => void) => {
        this._rejectors.push(rejector);
      },
    };

    this._internalPromise = promise({ abortApi })
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
   * Assigns or updates the active abort signal for this TrackedPromise.
   * Future calls to `abortApi.markAbortSite()` can then trigger an early
   * settle (resolve or reject) if the signal demands it.
   *
   * @param signal - The new abort signal, or undefined to remove it.
   */
  public setAbortSignal(signal?: SettleSignal<T> | undefined, msg?: string) {
    this._abortSignal = signal;
    if (signal === undefined) {
      return;
    }
    if ('rejectWith' in signal || 'settleFast' in signal) {
      for (const rejector of this._rejectors) {
        rejector(msg ?? 'Rejected via an abort signal.');
      }
    }
  }

  /**
   * Internal helper that returns a function to handle an abort signal
   * at a specific "abort site."
   *
   * - If `_abortSignal` is unset, returns a no-op function.
   * - If `_abortSignal` is a `{ resolveWith: ... }`, returns a function
   *   that resolves immediately with that value.
   * - If `_abortSignal` is a `{ rejectWith: ... }`, throws a tracked error.
   * - If `_abortSignal` is `{ settleFast: 'settleFast' }`, it attempts
   *   to use `suggestedSignal` to decide how to settle. If none is provided,
   *   it defaults to a rejection.
   *
   * @param suggestedSignal - An optional secondary signal used only in
   *   the `settleFast` case.
   * @returns A function that either resolves, throws, or does nothing,
   *   depending on the current `_abortSignal`.
   */
  private handleAbortSite(
    suggestedSignal?: SettleSignal<T>
  ): () => { resolveWith: T } | undefined {
    const signal = this._abortSignal;
    if (signal === undefined) {
      return () => undefined;
    } else if ('resolveWith' in signal) {
      return () => {
        return { resolveWith: signal.resolveWith };
      };
    } else if ('rejectWith' in signal) {
      return () => {
        throw this.createError(signal.rejectWith);
      };
    } else if ('settleFast' in signal) {
      if (suggestedSignal !== undefined && 'resolveWith' in suggestedSignal) {
        return () => {
          return { resolveWith: suggestedSignal.resolveWith };
        };
      } else if (
        suggestedSignal !== undefined &&
        'rejectWith' in suggestedSignal
      ) {
        return () => {
          throw this.createError(suggestedSignal.rejectWith);
        };
      } else {
        return () => {
          throw this.createError('Aborted');
        };
      }
    } else {
      throw new Error('Invalid abort signal');
    }
  }

  public thenTracked<U>(
    nextComputation: (
      parentValue: T,
      extra: { abortApi: AbortApi<U> }
    ) => Promise<U>,
    childId?: string
  ): TrackedPromise<U> {
    const self = this;
    return new TrackedPromise<U>(async ({ abortApi }) => {
      // Wait for the parent to settle
      await self._internalPromise;

      // Call the child computation with the transformed value
      return nextComputation(self.result, { abortApi });
    }, childId);
  }

  /**
   * Creates a new TrackedPromiseError containing details about this promise,
   * along with the provided message. The original error (if any) is included as `cause`.
   *
   * @param message - A descriptive error message.
   * @returns A TrackedPromiseError with details from this TrackedPromise.
   */
  public createError(message: any): TrackedPromiseError {
    return new TrackedPromiseError(
      this._id,
      this._creationTimestamp,
      this._settleTimestamp,
      message,
      this._errorValue
    );
  }
}
