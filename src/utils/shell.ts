// shellUtils.ts
import { spawn } from 'child_process';

export interface ShellResult {
  code: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
}

/**
 * Runs a command with given args, collecting stdout and stderr.
 */
export function runCommand(command: string, args: string[]): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(err); // e.g., "zk" is not in PATH
    });

    child.on('close', (code, signal) => {
      resolve({ code, stdout, stderr, signal });
    });
  });
}
