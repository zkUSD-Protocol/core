"use client";

import React, { createContext, useContext, useMemo } from "react";
import { Mina, PublicKey, UInt32 } from "o1js";
import {
  ZkUsdEngineContract,
  vaultVk,
  validPriceBlockCount,
  oracleAggregationVk,
} from "zkusd";

/**
 * Define the shape of what's in your contracts context.
 * If you have multiple contract instances, include them here.
 */
interface ContractsContextValue {
  engine: InstanceType<ReturnType<typeof ZkUsdEngineContract>>;
}

/**
 * Create a React context that will store your contract instances.
 */
const ContractsContext = createContext<ContractsContextValue | null>(null);

/**
 * The provider that initializes the Mina network instance (if needed)
 * and creates the contract instances, exposing them to the React tree.
 */
export function ContractsProvider({ children }: { children: React.ReactNode }) {
  // Example: If you need to set the active instance for Mina:
  // e.g. Mina.setActiveInstance(Mina.LocalBlockchain()); or some testnet config.

  // Build your engine instance (using environment variables)
  const engine = useMemo(() => {
    const tokenAddress = process.env.NEXT_PUBLIC_TOKEN_ADDRESS;
    const engineAddress = process.env.NEXT_PUBLIC_ENGINE_ADDRESS;
    if (!tokenAddress || !engineAddress) {
      throw new Error(
        "Missing environment variables for engine contract addresses"
      );
    }

    // Get the engine contract class definition
    const ZkUsdEngine = ZkUsdEngineContract({
      zkUsdTokenAddress: PublicKey.fromBase58(tokenAddress),
      minaPriceInputZkProgramVkHash: oracleAggregationVk.hash,
      validPriceBlockCount: UInt32.from(
        validPriceBlockCount[process.env.NEXT_PUBLIC_NETWORK || "local"]
      ),
      vaultVerificationKey: vaultVk,
    });

    // Instantiate the engine with address
    return new ZkUsdEngine(PublicKey.fromBase58(engineAddress));
  }, []);

  const value = useMemo<ContractsContextValue>(() => ({ engine }), [engine]);

  return (
    <ContractsContext.Provider value={value}>
      {children}
    </ContractsContext.Provider>
  );
}

/**
 * A simple hook to access your contract instances.
 */
export function useContracts() {
  const context = useContext(ContractsContext);
  if (!context) {
    throw new Error("useContracts must be called inside a ContractsProvider");
  }
  return context;
}
