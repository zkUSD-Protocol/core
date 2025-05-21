import { Field, Poseidon, SelfProof, UInt32, ZkProgram } from 'o1js';
import { ZkUsdState } from '../data/state.js';
import { ZkUsdMap } from '../data/zkusd-map.js';
import {
  TransferIntentOutput,
  TransferIntentProof,
} from './intents/transfer.js';
import {
  MAX_INPUT_NOTE_COUNT,
  MAX_OUTPUT_NOTE_COUNT,
  Note,
  Nullifier,
} from '../data/note.js';
import { CreateVaultInput, DepositCollateralInput } from '../update/input.js';
import { Vault } from '../data/vault.js';
import { MintIntentProof } from './intents/mint.js';
import { VaultMap } from '../data/vault-map.js';
import { BurnIntentProof } from './intents/burn.js';
import { RedeemIntentProof } from './intents/redeem.js';
import { LiquidateIntentProof } from './intents/liquidate.js';

//TODOS:
// - Deposits / Withdrawals using an ioMap and oracle network (Eigan layer?)
// - What if the user gives exact amount in inputNote for burn
// - Price proof
// - Handle the liquidation results from the vault - transfering the collateral to the owner/liquidator via the ioMap
// - How do we handle the updating of intent roots?
// - How do we ensure the Note is encrypted properly and communicated out

