import {
  Field,
  PublicKey,
  Signature,
  UInt64,
  UInt8,
} from "o1js";

import { EncryptedNote, Note } from "../data/note.js";
import { FullState }      from "../validator/block-state.js";

import {
  CreateVaultIntentKey,
  CreateVaultIntent,
  CreateVaultIntentInput,
  CreateVaultPrivateInput,
  CreateVaultIntentProof,
} from "../programs/intents/create-vault.js";

import {
  DepositIntent,
  DepositIntentKey,
  DepositIntentInput,
  DepositPrivateInput,
  DepositIntentProof,
} from "../programs/intents/deposit.js";

import {
  TransferIntent,
  TransferIntentInput,
  TransferIntentPrivateInput,
  TransferIntentProof,
} from "../programs/intents/transfer.js";

import { IntentProof } from "../types/intent-proof.js";
import { IntentProofStore } from "./intent-proof-store.js";

import {
  Wallets,
  WalletsImpl,
  KeyPairAlias,
} from "./wallet.js";
import { MintIntent, MintIntentInput, MintIntentPrivateInput, MintIntentProof } from "../programs/intents/mint.js";
import { Vault } from "../data/vault.js";
import { VaultAddress } from "../programs/intents/common.js";
import { Keys } from "../types/keys.js";
import { AggregateOraclePricesProof, PriceAggregationProofPublicInput, PriceAggregationProofPublicOutput } from "../../../proofs/oracle-price-aggregation/prove.js";
import { RedeemIntent, RedeemIntentInput, RedeemIntentPrivateInput, RedeemIntentProof } from "../programs/intents/redeem.js";

export class IntentProofProvider {
  readonly wallets: Wallets;
  readonly intentProofStore?: IntentProofStore;

  constructor(args?: { wallets?: Wallets; intentProofStore?: IntentProofStore }) {
    this.wallets = args?.wallets ?? new WalletsImpl();
    this.intentProofStore = args?.intentProofStore;
  }

  /* --------------------------------------------------------------- */
  /*                 BATCH-UPDATE WALLETS WITH NOTES                 */
  /* --------------------------------------------------------------- */

  /**
   * Feeds the same encrypted-note batch to every wallet managed by this
   * provider.  Each wallet silently discards notes it cannot decrypt.
   */
  updateWalletsWithEncryptedNotes(encryptedNotes: EncryptedNote[]): void {
    for (const wallet of this.wallets.all()) {
      wallet.extractAndAddUserNotes(encryptedNotes);
    }
  }

  /* --------------------------------------------------------------- */
  /*                    CREATE-VAULT INTENT                          */
  /* --------------------------------------------------------------- */

  async createVaultIntent(
    userAlias: KeyPairAlias,
    state: FullState
  ): Promise<IntentProof> {
    const wallet = this.wallets.user(userAlias);
    const { vaultMap } = state;

    const type = UInt8.from(0); // TODO replace with enum or something less hardcoded
    const message: Field[] = [vaultMap.root, type.value, CreateVaultIntentKey];
    const signature = Signature.create(wallet.keyPair().privateKey, message);

    const publicInput = new CreateVaultIntentInput({ vaultMapRoot: vaultMap.root });
    const privateInput = new CreateVaultPrivateInput({
      vaultMap,
      type,
      ownerSignature: signature,
      ownerPublicKey: wallet.keyPair().publicKey,
    });

    const output = await CreateVaultIntent.rawMethods.createVault(
      publicInput,
      privateInput
    );

    const proof = await CreateVaultIntentProof.dummy(
      publicInput,
      output.publicOutput,
      0
    );

    const intent: IntentProof = { kind: "create-vault", proof };
    this.intentProofStore?.storeProof(intent);
    return intent;
  }

  /* --------------------------------------------------------------- */
  /*                     DEPOSIT INTENT (unchanged)                  */
  /* --------------------------------------------------------------- */

  async depositIntent(
    state: FullState,
    userAlias: KeyPairAlias,
    amount: UInt64
  ): Promise<IntentProof> {
    const wallet = this.wallets.user(userAlias);
    const { vaultMap, systemParams } = state;

    const publicInput = new DepositIntentInput({
      vaultMapRoot:          vaultMap.root,
      collateralRatio:       systemParams.collateralRatio,
      liquidationBonusRatio: systemParams.liquidationBonusRatio,
    });

    const type      = UInt8.from(0);
    const message   = [vaultMap.root, type.value, DepositIntentKey] as Field[];
    const signature = Signature.create(wallet.keyPair().privateKey, message);

    const privateInput = new DepositPrivateInput({
      vaultMap,
      type,
      ownerSignature: signature,
      ownerPublicKey: wallet.keyPair().publicKey,
      amount,
    });

    const output = await DepositIntent.rawMethods.deposit(
      publicInput,
      privateInput
    );

    const proof = await DepositIntentProof.dummy(
      publicInput,
      output.publicOutput,
      0
    );

    const intent: IntentProof = { kind: "deposit", proof };
    this.intentProofStore?.storeProof(intent);
    return intent;
  }

  async dummyPriceProof(): Promise<AggregateOraclePricesProof> {
    return AggregateOraclePricesProof.dummy(
      PriceAggregationProofPublicInput.empty(),
      PriceAggregationProofPublicOutput.empty(),
      0
    );
  }

