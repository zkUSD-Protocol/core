/**
 * The state of a Promise: pending, fulfilled, or rejected.
 */
export type PromiseState = "pending" | "fulfilled" | "rejected";

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
  private _currentState: PromiseState = "pending";
  /** @internal The fulfillment value of the wrapped Promise, if any. */
  private _resultValue: T | undefined;
  /** @internal The rejection reason of the wrapped Promise, if any. */
  private _errorValue: unknown;

  /**
   * Creates a new TrackedPromise instance.
   *
   * @param promise The Promise to wrap.
   */
  constructor(promise: () => Promise<T>) {
    this._internalPromise = promise()
      .then((value) => {
        this._currentState = "fulfilled";
        this._resultValue = value;
        return value;
      })
      .catch((err) => {
        this._currentState = "rejected";
        this._errorValue = err;
        throw err;
      });
  }

  /**
   * Returns the current state of the wrapped Promise.
   */
  public get state(): PromiseState {
    return this._currentState;
  }

  /**
   * Convenience property that indicates if the promise is still pending.
   */
  public get isPending(): boolean {
    return this._currentState === "pending";
  }

  /**
   * Convenience property that indicates if the promise has been fulfilled.
   */
  public get isFulfilled(): boolean {
    return this._currentState === "fulfilled";
  }

  /**
   * Convenience property that indicates if the promise has been rejected.
   */
  public get isRejected(): boolean {
    return this._currentState === "rejected";
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
   * Access the underlying Promise. Can be used in `async/await` or with standard Promise methods.
   */
  public get promise(): Promise<T> {
    return this._internalPromise;
  }

  /**
   * Attaches callback(s) for the resolution and/or rejection of the wrapped Promise.
   *
   * @param onFulfilled Called when the wrapped Promise is fulfilled.
   * @param onRejected Called when the wrapped Promise is rejected.
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
   * @param onRejected Called when the wrapped Promise is rejected.
   * @returns A standard Promise that resolves or rejects based on the callbacks.
   */
  public catch<U>(
    onRejected?: (reason: unknown) => U | Promise<U>
  ): Promise<T | U> {
    return this._internalPromise.catch(onRejected);
  }

  /**
   * Attaches a callback that is called when the wrapped Promise is settled (fulfilled or rejected).
   *
   * @param onFinally Called when the wrapped Promise is settled.
   * @returns A standard Promise for chaining further operations.
   */
  public finally(onFinally?: () => void): Promise<T> {
    return this._internalPromise.finally(onFinally);
  }
}
