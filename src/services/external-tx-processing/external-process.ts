/**
 * Represents an abstract external prover “worker”.
 * Instead of directly spawning a Node script, any implementation
 * can define how to start, stop, and monitor the worker lifecycle.
 */
export interface ExternalProcess {
  /**
   * Identifier for this prover instance.
   */
  get proverId(): string;

  /**
   * Spawns or starts the worker process/service with the given serverUrl.
   * Optionally takes a workerIndex for logging or identification.
   */
  spawn(serverUrl: string, workerIndex?: number): void;

  /**
   * Registers a callback to be invoked whenever the worker exits (normally or abnormally).
   * @param callback - A function called with `(exitCode, signal)` when the process/service exits.
   */
  onExit(
    callback: (exitCode: number | null, signal: string | null) => void
  ): void;

  /**
   * Stops the worker, sending a graceful termination signal if supported.
   */
  stop(): void;
}
