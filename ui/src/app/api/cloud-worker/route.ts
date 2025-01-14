import { NextRequest, NextResponse } from "next/server";
import { blockchain, zkCloudWorkerClient } from "zkcloudworker";
import {
  CloudWorkerRequest,
  CloudWorkerResponse,
} from "@/lib/types/cloud-worker";
import { zkcloudworker } from "zkusd";

// Initialize the zkCloudWorkerClient (do this outside the handler to maintain instance)
const api = new zkCloudWorkerClient({
  jwt: process.env.ZKCLOUDWORKER_JWT!,
  zkcloudworker,
  chain: process.env.NEXT_PUBLIC_CHAIN as blockchain,
});

export async function POST(req: NextRequest) {
  try {
    const body: CloudWorkerRequest = await req.json();

    const result = await api.execute({
      developer: "zkusd", // replace with your developer name
      repo: "zkusd", // replace with your repo name
      transactions: body.transactions || [],
      task: body.task,
      args: body.args,
    });

    console.log("response from cloud worker", result);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Cloud worker error:", error);

    const errorResponse: CloudWorkerResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}
