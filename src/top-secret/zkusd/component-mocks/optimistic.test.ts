// import { before, describe, it } from 'node:test';
// import assert from 'node:assert';
// import {
//   MapProviderImpl,
//   StateComputeSimulator,
// } from './state-compute-simulator.js';
// import { InitialState } from './state-compute-simulator.js';
// import { Scenario } from './state-compute-simulator.js';
// import { Circuit, Field, Provable, UInt64 } from 'o1js';
// import { VaultMap } from './data/maps/vault-map.js';
// import { ZkUsdMap } from './data/maps/zkusd-map.js';

// describe('Optimistic Provisional Tests', () => {
//   before(() => {});
//   it('Single step happy-path', async () => {
//     const simulator = new StateComputeSimulator(InitialState.empty());

//     const scenario = new Scenario(
//       new MapProviderImpl(
//         async () => simulator.intentVaultMap(),
//         async () => simulator.intentZkUsdMap()
//       ),
//       await simulator.zkusdState
//     );
//     await scenario.addCreateVaultIntent(0);
//     await scenario.addDepositCollateralIntent(0, UInt64.from(500));
//     await scenario.addBlockEnd();

//     const stateBefore = await simulator.intentVaultMap();
//     //  log root
//     Provable.log('stateBefore.root', stateBefore.root);

//     await simulator.simulateScenario(InitialState.empty(), scenario, 2);

//     const stateAfter = await simulator.intentVaultMap();
//     //  log root
//     Provable.log('stateAfter.root', stateAfter.root);

//     assert.strictEqual(1, 1);
//   });
// });
