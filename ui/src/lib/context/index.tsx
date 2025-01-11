"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CloudWorkerProvider } from "./cloud-worker";
import { VaultProvider } from "./vault";
import { AccountProvider } from "./account";
import { TransactionProvider } from "./transaction";

interface ProviderProps {
  children: React.ReactNode;
  initialState?: any;
}

const queryClient = new QueryClient();

export function Providers({ children, initialState }: ProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <CloudWorkerProvider>
        <AccountProvider>
          <TransactionProvider>
            <VaultProvider>{children}</VaultProvider>
          </TransactionProvider>
        </AccountProvider>
      </CloudWorkerProvider>
    </QueryClientProvider>
  );
}
