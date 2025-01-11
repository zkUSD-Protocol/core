export type CloudWorkerTask = "compile" | "send" | "sendVaultTx";

export interface CloudWorkerRequest {
  task: CloudWorkerTask;
  args: string; // JSON stringified arguments
  transactions?: string[];
}

export interface CloudWorkerResponse {
  success: boolean;
  jobId?: string;
  error?: string;
  result?: any;
}
