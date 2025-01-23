import { ShellResult, runCommand } from './shell.js';

const log = (message: string) => console.log(`[lightnet-boot] ${message}`);
const error = (message: string) => console.error(`[lightnet-boot] ${message}`);

export interface LightnetOptions {
  /**
   * Poll interval in seconds (default = 5s).
   */
  pollIntervalSeconds?: number;

  /**
   * Maximum total waiting time in seconds (default = 60s).
   */
  maxWaitTimeSeconds?: number;
}

export enum LightnetStatus {
  Running = 'Running',
  NotReady = 'NotReady',     // Code=1
  NotYetRun = 'NotYetRun',   // Code=0 but "Exit code: 137"
  KilledByOOM = 'KilledByOOM', // Code=0 "Killed by OOM: true"
  GeneralNotRunning = 'GeneralNotRunning', // Code=0 but "Is running: false"
  Unknown = 'Unknown',       // Any other situation
}

export interface LightnetStatusResult {
  status: LightnetStatus;
  raw: ShellResult;
}

/**
 * Calls "zk lightnet status" and returns a structured LightnetStatusResult.
 */
export async function checkLightnetStatus(): Promise<LightnetStatusResult> {
  const raw = await runCommand('zk', ['lightnet', 'status']);
  const exitCode = raw.code ?? -1;

  // Map the exit code to a basic status
  if (exitCode === 1) return { status: LightnetStatus.NotReady, raw };
  if (exitCode !== 0) return { status: LightnetStatus.Unknown, raw };

  // Analyze output for specific conditions if exitCode === 0
  const conditions = [
    { condition: raw.stdout.includes('Is running: true'), status: LightnetStatus.Running },
    { condition: raw.stdout.includes('Exit code: 137'), status: LightnetStatus.NotYetRun },
    { condition: raw.stdout.includes('Killed by OOM: true'), status: LightnetStatus.KilledByOOM },
    { condition: raw.stdout.includes('Is running: false'), status: LightnetStatus.GeneralNotRunning },
  ];

  for (const { condition, status } of conditions) {
    if (condition) return { status, raw };
  }

  // Default to Unknown if no conditions match
  return { status: LightnetStatus.Unknown, raw };
}

/**
 * Runs "zk lightnet start". Handles errors and returns the ShellResult.
 */
export async function startLightnet(): Promise<ShellResult> {
  log('Starting the lightnet: "zk lightnet start"');
  const result = await runCommand('zk', ['lightnet', 'start']);

  if (result.code === 127) {
    error('The "zk" command was not found in PATH. Ensure `zkapp-cli` is installed.');
    throw new Error('Missing "zk" command (exit code 127).');
  }

  if (result.code !== 0) {
    error(`"zk lightnet start" finished with code: ${result.code}`);
    error(`stdout: ${result.stdout}`);
    error(`stderr: ${result.stderr}`);
    throw new Error(`"zk lightnet start" did not succeed (code ${result.code}).`);
  }

  return result;
}

/**
 * Waits for the lightnet to be ready by polling "zk lightnet status".
 */
async function waitForLightnetReady(options: LightnetOptions): Promise<void> {
  const { pollIntervalSeconds = 10, maxWaitTimeSeconds = 360 } = options;
  const startTime = Date.now();
  const maxWaitTimeMs = maxWaitTimeSeconds * 1000;
  const pollIntervalMs = pollIntervalSeconds * 1000;

  log('Waiting for Lightnet to become ready...');

  while (Date.now() - startTime < maxWaitTimeMs) {
    const status = await checkLightnetStatus();

    if (status.status === LightnetStatus.Running) {
      log('Lightnet is now running!');
      return;
    }

    const notReadyStatuses = [LightnetStatus.NotReady, LightnetStatus.NotYetRun, LightnetStatus.GeneralNotRunning];

    if (notReadyStatuses.includes(status.status)) {
      log(`Lightnet not ready yet. Retrying in ${pollIntervalSeconds} seconds...`);
      await sleep(pollIntervalMs);
      continue;
    }

    error(`Unexpected status while waiting for readiness: ${status.status}`);
    throw new Error(`Lightnet readiness failed with status: ${status.status}`);
  }

  error('Timed out while waiting for Lightnet to become ready.');
  throw new Error('Timeout: Lightnet did not become ready within the allotted time.');
}

/**
 * Ensures Lightnet is running, starting it if necessary.
 */
export async function ensureLightnetRunning(
  options: LightnetOptions = {}
): Promise<void> {
  log('Checking current status: "zk lightnet status"');
  const initialStatus = await checkLightnetStatus();

  switch (initialStatus.status) {
    case LightnetStatus.Running:
      log('Lightnet is already running.');
      return;

    case LightnetStatus.NotReady:
      log('Lightnet not ready. Polling for readiness.');
      await waitForLightnetReady(options);
      return;

    case LightnetStatus.NotYetRun:
    case LightnetStatus.GeneralNotRunning:
      log('Lightnet is not running. Starting and waiting for readiness...');
      await startLightnet();
      await waitForLightnetReady(options);
      return;

    case LightnetStatus.KilledByOOM:
      error('Lightnet was killed by OOM. Not attempting to restart.');
      throw new Error('Lightnet was killed by OOM.');

    case LightnetStatus.Unknown:
    default:
      error(`Unexpected status: ${initialStatus.status}`);
      log(`stdout: ${initialStatus.raw.stdout}`);
      log(`stderr: ${initialStatus.raw.stderr}`);
      throw new Error(`Unexpected status from "zk lightnet status": ${initialStatus.status}`);
  }
}

/**
 * Sleeps for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