  // mint intent
  async mintIntent(
    state: FullState,
    userAlias: KeyPairAlias,
    amount: UInt64
  ): Promise<IntentProof> {
    const wallet = this.wallets.user(userAlias);
    const { vaultMap, systemParams, zkUsdMap } = state;

    const publicInput = new MintIntentInput({
      intentZkUsdMapRoot:          zkUsdMap.root,
      intentVaultMapRoot:          vaultMap.root,
      collateralRatio:       systemParams.collateralRatio,
      liquidationBonusRatio: systemParams.liquidationBonusRatio,
    });

    // message to sign is vault
    //
    //Get the vault
    const type      = UInt8.from(0);
    const vaultKey = VaultAddress.fromPublicKey(wallet.keyPair().publicKey, type);
    const vault = Vault({
      collateralRatio: publicInput.collateralRatio,
      liquidationBonusRatio: publicInput.liquidationBonusRatio,
    }).unpack(vaultMap.get(vaultKey.key));

    const message   = vault.toFields(); 
    const signature = Signature.create(wallet.keyPair().privateKey, message);

    const keys = Keys.fromPrivateKey(wallet.keyPair().privateKey);
    const note = Note.create(amount, keys.paymentAddress, Field.random(), Field.random());
    const priceProof = await this.dummyPriceProof();
    const privateInput = new MintIntentPrivateInput({
      intentZkUsdMap: zkUsdMap,
      intentVaultMap: vaultMap,
      note,
      priceProof,
      type,
      ownerSignature: signature,
      ownerPublicKey: wallet.keyPair().publicKey,
    });

    const output = await MintIntent.rawMethods.mint(
      publicInput,
      privateInput
    );

    const proof = await MintIntentProof.dummy(
      publicInput,
      output.publicOutput,
      0
    );

    const intent: IntentProof = { kind: "mint", proof };
    this.intentProofStore?.storeProof(intent);
    return intent;
  }

  /* --------------------------------------------------------------- */
  /*                     TRANSFER INTENT (unchanged)                 */
  /* --------------------------------------------------------------- */

  async transferIntent(args: {
    userAlias: KeyPairAlias;
    state: FullState;
    amount: UInt64;
    toPublicKey: PublicKey;
  }): Promise<IntentProof> {
    const { userAlias, state, amount, toPublicKey } = args;
    const wallet = this.wallets.user(userAlias);

    const publicInput = new TransferIntentInput({
      intentZkUsdMapRoot: state.zkUsdMap.root,
    });

    const { inputNotes, outputNotes } = wallet.createTransferNotes({
      state,
      amount,
      toPublicKey,
    });

    const message   = inputNotes.toFields();
    const signature = Signature.create(wallet.keyPair().privateKey, message);

    const privateInput = new TransferIntentPrivateInput({
      intentZkUsdMap: state.zkUsdMap,
      inputNotes,
      outputNotes,
      spendingSignature: signature,
      spendingPublicKey: wallet.keyPair().publicKey,
    });

    const output = await TransferIntent.rawMethods.transfer(
      publicInput,
      privateInput
    );

    const proof = await TransferIntentProof.dummy(
      publicInput,
      output.publicOutput,
      0
    );

    const intent: IntentProof = { kind: "transfer", proof };
    this.intentProofStore?.storeProof(intent);
    return intent;
  }

  // redeem 
  async redeemIntent(
    state: FullState,
    userAlias: KeyPairAlias,
    amount: UInt64
  ): Promise<IntentProof> {
    const wallet = this.wallets.user(userAlias);
    const { vaultMap, systemParams } = state;

    const publicInput = new RedeemIntentInput({
      intentVaultMapRoot:          vaultMap.root,
      collateralRatio:       systemParams.collateralRatio,
      liquidationBonusRatio: systemParams.liquidationBonusRatio,
    });

    // message to sign is vault
    //
    //Get the vault
    const type      = UInt8.from(0);
    const vaultKey = VaultAddress.fromPublicKey(wallet.keyPair().publicKey, type);
    const vault = Vault({
      collateralRatio: publicInput.collateralRatio,
      liquidationBonusRatio: publicInput.liquidationBonusRatio,
    }).unpack(vaultMap.get(vaultKey.key));

    const message   = vault.toFields(); 
    const signature = Signature.create(wallet.keyPair().privateKey, message);

// export class RedeemIntentPrivateInput extends Struct({
//   intentVaultMap: VaultMap,
//   type: UInt8,
//   priceProof: AggregateOraclePricesProof,
//   ownerSignature: Signature,
//   ownerPublicKey: PublicKey,
//   amount: UInt64,
// }) {}
    //
// export class RedeemIntentPrivateInput extends Struct({
//   intentZkusdMap: ZkUsdMap,
//   intentVaultMap: VaultMap,
//   type: UInt8,
//   priceProof: AggregateOraclePricesProof,
//   spendingSignature: Signature,
//   spendingPublicKey: PublicKey,
//   note: Note,
// }) {}

    const privateInput = new RedeemIntentPrivateInput({
      intentVaultMap: vaultMap,
      type,
      priceProof: await this.dummyPriceProof(),
      ownerSignature: signature,
      ownerPublicKey: wallet.keyPair().publicKey,
      amount,
    });

    const output = await RedeemIntent.rawMethods.redeem(
      publicInput,
      privateInput
    );

    const proof = await RedeemIntentProof.dummy(
      publicInput,
      output.publicOutput,
      0
    );

    const intent: IntentProof = { kind: "redeem", proof };
    this.intentProofStore?.storeProof(intent);
    return intent;
  }
}
