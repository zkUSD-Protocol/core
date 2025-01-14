"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { PublicKey } from "o1js";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useVault } from "./vault"; // from your existing vault.tsx
import { fetchVaultState } from "@/lib/helpers/fetchVaultState";
import { useContracts } from "./contracts";
// or wherever you keep your engine instance
// (importing a single shared engine or constructing it once in the app)

/**
 * Shape of the vault state in the UI.
 * Extend this as you see fit.
 */
export interface VaultOnChainState {
  collateralAmount: string;
  debtAmount: string;
  owner: string;
}

interface VaultManagerContextProps {
  vaultAddresses: string[]; // each is a base58 string
  createNewVault: () => Promise<void>;
  removeVaultAddress: (vaultAddress: string) => void;
  // For retrieving the on-chain data about a vault,
  // could just use React Query hooks directly, or include below method:
  getVaultQuery: (
    vaultAddress: string
  ) => ReturnType<typeof useQuery<VaultOnChainState>>;
}

/**
 * Create a context for the vault manager
 */
const VaultManagerContext = createContext<VaultManagerContextProps | null>(
  null
);

/**
 * The provider that manages the local storage and on-chain caching
 */
export function VaultManagerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { createVault } = useVault();
  const { engine } = useContracts();
  const [vaultAddresses, setVaultAddresses] = useState<string[]>([]);
  const queryClient = useQueryClient();

  // On first load, read any vault addresses from localStorage.
  useEffect(() => {
    const stored = localStorage.getItem("zkusdVaults");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setVaultAddresses(parsed);
        }
      } catch (err) {
        console.error("Failed to parse zkusdVaults from localStorage", err);
      }
    }
  }, []);

  // Whenever vaultAddresses changes, persist them to localStorage
  useEffect(() => {
    localStorage.setItem("zkusdVaults", JSON.stringify(vaultAddresses));
  }, [vaultAddresses]);

  /**
   * Create a new vault and track it in our local storage array
   */
  const createNewVault = useCallback(async () => {
    try {
      // createVault in your existing VaultProvider returns a CloudWorkerResponse
      // but note that you must internally generate a PrivateKey and sign the createVault tx

      // Example approach:
      const { PrivateKey } = await import("o1js");
      const vaultPrivateKey = PrivateKey.random();
      const vaultAddress = vaultPrivateKey.toPublicKey().toBase58();

      // createVault triggers the contract call
      // then store the vault address in local state
      const response = await createVault(vaultPrivateKey);
      if (response.success) {
        setVaultAddresses((prev) =>
          Array.from(new Set([...prev, vaultAddress]))
        );
        console.log("Vault created successfully:", vaultAddress);
      } else {
        console.error("Failed to create vault:", response.error);
      }
    } catch (error) {
      console.error("Error creating vault:", error);
    }
  }, [createVault]);

  /**
   * We can easily remove a vault address from local storage if wanted.
   */
  const removeVaultAddress = useCallback((vaultAddress: string) => {
    setVaultAddresses((prev) => prev.filter((addr) => addr !== vaultAddress));
  }, []);

  /**
   * For each vault address, we'll define a function returning a custom
   * React Query hook that fetches the vault’s on-chain state.
   *
   * This approach returns useQuery directly. Then your components can do:
   *    const { data, isLoading } = getVaultQuery(vaultAddress);
   */
  const getVaultQuery = (vaultAddress: string) => {
    return useQuery<VaultOnChainState>({
      queryKey: ["vaultState", vaultAddress],
      queryFn: async () => {
        // Convert the base58 address back to a PublicKey
        const { PublicKey } = await import("o1js");
        const pk = PublicKey.fromBase58(vaultAddress);
        // Now call our direct on-chain fetch
        return await fetchVaultState(pk, engine);
      },
      // If you want, you can set staleTime or cacheTime or enable/disable
      // based on whether the user is connected, etc.
      staleTime: 3000,
      enabled: !!vaultAddress,
    });
  };

  /**
   * Invalidate the vault's query after deposit, mint, or repay, etc.
   * e.g. queryClient.invalidateQueries(["vaultState", vaultAddress]);
   *
   * You can do this inside your depositCollateral or mintZkUsd calls
   * in the VaultProvider or right here if you want.
   */

  return (
    <VaultManagerContext.Provider
      value={{
        vaultAddresses,
        createNewVault,
        removeVaultAddress,
        getVaultQuery,
      }}
    >
      {children}
    </VaultManagerContext.Provider>
  );
}

export function useVaultManager() {
  const ctx = useContext(VaultManagerContext);
  if (!ctx) {
    throw new Error(
      "useVaultManager must be used within a VaultManagerProvider"
    );
  }
  return ctx;
}
