"use client";

import { createContext, useContext } from "react";
import { Mina, PublicKey, UInt64 } from "o1js";
import { fee } from "zkcloudworker";
import { useAccount } from "./account";

interface TransactionContextProps {
  prepareTransaction: (
    callback: () => Promise<void>,
    memo: string
  ) => Promise<Mina.Transaction<false, false>>;
  serializeTransaction: (tx: Mina.Transaction<false, false>) => string;
}

const TransactionContext = createContext<TransactionContextProps | null>(null);

export const TransactionProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { account } = useAccount();

  const prepareTransaction = async (
    callback: () => Promise<void>,
    memo: string
  ) => {
    console.log("Preparing transaction with callback");

    if (!account) {
      throw new Error("No account connected");
    }

    if (!Mina) {
      throw new Error("Mina not found");
    }

    try {
      const tx = await Mina.transaction(
        {
          sender: account,
          fee: await fee(),
          memo,
        },
        async () => {
          await callback();
        }
      );

      return tx;
    } catch (error) {
      console.error("Error preparing transaction", error);
      throw error;
    }
  };

  const serializeTransaction = (tx: Mina.Transaction<false, false>) => {
    const length = tx.transaction.accountUpdates.length;
    let blindingValues = [];
    for (let i = 0; i < length; i++) {
      const la = tx.transaction.accountUpdates[i].lazyAuthorization;
      if (
        la !== undefined &&
        //@ts-ignore
        la.blindingValue !== undefined &&
        la.kind === "lazy-proof"
      )
        blindingValues.push(la.blindingValue.toJSON());
      else blindingValues.push("");
    }

    return JSON.stringify(
      {
        tx: tx.toJSON(),
        blindingValues,
        length,
        fee: tx.transaction.feePayer.body.fee.toJSON(),
        sender: tx.transaction.feePayer.body.publicKey.toBase58(),
        nonce: tx.transaction.feePayer.body.nonce.toBigint().toString(),
      },
      null,
      2
    );
  };

  return (
    <TransactionContext.Provider
      value={{
        prepareTransaction,
        serializeTransaction,
      }}
    >
      {children}
    </TransactionContext.Provider>
  );
};

export const useTransaction = () => {
  const context = useContext(TransactionContext);
  if (!context) {
    throw new Error("useTransaction must be used within a TransactionProvider");
  }
  return context;
};
