import { Bool, DynamicProof, FeatureFlags, Field, Provable, PublicKey, Signature, Struct, UInt64, UInt8, VerificationKey, ZkProgram } from "o1js";
import { Vault, VaultUpdate } from "../../data/vault";
import { InputNotes, MAX_INPUT_NOTE_COUNT, MAX_OUTPUT_NOTE_COUNT, Nullifier, Nullifiers, OutputNoteCommitment, OutputNoteCommitments, OutputNotes } from "../../data/note";
import { VaultAddress } from "./common";
import { VaultMap } from "../../data/maps/vault-map";
import { AggregateOraclePricesProof } from "../../../../proofs/oracle-price-aggregation";
import { VaultContractTreeWitness } from "../../data/maps/vault-contract-tree";
import { ContractMap } from "../../data/maps/contract-map";
import { ZkUsdMap } from "../../data/maps/zkusd-map";





// public input to the sideloaded program 
export class ContractActionInput extends Struct({
  intentZkUsdMapRoot: Field,
  intentVaultMapRoot: Field,
  intentContractVaultMapRoot: Field,
  collateralRatio: UInt8,
  liquidationBonusRatio: UInt8,
  // and maybe more system params to increase the power of the contract
}) {}

export class ContractActionType extends Struct({
  type: UInt8,
}) {
  static redeem = new ContractActionType({ type: new UInt8(0) });
  static transfer = new ContractActionType({ type: new UInt8(1) });

  assertEquals(other: ContractActionType) {
    this.type.assertEquals(other.type);
  }
}


export class ContractActionOperation extends Struct({
  vaultUpdate: VaultUpdate, // vault update conducted by the contract 
  inputNotes: InputNotes,
  outputNotes: OutputNotes,
  vaultAddress: VaultAddress, // vault address against which the contract action is conducted
  spendingSignature: Signature,
  spendingPublicKey: PublicKey,
  actionType: ContractActionType,
}) {}


// public output of the sideloaded program
export class ContractActionOutput extends Struct({
  contractVaultOperation: ContractActionOperation,
}) {}



export class ContractActionProof extends DynamicProof<ContractActionInput, ContractActionOutput> {
  static publicInputType = ContractActionInput;
  static publicOutputType = ContractActionOutput;
  static maxProofsVerified = 0 as const;

  // we use the feature flags that we computed from the `sideloadedProgram` ZkProgram
  static featureFlags = FeatureFlags.allMaybe // probably too slow to use
}

const MAX_CONTRACT_ACTION_COUNT = 4;

// contains at maximum MAX_CONTRACT_ACTION_COUNT ContractActionOperations
export class ContractActionOperations extends Struct({
  operations: Provable.Array(ContractActionOperation, MAX_CONTRACT_ACTION_COUNT),
  isDummy: Provable.Array(Bool, MAX_CONTRACT_ACTION_COUNT),
}) {}

/// now the intent level

export class ContractActionIntentInput extends Struct({
  intentZkUsdMapRoot: Field,
  intentVaultMapRoot: Field,
  intentContractVaultMapRoot: Field,
  collateralRatio: UInt8,
  liquidationBonusRatio: UInt8,
  // and maybe more system params to increase the power of the contract
  }) {}

export class ContractActionIntentOutput extends Struct({
  vaultUpdate: VaultUpdate,
  nullifiers: Nullifiers,
  outputNoteCommitments: OutputNoteCommitments,
}) {}
  

export class ContractRedeemIntentPrivateInput extends Struct({
  intentVaultMap: VaultMap,
  priceProof: AggregateOraclePricesProof,
  amount: UInt64,
}) {}

export class ContractTransferIntentPrivateInput extends Struct({
    intentZkUsdMap: ZkUsdMap,
    inputNotes: InputNotes,
    outputNotes: OutputNotes,
}) {}

