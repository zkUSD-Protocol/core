import {
  assert,
  Field,
  Poseidon,
  Provable,
  PublicKey,
  SelfProof,
  Signature,
  UInt64,
  UInt8,
  ZkProgram,
} from 'o1js';
import {
  MAX_INPUT_NOTE_COUNT,
  MAX_OUTPUT_NOTE_COUNT,
  CreateVaultInput,
  DepositCollateralInput,
  MintZkUsdInput,
  BurnInput,
  RedeemCollateralInput,
  LiquidateInput,
  TransferInput,
} from './update/input.js';
import { ZkUsdState } from './data/state.js';
import { Note } from './data/note.js';
import { ZkUsdMap } from './data/zkusd-map.js';
import { VaultMap } from './data/vault-map.js';
import { Vault } from './data/vault.js';
import { MinaPrice } from '../../system/oracle.js';
import { AggregateOraclePricesProof } from '../../proofs/oracle-price-aggregation/index.js';

export const ZkUsd = ZkProgram({
  name: 'ZkUsd',
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
        vaultMap.root.assertEquals(publicInput.vaultMapRoot);

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
          publicOutput: ZkUsdState.update(publicInput, {
            vaultMapRoot: vaultMap.root,
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
        vaultMap.root.assertEquals(publicInput.vaultMapRoot);

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
          publicOutput: ZkUsdState.update(publicInput, {
            vaultMapRoot: vaultMap.root,
          }),
        };
      },
    },
    mintZkUsd: {
      privateInputs: [
        VaultMap,
        ZkUsdMap,
        Note,
        AggregateOraclePricesProof,
        UInt8,
        Signature,
        PublicKey,
        UInt64,
      ],
      async method(
        publicInput: ZkUsdState,
        vaultMap: VaultMap,
        zkUsdMap: ZkUsdMap,
        note: Note,
        minaPriceProof: AggregateOraclePricesProof,
        type: UInt8,
        ownerSignature: Signature,
        ownerPublicKey: PublicKey,
        amount: UInt64
      ): Promise<{ publicOutput: ZkUsdState }> {
        //Is this the same map
        vaultMap.root.assertEquals(publicInput.vaultMapRoot);
        zkUsdMap.root.assertEquals(publicInput.zkUsdMapRoot);

        //Verify the mina price proof
        minaPriceProof.verify();

        const minaPrice = minaPriceProof.publicOutput.minaPrice;

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

        //Mint the zkusd
        vault.mintZkUsd(amount, minaPrice);

        //Update the vault in the map
        vaultMap.update(vaultKey, vault.pack());

        //Ensure the note amount is the same as the minted amount
        note.amount.assertEquals(amount);

        const minted = Field(1);
        const commitment = note.hash();

        //Ensure its not already in the zkusd map
        zkUsdMap.assertNotIncluded(commitment);

        //Add the note to the zkusd map
        zkUsdMap.insert(commitment, minted);

        return {
          publicOutput: ZkUsdState.update(publicInput, {
            vaultMapRoot: vaultMap.root,
            zkUsdMapRoot: zkUsdMap.root,
          }),
        };
      },
    },
    burnZkUsd: {
      privateInputs: [BurnInput],
      async method(
        publicInput: ZkUsdState,
        burnInput: BurnInput
      ): Promise<{ publicOutput: ZkUsdState }> {
        const {
          vaultMap,
          zkUsdMap,
          inputNotes,
          outputNote,
          spendingSignature,
          spendingPublicKey,
          nullifierKey,
          type,
          ownerSignature,
          ownerPublicKey,
          amount,
        } = burnInput;

        //Is this the same map
        vaultMap.root.assertEquals(publicInput.vaultMapRoot);
        zkUsdMap.root.assertEquals(publicInput.zkUsdMapRoot);

        //Verify the owner signature
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

        const included = Field(1);
        let valueIn = UInt64.zero;

        spendingSignature.verify(
          spendingPublicKey,
          burnInput.inputNotes.toFields()
        );

        for (let i = 0; i < MAX_INPUT_NOTE_COUNT; i++) {
          const inN = burnInput.inputNotes.notes[i];
          const inNHash = inN.hash();
          const inNNullifier = inN.nullifier(nullifierKey);

          //We only want to make sure its part of the zkusd map if its not a dummy note
          const inNToCheck = Provable.if(inN.isDummy.not(), inNHash, Field(0));

          zkUsdMap.assertIncluded(inNToCheck);

          let spenderToCheck = Provable.if(
            inN.isDummy.not(),
            spendingPublicKey,
            PublicKey.empty()
          );

          inN.address.spendingPublicKey.assertEquals(spenderToCheck);

          //Make sure the nullifier is not spent
          zkUsdMap.assertNotIncluded(inNNullifier);

          //Add the nullifier to the nullifier map
          zkUsdMap.setIf(inN.isDummy.not(), inNNullifier, included);

          valueIn = valueIn.add(inN.amount);
        }

        const outN = burnInput.outputNote;
        const outNHash = outN.hash();

        zkUsdMap.assertNotIncluded(outNHash);

        //Ensure the input amount is the same as the output amount + the amount to burn
        valueIn.add(amount).assertEquals(outN.amount);

        zkUsdMap.insert(outNHash, included);

        //Verify the note
        vault.burnZkUsd(amount);

        //Update the vault in the map
        vaultMap.update(vaultKey, vault.pack());

        return {
          publicOutput: ZkUsdState.update(publicInput, {
            vaultMapRoot: vaultMap.root,
            zkUsdMapRoot: zkUsdMap.root,
          }),
        };
      },
    },
    redeemCollateral: {
      privateInputs: [
        VaultMap,
        AggregateOraclePricesProof,
        UInt8,
        Signature,
        PublicKey,
        UInt64,
      ],
      async method(
        publicInput: ZkUsdState,
        vaultMap: VaultMap,
        minaPriceProof: AggregateOraclePricesProof,
        type: UInt8,
        ownerSignature: Signature,
        ownerPublicKey: PublicKey,
        amount: UInt64
      ): Promise<{ publicOutput: ZkUsdState }> {
        //Is this the same map
        vaultMap.root.assertEquals(publicInput.vaultMapRoot);

        //Verify the mina price proof
        minaPriceProof.verify();

        const minaPrice = minaPriceProof.publicOutput.minaPrice;

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

        //Redeem collateral
        vault.redeemCollateral(amount, minaPrice);

        //Update the vault in the map
        vaultMap.update(vaultKey, vault.pack());

        return {
          publicOutput: ZkUsdState.update(publicInput, {
            vaultMapRoot: vaultMap.root,
          }),
        };
      },
    },
    liquidate: {
      privateInputs: [LiquidateInput],
      async method(
        publicInput: ZkUsdState,
        liquidateInput: LiquidateInput
      ): Promise<{ publicOutput: ZkUsdState }> {
        const {
          vaultMap,
          zkUsdMap,
          minaPriceProof,
          inputNotes,
          outputNote,
          spendingSignature,
          spendingPublicKey,
          nullifierKey,
          type,
          ownerPublicKey,
        } = liquidateInput;

        //Is this the same map
        vaultMap.root.assertEquals(publicInput.vaultMapRoot);
        zkUsdMap.root.assertEquals(publicInput.zkUsdMapRoot);

        //Verify the mina price proof
        minaPriceProof.verify();

        const minaPrice = minaPriceProof.publicOutput.minaPrice;

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

        const included = Field(1);
        let valueIn = UInt64.zero;

        spendingSignature.verify(
          spendingPublicKey,
          liquidateInput.inputNotes.toFields()
        );

        for (let i = 0; i < MAX_INPUT_NOTE_COUNT; i++) {
          const inN = inputNotes.notes[i];
          const inNHash = inN.hash();
          const inNNullifier = inN.nullifier(nullifierKey);

          //We only want to make sure its part of the zkusd map if its not a dummy note
          const inNToCheck = Provable.if(inN.isDummy.not(), inNHash, Field(0));

          zkUsdMap.assertIncluded(inNToCheck);

          let liquidatorToCheck = Provable.if(
            inN.isDummy.not(),
            spendingPublicKey,
            PublicKey.empty()
          );

          inN.address.spendingPublicKey.assertEquals(liquidatorToCheck);

          //Make sure the nullifier is not spent
          zkUsdMap.assertNotIncluded(inNNullifier);

          //Add the nullifier to the nullifier map
          zkUsdMap.setIf(inN.isDummy.not(), inNNullifier, included);

          valueIn = valueIn.add(inN.amount);
        }

        const outN = outputNote;
        const outNHash = outN.hash();

        zkUsdMap.assertNotIncluded(outNHash);

        //Ensure the input amount is the same as the output amount + the amount to burn
        valueIn.add(vault.debtAmount).assertEquals(outN.amount);

        zkUsdMap.insert(outNHash, included);

        vault.liquidate(minaPrice);

        //Update the vault in the map
        vaultMap.update(vaultKey, vault.pack());

        return {
          publicOutput: ZkUsdState.update(publicInput, {
            vaultMapRoot: vaultMap.root,
            zkUsdMapRoot: zkUsdMap.root,
          }),
        };
      },
    },

    transfer: {
      privateInputs: [TransferInput, ZkUsdMap],
      async method(
        publicInput: ZkUsdState,
        transferInput: TransferInput,
        zkUsdMap: ZkUsdMap
      ): Promise<{ publicOutput: ZkUsdState }> {
        const {
          inputNotes,
          outputNotes,
          spendingSignature,
          spendingPublicKey,
          nullifierKey,
        } = transferInput;

        const included = Field(1);
        let valueIn = UInt64.zero;

        spendingSignature.verify(
          spendingPublicKey,
          transferInput.inputNotes.toFields()
        );

        zkUsdMap.root.assertEquals(publicInput.zkUsdMapRoot);

        for (let i = 0; i < MAX_INPUT_NOTE_COUNT; i++) {
          const inN = transferInput.inputNotes.notes[i];
          const inNHash = inN.hash();
          const inNNullifier = inN.nullifier(nullifierKey);

          //We only want to make sure its part of the zkusd map if its not a dummy note
          const inNToCheck = Provable.if(inN.isDummy.not(), inNHash, Field(0));

          zkUsdMap.assertIncluded(inNToCheck);

          let spenderToCheck = Provable.if(
            inN.isDummy.not(),
            spendingPublicKey,
            PublicKey.empty()
          );

          inN.address.spendingPublicKey.assertEquals(spenderToCheck);

          //Make sure the nullifier is not spent
          zkUsdMap.assertNotIncluded(inNNullifier);

          //Add the nullifier to the nullifier map
          zkUsdMap.setIf(inN.isDummy.not(), inNNullifier, included);

          valueIn = valueIn.add(inN.amount);
        }

        let valueOut = UInt64.zero;

        for (let i = 0; i < MAX_OUTPUT_NOTE_COUNT; i++) {
          const outN = transferInput.outputNotes.notes[i];
          const outNHash = outN.hash();

          zkUsdMap.assertNotIncluded(outNHash);
          zkUsdMap.setIf(outN.isDummy.not(), outN.hash(), included);

          valueOut = valueOut.add(outN.amount);
        }

        valueIn.assertEquals(valueOut);

        return {
          publicOutput: ZkUsdState.update(publicInput, {
            zkUsdMapRoot: zkUsdMap.root,
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

export class ZkUsdProof extends ZkProgram.Proof(ZkUsd) {}
