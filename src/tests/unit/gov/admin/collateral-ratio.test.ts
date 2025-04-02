import { AccountUpdate, Poseidon, PrivateKey, Signature, UInt8 } from 'o1js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';

import { TestHelper, TestAmounts } from '../../../test-helper.js';
import {
  ZkusdProtocolUpdateInput,
  ZkusdProtocolUpdateOperation,
  mkProtocolUpdateInput,
  zkusdProtocolUpdateInputToFields,
} from '../../../../system/update.js';
import { verificationKeys } from '../../../../config/verification-keys.js';
import {
  ZkusdGovResolutionProgramWitness,
  mkZkusdGovResolutionProgramTree,
} from '../../../../system/governance.js';
import { UInt8Operation } from '../../../../system/update-operations.js';
import { AdminSignatureZkusdProtocolUpdateProgram } from '../../../../proofs/gov/admin-signature.js';
import { ZkusdProtocolUpdateProof } from '../../../../system/update-proof.js';
import { Field } from 'o1js/dist/node/lib/provable/field.js';
import { generateNextUpdateWitnessFromRoot } from '../../../../system/engine-update-witness.js';

describe('zkUSD Government Admin Signature Tests', () => {
  let testHelper: TestHelper<'local'>;
  let previousInput: ZkusdProtocolUpdateInput;
  let previousRoot: Field;
  const newAdminKeypair = PrivateKey.randomKeypair();

  async function createSigProof(updateInput: any, privateKey: PrivateKey) {
    const signature = Signature.create(
      privateKey,
      zkusdProtocolUpdateInputToFields(updateInput)
    );

    const proofResult = await AdminSignatureZkusdProtocolUpdateProgram.create(
      updateInput,
      signature,
      privateKey.toPublicKey(),
    );

    return {
      sideLoadedProof: ZkusdProtocolUpdateProof.fromProof(proofResult.proof),
      verificationKey: verificationKeys.adminSigProgram,
      witness: new ZkusdGovResolutionProgramWitness(
        mkZkusdGovResolutionProgramTree().getWitness(0n)
      ),
    };
  }
  async function createAdminSigProof(updateInput: any) {
    const { protocolAdmin } = testHelper.networkKeys;
    return createSigProof(updateInput, protocolAdmin.privateKey);
  }

  before(async () => {
    // Initialize test environment
    testHelper = await TestHelper.initLocalChain({ proofsEnabled: true });
    await testHelper.deployTokenContracts();

    // Create Alice & Bob agents; also create a vault for Alice
    await testHelper.createLocalAgents('alice');
    await testHelper.createVaults('alice');
    await testHelper.createLocalAgents('bob');

    // Alice deposits 100 MINA for the initial setup
    await testHelper.includeTx(
      testHelper.agents.alice.keys,
      async () => {
        await testHelper.engine.contract.depositCollateral(
          testHelper.agents.alice.vault!.publicKey,
          TestAmounts.COLLATERAL_100_MINA
        );
      },
      { name: 'Alice deposits 100 MINA into her vault' }
    );

    // Fund creation of a new admin account
    await testHelper.includeTx(
      testHelper.agents.alice.keys,
      async () => {
        AccountUpdate.fundNewAccount(testHelper.agents.alice.keys.publicKey, 1);
        AccountUpdate.create(newAdminKeypair.publicKey);
      },
      { name: 'Alice funds new admin key creation' }
    );
  });

  it('should allow the update proof to change the collateral ratio', async () => {
    // Confirm the protocol is currently running
    await testHelper.mina.fetchMinaAccount(testHelper.engine.contract.address, {
      force: true,
    });
    let isStopped = testHelper.engine.contract.isEmergencyStopped().toBoolean();
    assert.equal(isStopped, false, 'Protocol should initially be running');

    const resolutionNullifierRoot = await testHelper.engine.contract.govResolutionNullifierTreeRoot.fetch();
    if (!resolutionNullifierRoot) throw new Error('govResolutionNullifierTreeRoot is undefined');
    previousRoot = resolutionNullifierRoot;

    const updateInput = mkProtocolUpdateInput(
      ZkusdProtocolUpdateOperation.collateralRatio(
        UInt8Operation.mkSetTo(UInt8.from(155))
      ),
      { resolutionNullifierRoot }
    );
    previousInput = updateInput;

    const { sideLoadedProof, verificationKey, witness } =
      await createAdminSigProof(updateInput);

    await testHelper.includeTx(
      testHelper.agents.alice.keys,
      async () => {
        await testHelper.engine.contract.govUpdateCollateralRatio(
          sideLoadedProof,
          verificationKey,
          witness,
          generateNextUpdateWitnessFromRoot(resolutionNullifierRoot)
        );
      },
      { name: 'Alice changes the collateral ratio using an admin signature update' }
    );

    // Verify the new protocol ratio
    await testHelper.mina.fetchMinaAccount(testHelper.engine.contract.address, {
      force: true,
    });
    const protocolData = await testHelper.engine.contract.getProtocolData();
    assert.equal(protocolData.collateralRatio.toNumber(), 155, 'Collateral ratio should be 155');
  });

  it('should not allow to resuse the update proof', async () => {

    // Confirm the protocol is currently running
    await testHelper.mina.fetchMinaAccount(testHelper.engine.contract.address, {
      force: true,
    });
    let isStopped = testHelper.engine.contract.isEmergencyStopped().toBoolean();
    assert.equal(isStopped, false, 'Protocol should initially be running');

    const resolutionNullifierRoot = await testHelper.engine.contract.govResolutionNullifierTreeRoot.fetch();
    if (!resolutionNullifierRoot) throw new Error('govResolutionNullifierTreeRoot is undefined');

    const { sideLoadedProof, verificationKey, witness } =
      await createAdminSigProof(previousInput);

    assert.rejects(async () => {
      // Execute transaction to change the  collateral ratio
      await testHelper.includeTx(
        testHelper.agents.alice.keys,
        async () => {
          await testHelper.engine.contract.govUpdateCollateralRatio(
            sideLoadedProof,
            verificationKey,
            witness,
            generateNextUpdateWitnessFromRoot(resolutionNullifierRoot)
          );
        },
        { name: 'Alice tries to change the collateral ratio using the same admin signature update.' }
      );
    });

    // additionally it should try with the previous root as well
    assert.rejects(async () => {
      await testHelper.includeTx(
        testHelper.agents.alice.keys,
        async () => {
          await testHelper.engine.contract.govUpdateCollateralRatio(
            sideLoadedProof,
            verificationKey,
            witness,
            generateNextUpdateWitnessFromRoot(previousRoot)
          );
        },
        { name: 'Alice tries again to change the collateral ratio using the same admin signature update.' }
      );
    });

  });

  it('should not allow the update proof without admin sig to change the collateral ratio', async () => {

    const resolutionNullifierRoot = await testHelper.engine.contract.govResolutionNullifierTreeRoot.fetch();
    if (!resolutionNullifierRoot) throw new Error('govResolutionNullifierTreeRoot is undefined');

    const updateInput = mkProtocolUpdateInput(
      ZkusdProtocolUpdateOperation.collateralRatio(
        UInt8Operation.mkSetTo(UInt8.from(150))
      ),
      { resolutionNullifierRoot }
    );

    const { sideLoadedProof, verificationKey, witness } =
      await createSigProof(updateInput, testHelper.agents.alice.keys.privateKey);

    // Execute transaction to stop the protocol
    await assert.rejects(async () => {
      await testHelper.includeTx(
        testHelper.agents.alice.keys,
        async () => {
          await testHelper.engine.contract.govUpdateCollateralRatio(
            sideLoadedProof,
            verificationKey,
            witness,
            generateNextUpdateWitnessFromRoot(resolutionNullifierRoot)
          );
        },
        { name: 'Alice attepts to change the collateral ratio without admin signature' }
      );
    }, 'Expected transaction to fail but it succeeded.');
  });

  it('should not allow the update proof with malformed signature messagedata', async () => {

    const resolutionNullifierRoot = await testHelper.engine.contract.govResolutionNullifierTreeRoot.fetch();
    if (!resolutionNullifierRoot) throw new Error('govResolutionNullifierTreeRoot is undefined');

    const updateInput = mkProtocolUpdateInput(
      ZkusdProtocolUpdateOperation.collateralRatio(
        UInt8Operation.mkSetTo(UInt8.from(150))
      ),
      { resolutionNullifierRoot }
    );

    const { sideLoadedProof, verificationKey, witness } =
      await createAdminSigProof(updateInput);

    const hash1 = Poseidon.hash(zkusdProtocolUpdateInputToFields(sideLoadedProof.publicInput));

    sideLoadedProof.publicInput.protocolUpdateOperation.collateralRatio = UInt8Operation.mkSetTo(UInt8.from(140));

    const hash2 = Poseidon.hash(zkusdProtocolUpdateInputToFields(sideLoadedProof.publicInput));

    assert.notEqual(hash1.toString(), hash2.toString(), 'Hashes should be different');

    // Execute transaction to stop the protocol
    await assert.rejects(async () => {
      await testHelper.includeTx(
        testHelper.agents.alice.keys,
        async () => {
          await testHelper.engine.contract.govUpdateCollateralRatio(
            sideLoadedProof,
            verificationKey,
            witness,
            generateNextUpdateWitnessFromRoot(resolutionNullifierRoot)
          );
        },
        { name: 'Alice attempts to change the collateral ratio with malformed signature' }
      );
    }, 'Expected transaction to fail but it succeeded.');
  });

  // describe('Blockchain Length Precondition Tests (Bob)', () => {

  //   // Suppose we require the chain length to be >= 1010 to start
  //   const requiredChainLength = 1010;

  //   it("Bob can't start the protocol if the blockchain length is below the required threshold", async () => {
  //     // Confirm the protocol is still stopped from previous tests
  //     await testHelper.mina.fetchMinaAccount(
  //       testHelper.engine.contract.address,
  //       { force: true }
  //     );
  //     let isStopped = testHelper.engine.contract
  //       .isEmergencyStopped()
  //       .toBoolean();
  //     assert.equal(isStopped, true, 'Protocol should currently be stopped');

  //     // Create an update input that tries to start the protocol (set emergencyStop = false)
  //     // but also requires the current blockchain length to be >= requiredChainLength
  //     const updateInput = updateProtocolEmergencyStop({
  //       // these fields might differ based on your updateProtocolEmergencyStop signature
  //       blockchainPreconditions: MinaBlockchainPreconditions.blockchainLength(UInt32.from(requiredChainLength), UInt32.from(2000)),
  //       emergencyStopOperation: BoolOperation.mkSetTo(Bool(false)),
  //       protocolPreconditions: ZkusdUpdatePreconditions.create({
  //         // Protocol is currently stopped => mustEqual(true)
  //         emergencyStop: BooleanPrecondition.mkMustEqual(true),
  //       }),
  //     });

  //     // Create the proof signed by the actual protocol admin
  //     const { sideLoadedProof, verificationKey, witness } =
  //       await createAdminSigProof(updateInput);

  //     // Bob includes the transaction, but if the blockchain length is < requiredChainLength,
  //     // the transaction should fail due to the unmet precondition
  //     await assert.rejects(
  //       async () => {
  //         await testHelper.includeTx(
  //           testHelper.agents.bob.keys, // Bob is the sender
  //           async () => {
  //             await testHelper.engine.contract.govToggleEmergencyStop(
  //               verificationKey,
  //               witness,
  //               sideLoadedProof
  //             );
  //           },
  //           {
  //             name: "Bob attempts to start protocol but blockchain length hasn't reached the threshold",
  //           }
  //         );
  //       },
  //       'Expected transaction to fail but it succeeded.'
  //     );

  //     // The protocol should remain stopped
  //     await testHelper.mina.fetchMinaAccount(
  //       testHelper.engine.contract.address,
  //       { force: true }
  //     );
  //     isStopped = testHelper.engine.contract.isEmergencyStopped().toBoolean();
  //     assert.equal(isStopped, true, 'Protocol should remain stopped');
  //   });

  //   it('Bob can start the protocol once the blockchain length threshold is reached', async () => {
  //     // Move the chain forward until we satisfy the required length (from previous test).
  //     // If we started at 1000, and need 1010, move 10 blocks forward:
  //     await testHelper.mina.moveChainForward(10);

  //     // The same updateInput from the previous test can be reused,
  //     // or you can recreate it for clarity:
  //     const updateInput = updateProtocolEmergencyStop({
  //       emergencyStopOperation: BoolOperation.mkSetTo(Bool(false)),
  //       blockchainPreconditions: MinaBlockchainPreconditions.blockchainLength(UInt32.from(requiredChainLength), UInt32.from(2000)),
  //       protocolPreconditions: ZkusdUpdatePreconditions.create({
  //         // protocol is currently stopped => mustEqual(true)
  //         emergencyStop: BooleanPrecondition.mkMustEqual(true),
  //         // blockchainLength: NumericPrecondition.mkMustBeGreaterOrEqual(1010),
  //       }),
  //     });

  //     const { sideLoadedProof, verificationKey, witness } =
  //       await createAdminSigProof(updateInput);

  //     // Now the chain length should be >= 1010, so the transaction ought to succeed
  //     await testHelper.includeTx(
  //       testHelper.agents.bob.keys,
  //       async () => {
  //         await testHelper.engine.contract.govToggleEmergencyStop(
  //           verificationKey,
  //           witness,
  //           sideLoadedProof
  //         );
  //       },
  //       {
  //         name: 'Bob successfully starts protocol after blockchain length threshold is met',
  //       }
  //     );

  //     // Verify the protocol is now running
  //     await testHelper.mina.fetchMinaAccount(
  //       testHelper.engine.contract.address,
  //       { force: true }
  //     );
  //     const isStopped = testHelper.engine.contract
  //       .isEmergencyStopped()
  //       .toBoolean();
  //     assert.equal(isStopped, false, 'Protocol should now be running');
  //   });
  // });
});

