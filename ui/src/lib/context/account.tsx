"use client";

import { PublicKey } from "o1js";
import { createContext, useContext, useEffect, useState } from "react";

interface AccountContextProps {
  account: PublicKey | null;
  displayAccount: string | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const AccountContext = createContext<AccountContextProps | null>(null);

export const AccountProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [account, setAccount] = useState<PublicKey | null>(null);

  const formatDisplayAccount = (account: string) =>
    `${account.slice(0, 6)}...${account.slice(-4)}`;

  const connect = async () => {
    try {
      const accounts = await window.mina?.requestAccounts();

      if (!accounts || "code" in accounts) {
        throw new Error("No accounts found");
      }

      setAccount(PublicKey.fromBase58(accounts[0]));
    } catch (error) {
      console.error("Failed to connect account:", error);
      throw error;
    }
  };

  const disconnect = () => {
    setAccount(null);
  };

  // Auto-connect on mount
  useEffect(() => {
    connect();
  }, []);

  return (
    <AccountContext.Provider
      value={{
        account,
        displayAccount: account
          ? formatDisplayAccount(account.toBase58())
          : null,
        isConnected: !!account,
        connect,
        disconnect,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
};

export const useAccount = () => {
  const context = useContext(AccountContext);
  if (!context) {
    throw new Error("useAccount must be used within an AccountProvider");
  }
  return context;
};
