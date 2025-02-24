import {
  Bool,
  Field,
  Poseidon,
  PrivateKey,
  PublicKey,
  Signature,
  UInt64,
} from 'o1js';
import { TestAmounts, TestHelper } from '../../test-helper.js';
import { OracleWhitelist } from '../../../system/oracle.js';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  AggregateOraclePrices,
  OraclePriceSubmissions,
  PriceSubmission,
} from '../../../proofs/oracle-price-aggregation/prove.js';
import Client from 'mina-signer';
import { MinaPriceInput } from '../../../proofs/oracle-price-aggregation/verify.js';

const client = new Client({
  network: 'testnet',
});

describe('zkUSD Engine Oracle Whitelist Test Suite', () => {
  let th: TestHelper<'local'>;
  let whitelist: OracleWhitelist;
  let previousWhitelistHash: Field;
  let newWhitelistHash: Field;

  before(async () => {
    th = await TestHelper.initLocalChain({ proofsEnabled: false });
    await th.deployTokenContracts();
    whitelist = th.whitelist;
  });

  beforeEach(async () => {
    //reset the whitelist
    th.whitelist = {
      ...whitelist,
      addresses: [...whitelist.addresses],
    };
  });

  it('should allow the whitelist to be updated with the admin key', async () => {
    const currentWhitelist = th.whitelistedOracles.size;
    const whitelist = th.whitelist;

    const newOracle = PrivateKey.random().toPublicKey();
    whitelist.addresses[0] = newOracle;

    previousWhitelistHash =
      (await th.engine.contract.oracleWhitelistHash.fetch()) as Field;

    await th.includeTx(
      th.deployer,
      async () => {
        await th.engine.contract.updateOracleWhitelist(whitelist);
      },
      {
        extraSigners: [th.networkKeys.protocolAdmin.privateKey],
      }
    );

    const expectedWhitelistHash = Poseidon.hash(
      OracleWhitelist.toFields(whitelist)
    );

    newWhitelistHash =
      (await th.engine.contract.oracleWhitelistHash.fetch()) as Field;

    assert.deepStrictEqual(newWhitelistHash, expectedWhitelistHash);
  });

  it('should emit the oracle whitelist update event', async () => {
    const contractEvents = await th.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'OracleWhitelistUpdated');
    // @ts-ignore
    assert.deepStrictEqual(latestEvent.event.data.newHash, newWhitelistHash);

    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.previousHash,
      previousWhitelistHash
    );
  });

  it('should not allow updating the whitelist without the admin key', async () => {
    const whitelist = th.whitelist;

    const newOracle = PrivateKey.random().toPublicKey();
    whitelist.addresses[0] = newOracle;

    await assert.rejects(
      th.includeTx(th.deployer, async () => {
        await th.engine.contract.updateOracleWhitelist(whitelist);
      }),
      /Transaction verification failed/
    );
  });

  it('should not allow updating with a whitelist that has more than 8 addresses', async () => {
    const whitelist = th.whitelist;

    for (let i = 0; i < 10; i++) {
      whitelist.addresses[i] = PrivateKey.random().toPublicKey();
    }

    await assert.rejects(
      th.includeTx(
        th.deployer,
        async () => {
          await th.engine.contract.updateOracleWhitelist(whitelist);
        },
        {
          extraSigners: [th.networkKeys.engine.privateKey],
        }
      ),
      /Expected witnessed values of length 16, got 20./
    );
  });

  it('should not allow updating with an invalid whitelist', async () => {
    th.whitelist.addresses[1] = 'RandomString' as unknown as PublicKey;

    await assert.rejects(
      th.includeTx(
        th.deployer,
        async () => {
          await th.engine.contract.updateOracleWhitelist(th.whitelist);
        },
        {
          extraSigners: [th.networkKeys.engine.privateKey],
        }
      ),
      /Cannot convert undefined to a BigInt/
    );
  });

  it('should allow us to use a whitelist and use a price submission with three oracles ', async () => {
    let priceSubmissions: PriceSubmission[] = [];
    let oracleWhitelist: OracleWhitelist = {
      addresses: [],
    };
    let oracles: {
      [key: string]: {
        privateKey: PrivateKey;
        publicKey: PublicKey;
      };
    } = {};
    const blockHeight = th.mina.getNetworkState().blockchainLength;
    const price = TestAmounts.PRICE_2_USD;

    for (let i = 0; i < 3; i++) {
      const oracleName = 'oracle' + (i + 1);
      const oraclePrivateKey = PrivateKey.random();
      const oraclePublicKey = oraclePrivateKey.toPublicKey();

      oracleWhitelist.addresses[i] = oraclePublicKey;
      oracles[oracleName] = {
        privateKey: oraclePrivateKey,
        publicKey: oraclePublicKey,
      };

      const signature = client.signFields(
        [price.toBigInt(), blockHeight.toBigint()],
        oraclePrivateKey.toBase58()
      );

      priceSubmissions.push(
        new PriceSubmission({
          publicKey: oraclePublicKey,
          price: price,
          blockHeight: blockHeight,
          signature: Signature.fromBase58(signature.signature),
          isDummy: Bool(false),
        })
      );
    }

    const oraclePriceSubmissions = new OraclePriceSubmissions({
      submissions: priceSubmissions,
    });

    // Fill remaining whitelist slots with empty keys
    for (let i = 3; i < OracleWhitelist.MAX_PARTICIPANTS; i++) {
      //We have to use a random oracle public key for "fake" oracles
      const randomOraclePublicKey = PrivateKey.random().toPublicKey();

      oracleWhitelist.addresses[i] = randomOraclePublicKey;

      oraclePriceSubmissions.submissions[i] = new PriceSubmission({
        publicKey: randomOraclePublicKey,
        price: UInt64.zero,
        blockHeight: blockHeight,
        signature: Signature.empty(),
        isDummy: Bool(true),
      });
    }

    await th.includeTx(
      th.deployer,
      async () => {
        await th.engine.contract.updateOracleWhitelist(oracleWhitelist);
      },
      {
        extraSigners: [th.networkKeys.protocolAdmin.privateKey],
        name: 'Oracle Whitelist Test Suite: Update Oracle Whitelist with 3 oracles',
      }
    );

    const oracleWhitelistHash = OracleWhitelist.hash(oracleWhitelist);

    const programOutput = await AggregateOraclePrices.compute(
      {
        currentBlockHeight: blockHeight,
        oracleWhitelistHash,
      },
      {
        oracleWhitelist,
        oraclePriceSubmissions,
      }
    );

    const proof = programOutput.proof;

    const priceInput = new MinaPriceInput({
      proof,
      verificationKey: th.oracleAggregationVk,
    });

    //Lets create an agent and a vault and deposit/mint some zkUSD
    await th.createLocalAgents('alice');
    await th.createVaults('alice');

    await th.includeTx(th.agents.alice.keys, async () => {
      await th.engine.contract.depositCollateral(
        th.agents.alice.vault!.publicKey,
        TestAmounts.COLLATERAL_100_MINA
      );
    });

    await th.includeTx(th.agents.alice.keys, async () => {
      await th.engine.contract.mintZkUsd(
        th.agents.alice.vault!.publicKey,
        TestAmounts.DEBT_10_ZKUSD,
        priceInput
      );
    });

    const aliceBalance = await th.token.contract.getBalanceOf(
      th.agents.alice.keys.publicKey
    );

    assert.deepStrictEqual(aliceBalance, TestAmounts.DEBT_10_ZKUSD);
  });
});