export const ZkUsdRollup = ZkProgram({
  name: 'ZkUsdRollup',
  publicInput: ZkUsdState,
  publicOutput: ZkUsdState,
  overrideWrapDomain: 2,
  methods: {
    createVault: {
      privateInputs: [CreateVaultInput],
      async method(
        publicInput: ZkUsdState,
        createVaultInput: CreateVaultInput
      ): Promise<{ publicOutput: ZkUsdState }> {
        const { vaultMap, type, ownerSignature, ownerPublicKey } =
          createVaultInput;

        //Is this the same map
        vaultMap.root.assertEquals(publicInput.liveVaultMapRoot);

        //Create a new vault
        const newVault = Vault({
          collateralRatio: publicInput.collateralRatio,
          liquidationBonusRatio: publicInput.liquidationBonusRatio,
        }).new(type);

        //Verify the owner signature
        ownerSignature.verify(ownerPublicKey, newVault.toFields());

        //Hash the public key with the vault type
        const vaultKey = Poseidon.hash([
          ...ownerPublicKey.toFields(),
          type.value,
        ]);

        //Ensure the vault is not already in the map
        vaultMap.assertNotIncluded(vaultKey);

        //Add the vault to the map
        vaultMap.insert(vaultKey, newVault.pack());

        return {
          publicOutput: new ZkUsdState({
            liveVaultMapRoot: vaultMap.root,
            liveZkUsdMapRoot: publicInput.liveZkUsdMapRoot,
            intentVaultMapRoot: publicInput.intentVaultMapRoot,
            intentZkUsdMapRoot: publicInput.intentZkUsdMapRoot,
            collateralRatio: publicInput.collateralRatio,
            liquidationBonusRatio: publicInput.liquidationBonusRatio,
            vaultDebtCeiling: publicInput.vaultDebtCeiling,
            oraclesHash: publicInput.oraclesHash,
            sequence: publicInput.sequence.add(UInt32.from(1)),
            blockNumber: publicInput.blockNumber,
            validPriceBlockCount: publicInput.validPriceBlockCount,
            emergencyStop: publicInput.emergencyStop,
          }),
        };
      },
    },
    depositCollateral: {
      privateInputs: [DepositCollateralInput],
      async method(
        publicInput: ZkUsdState,
        depositCollateralInput: DepositCollateralInput
      ): Promise<{ publicOutput: ZkUsdState }> {
        const { vaultMap, type, ownerSignature, ownerPublicKey, amount } =
          depositCollateralInput;

        //Is this the same map
        vaultMap.root.assertEquals(publicInput.liveVaultMapRoot);

        const vaultKey = Poseidon.hash([
          ...ownerPublicKey.toFields(),
          type.value,
        ]);

        //Ensure the vault is in the map
        vaultMap.assertIncluded(vaultKey);

        //Get the vault
        const vault = Vault({
          collateralRatio: publicInput.collateralRatio,
          liquidationBonusRatio: publicInput.liquidationBonusRatio,
        }).unpack(vaultMap.get(vaultKey));

        //Verify the owner signature
        ownerSignature.verify(ownerPublicKey, vault.toFields());

        //Deposit collateral
        vault.depositCollateral(amount);

        //Update the vault in the map
        vaultMap.update(vaultKey, vault.pack());

        return {
          publicOutput: new ZkUsdState({
            liveVaultMapRoot: vaultMap.root,
            liveZkUsdMapRoot: publicInput.liveZkUsdMapRoot,
            intentVaultMapRoot: publicInput.intentVaultMapRoot,
            intentZkUsdMapRoot: publicInput.intentZkUsdMapRoot,
            collateralRatio: publicInput.collateralRatio,
            liquidationBonusRatio: publicInput.liquidationBonusRatio,
            vaultDebtCeiling: publicInput.vaultDebtCeiling,
            oraclesHash: publicInput.oraclesHash,
            sequence: publicInput.sequence.add(UInt32.from(1)),
            blockNumber: publicInput.blockNumber,
            validPriceBlockCount: publicInput.validPriceBlockCount,
            emergencyStop: publicInput.emergencyStop,
          }),
        };
      },
    },
    mintZkUsd: {
      privateInputs: [MintIntentProof, ZkUsdMap, VaultMap],
      async method(
        publicInput: ZkUsdState,
        mintIntentProof: MintIntentProof,
        zkUsdMap: ZkUsdMap,
        vaultMap: VaultMap
      ): Promise<{ publicOutput: ZkUsdState }> {
        mintIntentProof.verify();

        const { outputNoteCommitment, vaultUpdate } =
          mintIntentProof.publicOutput;

        const {
          intentZkUsdMapRoot,
          intentVaultMapRoot,
          collateralRatio,
          liquidationBonusRatio,
        } = mintIntentProof.publicInput;

        intentZkUsdMapRoot.assertEquals(publicInput.intentZkUsdMapRoot);
        intentVaultMapRoot.assertEquals(publicInput.intentVaultMapRoot);
        collateralRatio.assertEquals(publicInput.collateralRatio);
        liquidationBonusRatio.assertEquals(publicInput.liquidationBonusRatio);

        zkUsdMap.root.assertEquals(publicInput.liveZkUsdMapRoot);
        vaultMap.root.assertEquals(publicInput.liveVaultMapRoot);

        zkUsdMap.assertNotIncluded(outputNoteCommitment.commitment);
        zkUsdMap.insert(outputNoteCommitment.commitment, Note.included());

        vaultMap.assertIncluded(vaultUpdate.vaultAddress);
        vaultMap.update(
          vaultUpdate.vaultAddress,
          Vault({
            collateralRatio: publicInput.collateralRatio,
            liquidationBonusRatio: publicInput.liquidationBonusRatio,
          })
            .fromState(vaultUpdate.vaultState)
            .pack()
        );

        return {
          publicOutput: new ZkUsdState({
            liveZkUsdMapRoot: zkUsdMap.root,
            liveVaultMapRoot: vaultMap.root,
            intentZkUsdMapRoot: publicInput.intentZkUsdMapRoot,
            intentVaultMapRoot: publicInput.intentVaultMapRoot,
            collateralRatio: publicInput.collateralRatio,
            liquidationBonusRatio: publicInput.liquidationBonusRatio,
            vaultDebtCeiling: publicInput.vaultDebtCeiling,
            oraclesHash: publicInput.oraclesHash,
            sequence: publicInput.sequence.add(UInt32.from(1)),
            blockNumber: publicInput.blockNumber,
            validPriceBlockCount: publicInput.validPriceBlockCount,
            emergencyStop: publicInput.emergencyStop,
          }),
        };
      },
    },
    burnZkUsd: {
      privateInputs: [BurnIntentProof, ZkUsdMap, VaultMap],
      async method(
        publicInput: ZkUsdState,
        burnIntentProof: BurnIntentProof,
        zkUsdMap: ZkUsdMap,
        vaultMap: VaultMap
      ): Promise<{ publicOutput: ZkUsdState }> {
        burnIntentProof.verify();

        const { outputNoteCommitment, nullifiers, vaultUpdate } =
          burnIntentProof.publicOutput;

        const {
          intentZkUsdMapRoot,
          intentVaultMapRoot,
          collateralRatio,
          liquidationBonusRatio,
        } = burnIntentProof.publicInput;

        intentZkUsdMapRoot.assertEquals(publicInput.intentZkUsdMapRoot);
        intentVaultMapRoot.assertEquals(publicInput.intentVaultMapRoot);
        collateralRatio.assertEquals(publicInput.collateralRatio);
        liquidationBonusRatio.assertEquals(publicInput.liquidationBonusRatio);

        zkUsdMap.root.assertEquals(publicInput.liveZkUsdMapRoot);
        vaultMap.root.assertEquals(publicInput.liveVaultMapRoot);

        //Add the nullifiers to the zkusd map

        for (let i = 0; i < MAX_INPUT_NOTE_COUNT; i++) {
          const nullifier = nullifiers.nullifiers[i];
          zkUsdMap.assertNotIncluded(nullifier.nullifier);
          zkUsdMap.setIf(
            nullifier.isDummy.not(),
            nullifier.nullifier,
            Nullifier.included()
          );
        }

        zkUsdMap.assertNotIncluded(outputNoteCommitment.commitment);
        zkUsdMap.insert(outputNoteCommitment.commitment, Note.included());

        vaultMap.assertIncluded(vaultUpdate.vaultAddress);
        vaultMap.update(
          vaultUpdate.vaultAddress,
          Vault({
            collateralRatio: publicInput.collateralRatio,
            liquidationBonusRatio: publicInput.liquidationBonusRatio,
          })
            .fromState(vaultUpdate.vaultState)
            .pack()
        );

        return {
          publicOutput: new ZkUsdState({
            liveZkUsdMapRoot: zkUsdMap.root,
            liveVaultMapRoot: vaultMap.root,
            intentZkUsdMapRoot: publicInput.intentZkUsdMapRoot,
            intentVaultMapRoot: publicInput.intentVaultMapRoot,
            collateralRatio: publicInput.collateralRatio,
            liquidationBonusRatio: publicInput.liquidationBonusRatio,
            vaultDebtCeiling: publicInput.vaultDebtCeiling,
            oraclesHash: publicInput.oraclesHash,
            sequence: publicInput.sequence.add(UInt32.from(1)),
            blockNumber: publicInput.blockNumber,
            validPriceBlockCount: publicInput.validPriceBlockCount,
            emergencyStop: publicInput.emergencyStop,
          }),
        };
      },
    },
    redeemCollateral: {
      privateInputs: [RedeemIntentProof, VaultMap],
      async method(
        publicInput: ZkUsdState,
        redeemIntentProof: RedeemIntentProof,
        vaultMap: VaultMap
      ): Promise<{ publicOutput: ZkUsdState }> {
        redeemIntentProof.verify();

        const { vaultUpdate } = redeemIntentProof.publicOutput;

        const { intentVaultMapRoot, collateralRatio, liquidationBonusRatio } =
          redeemIntentProof.publicInput;

        intentVaultMapRoot.assertEquals(publicInput.intentVaultMapRoot);
        collateralRatio.assertEquals(publicInput.collateralRatio);
        liquidationBonusRatio.assertEquals(publicInput.liquidationBonusRatio);

        vaultMap.root.assertEquals(publicInput.liveVaultMapRoot);

        vaultMap.assertIncluded(vaultUpdate.vaultAddress);
        vaultMap.update(
          vaultUpdate.vaultAddress,
          Vault({
            collateralRatio: publicInput.collateralRatio,
            liquidationBonusRatio: publicInput.liquidationBonusRatio,
          })
            .fromState(vaultUpdate.vaultState)
            .pack()
        );

        return {
          publicOutput: new ZkUsdState({
            liveVaultMapRoot: vaultMap.root,
            liveZkUsdMapRoot: publicInput.liveZkUsdMapRoot,
            intentZkUsdMapRoot: publicInput.intentZkUsdMapRoot,
            intentVaultMapRoot: publicInput.intentVaultMapRoot,
            collateralRatio: publicInput.collateralRatio,
            liquidationBonusRatio: publicInput.liquidationBonusRatio,
            vaultDebtCeiling: publicInput.vaultDebtCeiling,
            oraclesHash: publicInput.oraclesHash,
            sequence: publicInput.sequence.add(UInt32.from(1)),
            blockNumber: publicInput.blockNumber,
            validPriceBlockCount: publicInput.validPriceBlockCount,
            emergencyStop: publicInput.emergencyStop,
          }),
        };
      },
    },
    liquidate: {
      privateInputs: [LiquidateIntentProof, ZkUsdMap, VaultMap],
      async method(
        publicInput: ZkUsdState,
        liquidateIntentProof: LiquidateIntentProof,
        zkUsdMap: ZkUsdMap,
        vaultMap: VaultMap
      ): Promise<{ publicOutput: ZkUsdState }> {
        liquidateIntentProof.verify();

        const { outputNoteCommitment, nullifiers, vaultUpdate } =
          liquidateIntentProof.publicOutput;

        const {
          intentZkUsdMapRoot,
          intentVaultMapRoot,
          collateralRatio,
          liquidationBonusRatio,
        } = liquidateIntentProof.publicInput;

        intentZkUsdMapRoot.assertEquals(publicInput.intentZkUsdMapRoot);
        intentVaultMapRoot.assertEquals(publicInput.intentVaultMapRoot);
        collateralRatio.assertEquals(publicInput.collateralRatio);
        liquidationBonusRatio.assertEquals(publicInput.liquidationBonusRatio);

        zkUsdMap.root.assertEquals(publicInput.liveZkUsdMapRoot);
        vaultMap.root.assertEquals(publicInput.liveVaultMapRoot);

        //Add the nullifiers to the zkusd map
        for (let i = 0; i < MAX_INPUT_NOTE_COUNT; i++) {
          const nullifier = nullifiers.nullifiers[i];
          zkUsdMap.assertNotIncluded(nullifier.nullifier);
          zkUsdMap.setIf(
            nullifier.isDummy.not(),
            nullifier.nullifier,
            Nullifier.included()
          );
        }

        zkUsdMap.assertNotIncluded(outputNoteCommitment.commitment);
        zkUsdMap.insert(outputNoteCommitment.commitment, Note.included());

        vaultMap.assertIncluded(vaultUpdate.vaultAddress);
        vaultMap.update(
          vaultUpdate.vaultAddress,
          Vault({
            collateralRatio: publicInput.collateralRatio,
            liquidationBonusRatio: publicInput.liquidationBonusRatio,
          })
            .fromState(vaultUpdate.vaultState)
            .pack()
        );

        //We need send collateral back to the liquidator and the owner

        return {
          publicOutput: new ZkUsdState({
            liveVaultMapRoot: vaultMap.root,
            liveZkUsdMapRoot: zkUsdMap.root,
            intentZkUsdMapRoot: publicInput.intentZkUsdMapRoot,
            intentVaultMapRoot: publicInput.intentVaultMapRoot,
            collateralRatio: publicInput.collateralRatio,
            liquidationBonusRatio: publicInput.liquidationBonusRatio,
            vaultDebtCeiling: publicInput.vaultDebtCeiling,
            oraclesHash: publicInput.oraclesHash,
            sequence: publicInput.sequence.add(UInt32.from(1)),
            blockNumber: publicInput.blockNumber,
            validPriceBlockCount: publicInput.validPriceBlockCount,
            emergencyStop: publicInput.emergencyStop,
          }),
        };
      },
    },
    transfer: {
      privateInputs: [TransferIntentProof, ZkUsdMap],
      async method(
        publicInput: ZkUsdState,
        intentProof: TransferIntentProof,
        zkUsdMap: ZkUsdMap
      ): Promise<{ publicOutput: ZkUsdState }> {
        intentProof.verify();
        const { nullifiers, outputNoteCommitments } = intentProof.publicOutput;

        const { intentZkUsdMapRoot } = intentProof.publicInput;

        intentZkUsdMapRoot.assertEquals(publicInput.intentZkUsdMapRoot);
        zkUsdMap.root.assertEquals(publicInput.liveZkUsdMapRoot);

        for (let i = 0; i < MAX_INPUT_NOTE_COUNT; i++) {
          const nullifier = nullifiers.nullifiers[i];
          zkUsdMap.assertNotIncluded(nullifier.nullifier);
          zkUsdMap.setIf(
            nullifier.isDummy.not(),
            nullifier.nullifier,
            Nullifier.included()
          );
        }

        for (let i = 0; i < MAX_OUTPUT_NOTE_COUNT; i++) {
          const outputNoteCommitment = outputNoteCommitments.commitments[i];
          zkUsdMap.assertNotIncluded(outputNoteCommitment.commitment);
          zkUsdMap.setIf(
            outputNoteCommitment.isDummy.not(),
            outputNoteCommitment.commitment,
            Note.included()
          );
        }

        return {
          publicOutput: new ZkUsdState({
            liveZkUsdMapRoot: zkUsdMap.root,
            intentZkUsdMapRoot: publicInput.intentZkUsdMapRoot,
            intentVaultMapRoot: publicInput.intentVaultMapRoot,
            collateralRatio: publicInput.collateralRatio,
            liquidationBonusRatio: publicInput.liquidationBonusRatio,
            vaultDebtCeiling: publicInput.vaultDebtCeiling,
            oraclesHash: publicInput.oraclesHash,
            liveVaultMapRoot: publicInput.liveVaultMapRoot,
            sequence: publicInput.sequence.add(UInt32.from(1)),
            blockNumber: publicInput.blockNumber,
            validPriceBlockCount: publicInput.validPriceBlockCount,
            emergencyStop: publicInput.emergencyStop,
          }),
        };
      },
    },
    updateIntentRoots: {
      privateInputs: [],
      async method(
        publicInput: ZkUsdState
      ): Promise<{ publicOutput: ZkUsdState }> {
        //How do we handle this?
        return {
          publicOutput: new ZkUsdState({
            intentZkUsdMapRoot: publicInput.liveZkUsdMapRoot,
            intentVaultMapRoot: publicInput.liveVaultMapRoot,
            liveZkUsdMapRoot: publicInput.liveZkUsdMapRoot,
            liveVaultMapRoot: publicInput.liveVaultMapRoot,
            sequence: publicInput.sequence.add(UInt32.from(1)),
            blockNumber: publicInput.blockNumber,
            validPriceBlockCount: publicInput.validPriceBlockCount,
            emergencyStop: publicInput.emergencyStop,
            collateralRatio: publicInput.collateralRatio,
            liquidationBonusRatio: publicInput.liquidationBonusRatio,
            vaultDebtCeiling: publicInput.vaultDebtCeiling,
            oraclesHash: publicInput.oraclesHash,
          }),
        };
      },
    },
    merge: {
      privateInputs: [SelfProof, SelfProof],
      async method(
        input: ZkUsdState,
        proof1: SelfProof<ZkUsdState, ZkUsdState>,
        proof2: SelfProof<ZkUsdState, ZkUsdState>
      ): Promise<{ publicOutput: ZkUsdState }> {
        proof1.verify();
        proof2.verify();

        ZkUsdState.assertEqual(input, proof1.publicInput);
        ZkUsdState.assertEqual(proof1.publicOutput, proof2.publicInput);

        return {
          publicOutput: proof2.publicOutput,
        };
      },
    },
  },
});

export class ZkUsdRollupProof extends ZkProgram.Proof(ZkUsdRollup) {}