export const ContractActionIntent = ZkProgram({
  name: 'ContractAction',
  publicInput: ContractActionIntentInput,
  publicOutput: ContractActionIntentOutput,
  methods: {
    transfer: {
        privateInputs: [ContractActionProof, VerificationKey, VaultContractTreeWitness, ContractMap, ContractTransferIntentPrivateInput],
        async method(
            publicInput: ContractActionIntentInput,
            transferIntentProof: ContractActionProof,
            verificationKey: VerificationKey,
            vaultContractTreeWitness: VaultContractTreeWitness,
            contractMap: ContractMap,
            transferIntentPrivateInput: ContractTransferIntentPrivateInput,
        ): Promise<{ publicOutput: ContractActionIntentOutput }> {

            const {
                intentZkUsdMap,
            } = transferIntentPrivateInput;

            // verify 'contract action' proof
            transferIntentProof.verify(verificationKey);

            // assert operation type
            const op = transferIntentProof.publicOutput.contractVaultOperation;
            op.actionType.assertEquals(ContractActionType.transfer);


        // get vault adress
        const vaultAddress = op.vaultAddress;

        // verify contract map matches public input
        const contractMapRoot = publicInput.intentContractVaultMapRoot;
        contractMapRoot.assertEquals(contractMap.root);

        // verify the contract if defined for the vault
        const vkh = verificationKey.hash;
        const vaultContractTreeRoot = vaultContractTreeWitness.calculateRoot(vkh);
        
        const vaultContractTreeRootActual = contractMap.get(vaultAddress.key)
        
        vaultContractTreeRootActual.assertEquals(vaultContractTreeRoot);


        // == by now we know that the operation is authorized
        // == now lets check if it is valid
        intentZkUsdMap.root.assertEquals(publicInput.intentZkUsdMapRoot);
        
        const nullifiers = Nullifiers.empty();
        const outputNoteCommitments = OutputNoteCommitments.empty();

        const {
          inputNotes,
          outputNotes,
          spendingSignature,
          spendingPublicKey,
        } = op;

        let valueIn = UInt64.zero;

        spendingSignature.verify(spendingPublicKey, inputNotes.toFields());

        intentZkUsdMap.root.assertEquals(publicInput.intentZkUsdMapRoot);

        for (let i = 0; i < MAX_INPUT_NOTE_COUNT; i++) {
          const inN = inputNotes.notes[i];
          const inNHash = inN.hash();
          // TODO: can we have nullifiers that do not depend on spending signature?
        //   const inNNullifier = inN.nullifier(spendingSignature.r);
          // the note should have the same nullifier irrespectively of
          // the method used.
          // using hash can be justified, as nullifiers are only
          // provided via controlled zkprograms
          // so even if someone knew the decrypted note
          // and wanted to maliciously burn it they can only do 
          // so if they have been able to create proofs for the entire intent.
          const inNNullifier = inN.nullifier(inN.hash());


          //We only want to make sure its part of the zkusd map if its not a dummy note
          const inNToCheck = Provable.if(inN.isDummy.not(), inNHash, Field(0));

          intentZkUsdMap.assertIncluded(inNToCheck);

          let spenderToCheck = Provable.if(
            inN.isDummy.not(),
            spendingPublicKey,
            PublicKey.empty()
          );

          inN.address.spendingPublicKey.assertEquals(spenderToCheck);

          //Make sure the nullifier is not spent
          intentZkUsdMap.assertNotIncluded(inNNullifier);

          const nullifier = Provable.if(
            inN.isDummy.not(),
            Nullifier.create(inNNullifier),
            Nullifier.dummy()
          );

          nullifiers.nullifiers[i] = nullifier;

          valueIn = valueIn.add(inN.amount);
        }

        let valueOut = UInt64.zero;

        for (let i = 0; i < MAX_OUTPUT_NOTE_COUNT; i++) {
          const outN = outputNotes.notes[i];
          const outNHash = outN.hash();

          intentZkUsdMap.assertNotIncluded(outNHash);

          const outputNoteCommitment = Provable.if(
            outN.isDummy.not(),
            OutputNoteCommitment.create(outNHash),
            OutputNoteCommitment.dummy()
          );

          outputNoteCommitments.commitments[i] = outputNoteCommitment;

          valueOut = valueOut.add(outN.amount);
        }

        valueIn.assertEquals(valueOut);

        return {
          publicOutput: new ContractActionIntentOutput({
            vaultUpdate: VaultUpdate.empty(),
            nullifiers,
            outputNoteCommitments,
          }),
        };
            
        }
    },
    redeem: {
      privateInputs: [ContractActionProof, VerificationKey, VaultContractTreeWitness, ContractMap, ContractRedeemIntentPrivateInput],
      async method(
        publicInput: ContractActionIntentInput,
        redeemIntentProof: ContractActionProof,
        verificationKey: VerificationKey,
        vaultContractTreeWitness: VaultContractTreeWitness,
        contractMap: ContractMap,
        redeemIntentPrivateInput: ContractRedeemIntentPrivateInput,
      ): Promise<{ publicOutput: ContractActionIntentOutput }> {

        const {
          intentVaultMap,
          priceProof,
          amount,
        } = redeemIntentPrivateInput;

        // assert redeem action type
        redeemIntentProof.publicOutput.contractVaultOperation.actionType.assertEquals(ContractActionType.redeem);

        // verify the proof
        redeemIntentProof.verify(verificationKey);

        // verify price proof
        priceProof.verify();

        // get vault adress
        const op = redeemIntentProof.publicOutput.contractVaultOperation;
        const vaultAddress = op.vaultAddress;

        // verify contract map matches public input
        const contractMapRoot = publicInput.intentContractVaultMapRoot;
        contractMapRoot.assertEquals(contractMap.root);

        // verify the contract if defined for the vault
        const vkh = verificationKey.hash;
        const vaultContractTreeRoot = vaultContractTreeWitness.calculateRoot(vkh);
        
        const vaultContractTreeRootActual = contractMap.get(vaultAddress.key)
        
        vaultContractTreeRootActual.assertEquals(vaultContractTreeRoot);

        // == by now we know that the operation is authorized
        // == now lets check if it is valid

        // verify intent vault map matches public input
        intentVaultMap.root.assertEquals(publicInput.intentVaultMapRoot);
        
        // get the vault
        const vaultBefore = Vault({
          collateralRatio: publicInput.collateralRatio,
          liquidationBonusRatio: publicInput.liquidationBonusRatio,
        }).unpack(intentVaultMap.get(vaultAddress.key));

        const minaPrice = priceProof.publicOutput.minaPrice;
        vaultBefore.redeemCollateral(amount, minaPrice);

        const vaultAfter = op.vaultUpdate.vaultState;

        vaultAfter.collateralAmount.assertEquals(vaultBefore.collateralAmount);
        vaultAfter.debtAmount.assertEquals(vaultBefore.debtAmount.sub(amount));
        vaultAfter.type.assertEquals(vaultBefore.type);

        const ret = new ContractActionIntentOutput({
          vaultUpdate: op.vaultUpdate,
          nullifiers: Nullifiers.empty(),
          outputNoteCommitments: OutputNoteCommitments.empty(),
        });

        // verify contract proof inputs
        redeemIntentProof.publicInput.intentVaultMapRoot.assertEquals(publicInput.intentVaultMapRoot);
        redeemIntentProof.publicInput.intentContractVaultMapRoot.assertEquals(publicInput.intentContractVaultMapRoot);
        redeemIntentProof.publicInput.intentZkUsdMapRoot.assertEquals(publicInput.intentZkUsdMapRoot);
        redeemIntentProof.publicInput.collateralRatio.assertEquals(publicInput.collateralRatio);
        redeemIntentProof.publicInput.liquidationBonusRatio.assertEquals(publicInput.liquidationBonusRatio);

        return {
          publicOutput: ret,
        };

      },
    },
  },
});

export class ContractActionIntentProof extends ZkProgram.Proof(ContractActionIntent) {}
