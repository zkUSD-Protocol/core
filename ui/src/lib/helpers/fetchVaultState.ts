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

  console.log(vaultAddress.toBase58());

  const account = await fetchMinaAccount({
    publicKey: vaultAddress,
    tokenId: engine.deriveTokenId(),
  });

  //   "B62qkWNywoY6QrugwGdax19tumYXUpBJwFhGmnyeEd1Sctz1nWuwKt3"

  console.log("account", account);

  // 2) Instantiate the vault on the client side.
  //    For example, in your code, you might do something like:
  //    new ZkUsdVault(vaultAddress, engine.deriveTokenId())
  //    Or if you have an exposed method from your engine that returns the vault instance, use that.
  const vault = new ZkUsdVault(vaultAddress, engine.deriveTokenId());

  console.log("vault", vault);

  if (!vault) {
    throw new Error("Vault not found");
  }

  // 3) Now read the vault’s app state. Each field is a @state() in your ZkUsdVault contract:
  console.log("Fetching vault state...");
  console.log("Collateral amount", await vault.collateralAmount.fetch());
  console.log("Debt amount", await vault.debtAmount.fetch());
  console.log("Owner", await vault.owner.fetch());

  const collateralAmount = (await vault.collateralAmount.fetch())!.toString();
  const debtAmount = (await vault.debtAmount.fetch())!.toString();
  const ownerPublicKey = await vault.owner.fetch();
  const owner = ownerPublicKey?.toBase58() ?? "Not Found";

  console.log("collateralAmount", collateralAmount);
  console.log("debtAmount", debtAmount);
  console.log("owner", owner);

  // Return these in the shape your UI expects:
  return {
    collateralAmount,
    debtAmount,
    owner,
  };
}
