import { useVaultManager } from "@/lib/context/vault-manager";
import { formatDisplayAccount } from "@/lib/utils";
import { TransactionType } from "@/lib/types/vault";
import { useState } from "react";
import { useVault } from "@/lib/context/vault";
import { PublicKey, UInt64 } from "o1js";

const VaultCard = ({ vaultAddr }: { vaultAddr: string }) => {
  const { getVaultQuery } = useVaultManager();
  const { data, isLoading, isError } = getVaultQuery(vaultAddr);
  const { depositCollateral, mintZkUsd } = useVault();
  const [showAmountInput, setShowAmountInput] = useState(false);
  const [amount, setAmount] = useState("");
  const [activeTransaction, setActiveTransaction] =
    useState<TransactionType | null>(null);

  const handleTransaction = (type: TransactionType) => {
    if (
      [
        TransactionType.DEPOSIT_COLLATERAL,
        TransactionType.WITHDRAW_COLLATERAL,
        TransactionType.MINT_ZKUSD,
      ].includes(type)
    ) {
      setActiveTransaction(type);
      setShowAmountInput(true);
    } else {
      console.log(`Initiating ${type} for vault ${vaultAddr}`);
    }
  };

  const handleConfirm = () => {
    console.log(
      `Executing ${activeTransaction} with amount ${amount} for vault ${vaultAddr}`
    );
    setShowAmountInput(false);
    setAmount("");
    setActiveTransaction(null);

    switch (activeTransaction) {
      case TransactionType.DEPOSIT_COLLATERAL:
        depositCollateral(PublicKey.fromBase58(vaultAddr), UInt64.from(amount));
        break;
      case TransactionType.MINT_ZKUSD:
        mintZkUsd(PublicKey.fromBase58(vaultAddr), UInt64.from(amount));
        break;
    }
  };

  const handleCancel = () => {
    setShowAmountInput(false);
    setAmount("");
    setActiveTransaction(null);
  };

  return (
    <div className="bg-white p-4 rounded shadow border border-black">
      <p className="font-semibold text-gray-700 break-all">Vault Address:</p>
      <p className="text-xs mb-2 break-all">
        {formatDisplayAccount(vaultAddr)}
      </p>

      {isLoading && <p className="text-sm text-gray-400">Loading...</p>}
      {isError && <p className="text-sm text-red-500">Error fetching data</p>}

      {data && (
        <>
          <div className="mt-2 space-y-1 text-sm text-gray-600">
            <p>Collateral: {data.collateralAmount}</p>
            <p>Debt: {data.debtAmount}</p>
            <p className="break-all">
              Owner: {formatDisplayAccount(data.owner)}
            </p>
          </div>

          {showAmountInput && (
            <div className="mt-4 space-y-2">
              <p className="text-sm text-gray-600">
                {activeTransaction === TransactionType.DEPOSIT_COLLATERAL &&
                  "Enter deposit amount"}
                {activeTransaction === TransactionType.WITHDRAW_COLLATERAL &&
                  "Enter withdrawal amount"}
                {activeTransaction === TransactionType.MINT_ZKUSD &&
                  "Enter zkUSD amount to mint"}
              </p>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Enter amount"
                className="w-full px-3 py-1 border rounded"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleConfirm}
                  className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
                >
                  Confirm
                </button>
                <button
                  onClick={handleCancel}
                  className="px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              onClick={() =>
                handleTransaction(TransactionType.DEPOSIT_COLLATERAL)
              }
            >
              Deposit
            </button>
            <button
              className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              onClick={() =>
                handleTransaction(TransactionType.WITHDRAW_COLLATERAL)
              }
            >
              Withdraw
            </button>
            <button
              className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              onClick={() => handleTransaction(TransactionType.MINT_ZKUSD)}
            >
              Mint zkUSD
            </button>
            <button
              className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
              onClick={() => handleTransaction(TransactionType.LIQUIDATE)}
            >
              Liquidate
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default VaultCard;
