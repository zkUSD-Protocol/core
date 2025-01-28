// import { TestHelper, TestAmounts } from '../../test-helper.js';
// import { describe, it, before } from 'node:test';
// import { ZkUsdEngineContract } from '../../../contracts/zkusd-engine.js';
// import {
//   AggregateOraclePrices,
//   OraclePriceSubmissions,
//   PriceSubmission,
// } from '../../../proofs/oracle-price-aggregation/prove.js';
// import {
//   AccountUpdate,
//   Bool,
//   Mina,
//   PrivateKey,
//   PublicKey,
//   Signature,
//   UInt32,
//   UInt64,
//   UInt8,
//   VerificationKey,
// } from 'o1js';
// import { getNetworkKeys, NetworkKeyPairs } from '../../../config/keys.js';
// import { FungibleTokenContract } from '@minatokens/token';

// import { Vault } from '../../../types/vault.js';
// import { MinaNetworkInterface } from '../../../mina/mina-network-interface.js';
// import { TransactionManager } from '../../../mina/transaction-manager.js';
// import { validPriceBlockCount } from '../../../mina/networks.js';
// import { MinaPriceInput } from '../../../proofs/oracle-price-aggregation/verify.js';
// import Client from 'mina-signer';
// import assert from 'node:assert';
// import { OracleWhitelist } from '../../../types/oracle.js';
// import { ContractInstance, KeyPair } from '../../../types/utility.js';

// const client = new Client({
//   network: 'testnet',
// });

// describe('zkUSD Upgradability - Hardfork Test Suite', () => {
//   let testHelper: TestHelper;
//   let oneUsdPrice: MinaPriceInput;
//   let txMgr: TransactionManager;

//   before(async () => {
//     const MinaChain = await MinaNetworkInterface.initLocal({
//       proofsEnabled: false,
//     });

//     testHelper = await TestHelper.initLocalChain({ proofsEnabled: false });
//     await testHelper.deployTokenContracts();
//     await testHelper.createAgents('alice');
//     await testHelper.createVaults('alice');

//     txMgr = testHelper.txMgr;

//     oneUsdPrice = await testHelper.getMinaPriceInput(TestAmounts.PRICE_1_USD);
//   });

//   it('should be able to create a vault', async () => {
//     const aliceVaultAccount = await txMgr.mina.fetchMinaAccount(
//       testHelper.agents.alice.vault!.publicKey,
//       {
//         tokenId: testHelper.engine.contract.deriveTokenId(),
//         force: true,
//       }
//     );

//     console.log(aliceVaultAccount);

//     for (const field of aliceVaultAccount?.zkapp?.appState!) {
//       console.log(field);
//     }
//   });

//   it('should be able to deposit collateral into a vault', async () => {
//     const depositCollateralTx = await txMgr.tx(
//       testHelper.agents.alice.keys,
//       async () => {
//         await testHelper.engine.contract.depositCollateral(
//           testHelper.agents.alice.vault!.publicKey,
//           TestAmounts.COLLATERAL_100_MINA
//         );
//       },
//       {
//         name: 'Depositing collateral into a vault',
//         printTx: true,
//       }
//     );
//     await depositCollateralTx.awaitIncluded();

//     const aliceVaultAccount = await txMgr.mina.fetchMinaAccount(
//       testHelper.agents.alice.vault!.publicKey,
//       {
//         tokenId: testHelper.engine.contract.deriveTokenId(),
//         force: true,
//       }
//     );

//     const vaultState = Vault.fromAccount(aliceVaultAccount!);

//     console.log(vaultState.collateralAmount.toString());
//     console.log(vaultState.debtAmount.toString());
//     console.log(vaultState.owner.toBase58());
//   });

//   it('should be able to mint zkUSD from a vault', async () => {
//     const mintZkUsdTx = await txMgr.tx(
//       testHelper.agents.alice.keys,
//       async () => {
//         await testHelper.engine.contract.mintZkUsd(
//           testHelper.agents.alice.vault!.publicKey,
//           TestAmounts.DEBT_5_ZKUSD,
//           oneUsdPrice
//         );
//       },
//       {
//         name: 'Minting zkUSD from a vault',
//         printTx: true,
//       }
//     );
//     await mintZkUsdTx.awaitIncluded();

//     const aliceVaultAccount = await txMgr.mina.fetchMinaAccount(
//       testHelper.agents.alice.vault!.publicKey,
//       {
//         tokenId: testHelper.engine.contract.deriveTokenId(),
//         force: true,
//       }
//     );

//     const aliceBalance = await testHelper.token.contract.getBalanceOf(
//       testHelper.agents.alice.keys.publicKey
//     );

//     const vaultState = Vault.fromAccount(aliceVaultAccount!);

//     assert.deepStrictEqual(vaultState.debtAmount, TestAmounts.DEBT_5_ZKUSD);
//     assert.deepStrictEqual(aliceBalance, TestAmounts.DEBT_5_ZKUSD);
//   });

//   it('should be able to repay debt from a vault', async () => {
//     const repayDebtTx = await txMgr.tx(
//       testHelper.agents.alice.keys,
//       async () => {
//         await testHelper.engine.contract.burnZkUsd(
//           testHelper.agents.alice.vault!.publicKey,
//           TestAmounts.DEBT_1_ZKUSD
//         );
//       },
//       {
//         name: 'Repaying debt from a vault',
//         printTx: true,
//       }
//     );
//     await repayDebtTx.awaitIncluded();

