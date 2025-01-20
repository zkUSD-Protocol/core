// import { describe, it, before } from 'node:test';
// import assert from 'node:assert';
// import {
//   PrivateKey,
//   Mina,
//   AccountUpdate,
//   VerificationKey,
//   UInt64,
//   Cache,
//   PublicKey,
//   setNumberOfWorkers,
// } from 'o1js';

// import {
//   zkCloudWorkerClient,
//   blockchain,
//   sleep,
//   Memory,
//   fetchMinaAccount,
//   fee,
//   initBlockchain,
//   serializeFields,
//   accountBalanceMina,
// } from 'zkcloudworker';
// import { zkcloudworker } from '../../../index.js';

// setNumberOfWorkers(8);

// const api = new zkCloudWorkerClient({
//   jwt: 'local',
//   zkcloudworker,
//   chain: 'lightnet',
// });

// let deployer: PrivateKey;

// const developer = 'zkusd';
// const repo = 'zkusd';

// describe('zkUSD Cloud Worker Test Suite', () => {
//   it('should initialize the blockchain', async () => {
//     const { keys } = await initBlockchain('lightnet', 2);
//     assert(keys.length >= 2, 'Keys length should be greater than 2');
//     deployer = keys[0].key;
//   });
//   it('should compile the contracts', async () => {
//     const result = await api.execute({
//       developer,
//       repo,
//       transactions: [],
//       task: 'compile',
//       args: JSON.stringify({}),
//     });
//     console.log(result);
//   });
// });
