"use client";

import { createContext, useContext, useCallback } from "react";
import { PublicKey, UInt64, Mina, AccountUpdate, PrivateKey } from "o1js";
import { useCloudWorker } from "./cloud-worker";
import { serializeTransaction, transaction } from "@/lib/utils/transaction";
import { ZkUsdEngineContract, vaultKey } from "zkusd";
import { TransactionType } from "@/lib/types/vault";
import { CloudWorkerResponse } from "@/lib/types/cloud-worker";
import { fetchMinaAccount } from "zkcloudworker";
import { useAccount } from "./account";
import { useTransaction } from "./transaction";

interface VaultContextProps {
  createVault: (vaultPrivateKey: PrivateKey) => Promise<CloudWorkerResponse>;
  depositCollateral: (
    vaultAddress: PublicKey,
    amount: UInt64
  ) => Promise<CloudWorkerResponse>;
  mintZkUsd: (
    vaultAddress: PublicKey,
    amount: UInt64
  ) => Promise<CloudWorkerResponse>;
}

const VaultContext = createContext<VaultContextProps | null>(null);

export const VaultProvider = ({ children }: { children: React.ReactNode }) => {
  const { executeTransaction } = useCloudWorker();
  const { prepareTransaction, serializeTransaction } = useTransaction();
  const { account } = useAccount();

  const ZkUsdEngine = ZkUsdEngineContract(
    PublicKey.fromBase58(process.env.NEXT_PUBLIC_TOKEN_ADDRESS!),
    PublicKey.fromBase58(process.env.NEXT_PUBLIC_MASTER_ORACLE_ADDRESS!),
    PublicKey.fromBase58(
      process.env.NEXT_PUBLIC_EVEN_ORACLE_PRICE_TRACKER_ADDRESS!
    ),
    PublicKey.fromBase58(
      process.env.NEXT_PUBLIC_ODD_ORACLE_PRICE_TRACKER_ADDRESS!
    ),
    vaultKey
  );

  const engine = new ZkUsdEngine(
    PublicKey.fromBase58(process.env.NEXT_PUBLIC_ENGINE_ADDRESS!)
  );

  const signAndProve = async ({
    tx,
    fee,
    memo,
    vaultAddress,
  }: {
    tx: Mina.Transaction<false, false>;
    fee: UInt64;
    memo: TransactionType;
    vaultAddress: string;
  }) => {
    try {
      const serializedTx = serializeTransaction(tx);
      const signResult = await window.mina?.sendTransaction({
        onlySign: true,
        transaction: tx.toJSON(),
        feePayer: {
          fee: Number(fee),
          memo,
        },
      });

      if (!signResult || "code" in signResult) {
        throw new Error(signResult?.message || "Signing failed");
      }

      if (!("signedData" in signResult)) {
        throw new Error("Expected signed zkApp command");
      }

      const signedData = signResult.signedData;

      const transaction = JSON.stringify({
        serializedTx,
        signedData,
      });

      const response = await executeTransaction({
        task: "sendVaultTx",
        transactions: [transaction],
        args: JSON.stringify({
          vaultAddress: vaultAddress,
        }),
      });

      if (!response.success) {
        throw new Error(response.error);
      }

      return response;
    } catch (error) {
      throw error;
    }
  };

  const createVault = useCallback(
    async (vaultPrivateKey: PrivateKey) => {
      const memo = TransactionType.CREATE_VAULT;
      const vaultAddress = vaultPrivateKey.toPublicKey();

      //Check to see if the user already has an account
      await fetchMinaAccount({
        publicKey: account!,
        tokenId: engine.deriveTokenId(),
      });

      if (!Mina.hasAccount(account!)) {
      }

      const { tx, fee } = await prepareTransaction(async () => {
        console.log("Creating vault with address", vaultAddress);
        AccountUpdate.fundNewAccount(account!, 1);
        await engine.createVault(vaultAddress);
      }, memo);

      tx.sign([vaultPrivateKey]);
      return signAndProve({
        tx,
        fee,
        memo,
        vaultAddress: vaultAddress.toBase58(),
      });
    },
    [prepareTransaction]
  );

  const depositCollateral = useCallback(
    async (vaultAddress: PublicKey, amount: UInt64) => {
      const tx = await engine.depositCollateral(vaultAddress, amount);
      return signAndProve("tx" as any);
    },
    []
  );

  const mintZkUsd = useCallback(
    async (vaultAddress: PublicKey, amount: UInt64) => {
      const tx = await engine.mintZkUsd(vaultAddress, amount);
      return signAndProve("tx" as any);
    },
    []
  );

  return (
    <VaultContext.Provider
      value={{
        createVault,
        depositCollateral,
        mintZkUsd,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
};

export const useVault = () => {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error("useVault must be used within a VaultProvider");
  }
  return context;
};
