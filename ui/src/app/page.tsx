"use client";

import React from "react";
import { useVaultManager } from "@/lib/context/vault-manager";
import { VaultCard } from "@/lib/components";
import { useAccount } from "@/lib/context/account";

export default function VaultsPage() {
  const { vaultAddresses, createNewVault } = useVaultManager();

  const handleCreateVault = async () => {
    try {
      await createNewVault();
    } catch (err) {
      console.error("Error creating vault:", err);
    }
  };

  return (
    <div className="p-8 bg-gray-100 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">My Vaults</h1>

        <button
          onClick={handleCreateVault}
          className="px-4 py-2 bg-blue-600 text-white rounded-md shadow hover:bg-blue-700 transition"
        >
          Create New Vault
        </button>

        <div className="mt-6 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {vaultAddresses.map((vaultAddr) => (
            <VaultCard key={vaultAddr} vaultAddr={vaultAddr} />
          ))}
        </div>
      </div>
    </div>
  );
}