//     const aliceVaultAccount = await txMgr.mina.fetchMinaAccount(
//       testHelper.agents.alice.vault!.publicKey,
//       {
//         tokenId: testHelper.engine.contract.deriveTokenId(),
//         force: true,
//       }
//     );

//     const vaultState = Vault.fromAccount(aliceVaultAccount!);

//     const aliceBalance = await testHelper.token.contract.getBalanceOf(
//       testHelper.agents.alice.keys.publicKey
//     );

//     assert.deepStrictEqual(vaultState.debtAmount, TestAmounts.DEBT_4_ZKUSD);
//     assert.deepStrictEqual(aliceBalance, TestAmounts.DEBT_4_ZKUSD);
//   });

//   it('should be able to redeem collateral from a vault', async () => {
//     const aliceMinaBalanceBefore = Mina.getBalance(
//       testHelper.agents.alice.keys.publicKey
//     );

//     const fee = 1e7;

//     const redeemCollateralTx = await txMgr.tx(
//       testHelper.agents.alice.keys,
//       async () => {
//         await testHelper.engine.contract.redeemCollateral(
//           testHelper.agents.alice.vault!.publicKey,
//           TestAmounts.COLLATERAL_20_MINA,
//           oneUsdPrice
//         );
//       },
//       {
//         name: 'Redeeming collateral from a vault',
//         printTx: true,
//       }
//     );
//     await redeemCollateralTx.awaitIncluded();

//     const aliceVaultAccount = await txMgr.mina.fetchMinaAccount(
//       testHelper.agents.alice.vault!.publicKey,
//       {
//         tokenId: testHelper.engine.contract.deriveTokenId(),
//         force: true,
//       }
//     );

//     const vaultState = Vault.fromAccount(aliceVaultAccount!);

//     const aliceMinaBalanceAfter = Mina.getBalance(
//       testHelper.agents.alice.keys.publicKey
//     );

//     assert.deepStrictEqual(
//       vaultState.collateralAmount,
//       TestAmounts.COLLATERAL_80_MINA
//     );

//     console.log('Mina balance before: ', aliceMinaBalanceBefore.toString());
//     console.log('Mina balance after: ', aliceMinaBalanceAfter.toString());

//     console.log(
//       'Mina balance difference: ',
//       aliceMinaBalanceAfter.sub(aliceMinaBalanceBefore).toBigInt()
//     );

//     assert.deepStrictEqual(
//       aliceMinaBalanceBefore.add(TestAmounts.COLLATERAL_20_MINA).sub(fee),
//       aliceMinaBalanceAfter
//     );
//   });

//   //   it('should let us edit the vault state', async () => {
//   //   it('should let us edit the vault state', async () => {
//   //     console.log(
//   //       "Alice's Vault Address: ",
//   //       agents.alice.vault!.publicKey.toBase58()
//   //     );
//   //     console.log('Alice public key: ', agents.alice.keys.publicKey.toBase58());
//   //     console.log('Alice private key: ', agents.alice.keys.privateKey.toBase58());

//   //     console.log('Deployer public key: ', deployer.publicKey.toBase58());
//   //     console.log('Deployer private key: ', deployer.privateKey.toBase58());

//   //     console.log(
//   //       'Alice vault public key: ',
//   //       agents.alice.vault!.publicKey.toBase58()
//   //     );

//   //     const editTx = await txMgr.tx(
//   //       agents.alice.keys,
//   //       async () => {
//   //         await engine.contract.testStateManagement(
//   //           agents.alice.vault!.publicKey
//   //         );
//   //       },
//   //       {
//   //         name: 'Editing vault state',
//   //         printTx: true,
//   //       }
//   //     );

//   //     await editTx.awaitIncluded();

//   //     const aliceAccount = await txMgr.mina.fetchMinaAccount(
//   //       agents.alice.vault!.publicKey,
//   //       {
//   //         tokenId: engine.contract.deriveTokenId(),
//   //         force: true,
//   //       }
//   //     );

//   //     console.log(
//   //       'Collateral Amount: ',
//   //       aliceAccount?.zkapp?.appState?.[0]?.value
//   //     );
//   //   });

//   //   it('should not allow a user to edit the vault state', async () => {
//   //     const editTx = await txMgr.tx(
//   //       agents.alice.keys,
//   //       async () => {
//   //         const au = AccountUpdate.create(
//   //           agents.alice.vault!.publicKey,
//   //           engine.contract.deriveTokenId()
//   //         );

//   //         au.body.update.appState[0] = {
//   //           isSome: Bool(true),
//   //           value: UInt64.from(300).toFields()[0],
//   //         };

//   //         au.body.mayUseToken = AccountUpdate.MayUseToken.No;
//   //       },
//   //       {
//   //         name: 'Editing vault state outside of',
//   //         // extraSigners: [agents.alice.vault!.privateKey],
//   //         printTx: true,
//   //       }
//   //     );

//   //     await editTx.awaitIncluded();

//   //     const aliceAccount = await txMgr.mina.fetchMinaAccount(
//   //       agents.alice.vault!.publicKey,
//   //       {
//   //         tokenId: engine.contract.deriveTokenId(),
//   //         force: true,
//   //       }
//   //     );

//   //     console.log(aliceAccount?.zkapp?.appState?.[0]?.value);
//   //   });
// });
