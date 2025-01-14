"use client";

import { createContext, useContext, useEffect } from "react";
import {
  CloudWorkerRequest,
  CloudWorkerResponse,
} from "@/lib/types/cloud-worker";
import { blockchain, fetchMinaAccount, initBlockchain } from "zkcloudworker";
import { PublicKey } from "o1js";

interface CloudWorkerContextProps {
  executeTransaction: (
    request: CloudWorkerRequest
  ) => Promise<CloudWorkerResponse>;
}

const CloudWorkerContext = createContext<CloudWorkerContextProps | null>(null);

export const useCloudWorker = () => {
  const context = useContext(CloudWorkerContext);
  if (!context) {
    throw new Error("useCloudWorker must be used within a CloudWorkerProvider");
  }
  return context;
};

export const CloudWorkerProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const initializeNetwork = async () => {
    await initBlockchain(process.env.NEXT_PUBLIC_CHAIN! as blockchain);
  };

  useEffect(() => {
    initializeNetwork();
  }, []);

  const executeTransaction = async (
    request: CloudWorkerRequest
  ): Promise<CloudWorkerResponse> => {
    try {
      const response = await fetch("/api/cloud-worker", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error("Network response was not ok");
      }

      return await response.json();
    } catch (error) {
      console.error("Error executing transaction:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  };

  return (
    <CloudWorkerContext.Provider value={{ executeTransaction }}>
      {children}
    </CloudWorkerContext.Provider>
  );
};
