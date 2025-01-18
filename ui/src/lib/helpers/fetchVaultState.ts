import { PublicKey, Mina } from "o1js";
import { ZkUsdEngineContract, ZkUsdVault } from "zkusd";
// The exact import path(s) depend on how your contracts expose these classes.
// "ZkUsdEngineContract" might be the function returning the class,
// or you could have a direct ZkUsdEngine class, etc.

import { VaultOnChainState } from "@/lib/context/vault-manager";
import { fetchMinaAccount } from "zkcloudworker";

/**
 * This function fetches the vault state directly from the chain.
 *
 * @param vaultAddress The public key for the vault
 * @param engine       An instance of your engine contract (from which you can derive tokenId)
 */
export async function fetchVaultState(
  vaultAddress: PublicKey,
  engine: InstanceType<ReturnType<typeof ZkUsdEngineContract>> // or however your engine instance is typed
): Promise<VaultOnChainState> {
  // 1) Make sure we’ve fetched the account (so we can read up-to-date contract state).

  const engineAccount = await fetchMinaAccount({
    publicKey: engine.address,
  });

  console.log(
    "engineAccount",
    engineAccount.account.zkapp.verificationKey.hash.toString()
  );

  //   "B62qkWNywoY6QrugwGdax19tumYXUpBJwFhGmnyeEd1Sctz1nWuwKt3"

  // 2) Instantiate the vault on the client side.
  //    For example, in your code, you might do something like:
  //    new ZkUsdVault(vaultAddress, engine.deriveTokenId())
  //    Or if you have an exposed method from your engine that returns the vault instance, use that.
  const vault = new ZkUsdVault(vaultAddress, engine.deriveTokenId());

  if (!vault) {
    throw new Error("Vault not found");
  }

  const collateralAmount = (await vault.collateralAmount.fetch())!.toString();
  const debtAmount = (await vault.debtAmount.fetch())!.toString();
  const ownerPublicKey = await vault.owner.fetch();
  const owner = ownerPublicKey?.toBase58() ?? "Not Found";

  // Return these in the shape your UI expects:
  return {
    collateralAmount,
    debtAmount,
    owner,
  };
}
