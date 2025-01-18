"use client";

import { createContext, useContext, useCallback } from "react";
import { PublicKey, UInt64, Mina, AccountUpdate, PrivateKey } from "o1js";
import { useCloudWorker } from "./cloud-worker";
import { TransactionType } from "@/lib/types/vault";
import { CloudWorkerResponse, CloudWorkerTask } from "@/lib/types/cloud-worker";
import { fetchMinaAccount } from "zkcloudworker";
import { useAccount } from "./account";
import { useTransaction } from "./transaction";
import { useContracts } from "./contracts";
import { useVaultManager } from "./vault-manager";
import { useLatestProof } from "../hooks/useLatestProof";
import { MinaPriceInput, oracleAggregationVk } from "zkusd";

/**
 * This context provides only the contract calls for creating and interacting with vaults,
 * leaving the local-management of vault addresses and vault state queries to the VaultManager.
 */

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
  // Instances and context hooks
  const { engine } = useContracts();
  const { executeTransaction } = useCloudWorker();
  const { prepareTransaction, serializeTransaction } = useTransaction();
  const { data: latestProof } = useLatestProof();
  const { account } = useAccount();
  /*
    addVaultAddress (or createAndTrackVault) is from the vault-manager.
    addVaultAddress: (vaultAddr: string) => void 
  */

  /**
   * Sign locally with Mina wallet and send to the cloud worker to prove & broadcast.
   */
  const signAndProve = async ({
    task,
    tx,
    memo,
    args,
  }: {
    task: CloudWorkerTask;
    tx: Mina.Transaction<false, false>;
    memo: TransactionType;
    args: any;
  }) => {
    try {
      const serializedTx = serializeTransaction(tx);
      const signResult = await window.mina?.sendTransaction({
        onlySign: true,
        transaction: tx.toJSON(),
        feePayer: {
          fee: Number(tx.transaction.feePayer.body.fee),
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
        task: task,
        transactions: [transaction],
        args: JSON.stringify(args),
      });

      if (!response.success) {
        throw new Error(response.error);
      }

      return response;
    } catch (error) {
      throw error;
    }
  };

  /**
   * Create a brand new vault on-chain.
   * Once created, we store the vault address in the local manager's storage using addVaultAddress.
   */
  const createVault = useCallback(
    async (vaultPrivateKey: PrivateKey) => {
      const memo = TransactionType.CREATE_VAULT;
      const vaultAddress = vaultPrivateKey.toPublicKey();
      let newAccounts = 0;

      // Check to see if the user already has an account
      await fetchMinaAccount({
        publicKey: account!,
        tokenId: engine.deriveTokenId(),
      });

      if (!Mina.hasAccount(account!)) {
        newAccounts = 2;
      } else {
        newAccounts = 1;
      }

      // Prepare transaction
      const tx = await prepareTransaction(async () => {
        // Fund new accounts for deploying the vault
        AccountUpdate.fundNewAccount(account!, newAccounts);
        await engine.createVault(vaultAddress);
      }, memo);

      // Sign the transaction
      tx.sign([vaultPrivateKey]);

      // Broadcast
      const response = await signAndProve({
        task: "createVault",
        tx,
        memo,
        args: {
          vaultAddress: vaultAddress.toBase58(),
          newAccounts,
        },
      });

      return response;
    },
    [engine, prepareTransaction, signAndProve, account]
  );

  /**
   * Deposit Collateral
   */
  const depositCollateral = useCallback(
    async (vaultAddress: PublicKey, amount: UInt64) => {
      try {
        // Prepare the transaction via engine or building it yourself
        const memo = TransactionType.DEPOSIT_COLLATERAL;

        const tx = await prepareTransaction(async () => {
          await engine.depositCollateral(vaultAddress, amount);
        }, memo);

        // We do not sign here manually because depositCollateral
        // might have a .sign() step inside or require the user to sign the fee.
        // So let's replicate the signAndProve pattern:
        // if you prefer a "prepareTransaction" approach, you can do that as well.
        const response = await signAndProve({
          task: "depositCollateral",
          tx: tx as any,
          memo,
          args: {
            vaultAddress: vaultAddress.toBase58(),
            amount: amount.toString(),
          },
        });

        // On success, we can optionally invalidate the query in vault-manager
        // (the vault manager or the component can do something like
        // queryClient.invalidateQueries(["vaultState", vaultAddress.toBase58()]) )

        return response;
      } catch (error) {
        throw error;
      }
    },
    [engine, signAndProve]
  );

  /**
   * Mint zkUSD
   */
  const mintZkUsd = useCallback(
    async (vaultAddress: PublicKey, amount: UInt64) => {
      try {
        const memo = TransactionType.MINT_ZKUSD;

        await fetchMinaAccount({
          publicKey: engine.address,
        });

        const minaPriceInput = new MinaPriceInput({
          proof: latestProof!,
          verificationKey: oracleAggregationVk,
        });

        console.time("preparing transaction with proof");
        const tx = await prepareTransaction(async () => {
          await engine.mintZkUsd(vaultAddress, amount, minaPriceInput);
        }, memo);
        console.timeEnd("preparing transaction with proof");

        const response = await signAndProve({
          task: "mintZkUsd",
          tx: tx as any,
          memo,
          args: {
            vaultAddress: vaultAddress.toBase58(),
            amount: amount.toString(),
            minaPriceProof: latestProof?.toJSON() || {},
          },
        });

        // Same note as depositCollateral about invalidating queries

        return response;
      } catch (error) {
        console.error("Error minting zkUSD", error);
        throw error;
      }
    },
    [engine, signAndProve]
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
