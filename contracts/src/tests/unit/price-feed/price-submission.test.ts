import {
  AccountUpdate,
  Bool,
  Mina,
  UInt32,
  UInt64,
} from 'o1js';
import { TestAmounts, TestHelper } from '../../test-helper.js';
import {
  OracleWhitelist,
  PriceSubmission,
  PriceSubmissionPacked,
  ProtocolData,
} from '../../../types.js';
import { ZkUsdEngineErrors } from '../../../contracts/zkusd-engine.js';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  ZkUsdMasterOracleErrors,
} from '../../../contracts/zkusd-master-oracle.js';
import { ZkUsdPriceTracker } from '../../../contracts/zkusd-price-tracker.js';
import { transaction } from '../../../utils/transaction.js';

describe('zkUSD Price Feed Oracle Submission Test Suite', () => {
  const testHelper = new TestHelper();

  let whitelist: OracleWhitelist;
  let whitelistedOracles: Map<string, number>;

  before(async () => {
    await testHelper.initLocalChain({proofsEnabled: false});
    await testHelper.deployTokenContracts();
    whitelist = testHelper.whitelist;
    whitelistedOracles = testHelper.whitelistedOracles;
    await testHelper.createAgents(['alice']);
  });

  const getWriteTrackerAddress = () => {
    const isEven = testHelper.chain
      .getNetworkState()
      .blockchainLength.mod(2)
      .equals(UInt32.from(0))
      .toBoolean();

    return isEven
      ? testHelper.networkKeys.evenOraclePriceTracker.publicKey
      : testHelper.networkKeys.oddOraclePriceTracker.publicKey;
  };

  beforeEach(async () => {
    //reset the whitelist
    testHelper.whitelist = {
      ...whitelist,
      addresses: [...whitelist.addresses],
    };
    testHelper.whitelistedOracles = new Map(whitelistedOracles);

    await transaction(
      testHelper.agents.alice.keys,
      async () => {
        await testHelper.engine.contract.updateOracleWhitelist(
          testHelper.whitelist
        );
      },
      {
        extraSigners: [testHelper.networkKeys.protocolAdmin.privateKey],
      }
    );

    //settle any outstanding actions
    await transaction(testHelper.agents.alice.keys, async () => {
      await testHelper.engine.contract.settlePriceUpdate();
    });
  });

  it('should allow a whitelisted address to submit a price', async () => {
    const whitelistedOracles = testHelper.whitelistedOracles;
    const oracleName = Array.from(whitelistedOracles.keys())[0];

    await transaction(testHelper.oracles[oracleName], async () => {
      await testHelper.engine.contract.submitPrice(
        TestAmounts.PRICE_48_CENT,
        testHelper.whitelist
      );
    });

    const trackerAddress = getWriteTrackerAddress();

    const tracker = new ZkUsdPriceTracker(
      trackerAddress,
      testHelper.engine.contract.deriveTokenId()
    );

    const priceSubmission = await tracker.oracleOne.fetch();
    const submission = PriceSubmission.unpack(priceSubmission!);

    assert.deepStrictEqual(submission.price, TestAmounts.PRICE_48_CENT);
  });

  it('should submit the price to the even price tracker on an even block', async () => {
    testHelper.chain.local?.setBlockchainLength(UInt32.from(2));

    const whitelistedOracles = testHelper.whitelistedOracles;
    const oracleName = Array.from(whitelistedOracles.keys())[0];

    await transaction(testHelper.oracles[oracleName], async () => {
      await testHelper.engine.contract.submitPrice(
        TestAmounts.PRICE_52_CENT,
        testHelper.whitelist
      );
    });

    const trackerAddress = getWriteTrackerAddress();

    assert.deepStrictEqual(
      trackerAddress,
      testHelper.networkKeys.evenOraclePriceTracker.publicKey
    );

    const tracker = new ZkUsdPriceTracker(
      trackerAddress,
      testHelper.engine.contract.deriveTokenId()
    );

    const priceSubmission = await tracker.oracleOne.fetch();
    const submission = PriceSubmission.unpack(priceSubmission!);

    assert.deepStrictEqual(submission.price, TestAmounts.PRICE_52_CENT);
  });

  it('should submit the price to the odd price tracker on an odd block', async () => {
    testHelper.chain.local?.setBlockchainLength(UInt32.from(1001));

    const whitelistedOracles = testHelper.whitelistedOracles;
    const oracleName = Array.from(whitelistedOracles.keys())[0];

    await transaction(testHelper.oracles[oracleName], async () => {
      await testHelper.engine.contract.submitPrice(
        TestAmounts.PRICE_49_CENT,
        testHelper.whitelist
      );
    });

    const trackerAddress = getWriteTrackerAddress();

    assert.deepStrictEqual(
      trackerAddress,
      testHelper.networkKeys.oddOraclePriceTracker.publicKey
    );

    const tracker = new ZkUsdPriceTracker(
      trackerAddress,
      testHelper.engine.contract.deriveTokenId()
    );

    const priceSubmission = await tracker.oracleOne.fetch();
    const submission = PriceSubmission.unpack(priceSubmission!);

    assert.deepStrictEqual(submission.price, TestAmounts.PRICE_49_CENT);
  });

  it('should emit the price submission event', async () => {
    const whitelistedOracles = testHelper.whitelistedOracles;
    const oracleName = Array.from(whitelistedOracles.keys())[0];

    await transaction(testHelper.oracles[oracleName], async () => {
      await testHelper.engine.contract.submitPrice(
        TestAmounts.PRICE_25_CENT,
        testHelper.whitelist
      );
    });

    const contractEvents = await testHelper.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'MinaPriceSubmission');
    assert.strictEqual(
      // @ts-ignore
      latestEvent.event.data.submitter.toBase58(),
      testHelper.oracles[oracleName].publicKey.toBase58()
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.price,
      TestAmounts.PRICE_25_CENT
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.oracleFee,
      TestAmounts.COLLATERAL_1_MINA
    );
  });

  it('should not allow a non-whitelisted address to submit a price', async () => {
    await assert.rejects(async () => {
      await transaction(testHelper.agents.alice.keys, async () => {
        await testHelper.engine.contract.submitPrice(
          TestAmounts.PRICE_25_CENT,
          testHelper.whitelist
        );
      });
    }, new RegExp(ZkUsdEngineErrors.SENDER_NOT_WHITELISTED));
  });

  it('should not allow a different version of the whitelist', async () => {
    const fakeWhitelist = testHelper.whitelist;
    fakeWhitelist.addresses[0] = testHelper.agents.alice.keys.publicKey;

    await assert.rejects(async () => {
      await transaction(testHelper.agents.alice.keys, async () => {
        await testHelper.engine.contract.submitPrice(
          TestAmounts.PRICE_25_CENT,
          fakeWhitelist
        );
      });
    }, new RegExp(ZkUsdEngineErrors.INVALID_WHITELIST));
  });

  it('should not allow a price to be submitted with a price of 0', async () => {
    const whitelistedOracles = testHelper.whitelistedOracles;
    const oracleName = Array.from(whitelistedOracles.keys())[0];

    await assert.rejects(async () => {
      await transaction(testHelper.oracles[oracleName], async () => {
        await testHelper.engine.contract.submitPrice(
          TestAmounts.ZERO,
          testHelper.whitelist
        );
      });
    }, new RegExp(ZkUsdEngineErrors.AMOUNT_ZERO));
  });

  it('should allow all the whitelisted oracles to submit prices', async () => {
    const whitelistedOracles = testHelper.whitelistedOracles;
    const oracleNames = Array.from(whitelistedOracles.keys());

    for (const oracleName of oracleNames) {
      await transaction(testHelper.oracles[oracleName], async () => {
        await testHelper.engine.contract.submitPrice(
          TestAmounts.PRICE_25_CENT,
          testHelper.whitelist
        );
      });
    }

    const trackerAddress = getWriteTrackerAddress();

    const tracker = new ZkUsdPriceTracker(
      trackerAddress,
      testHelper.engine.contract.deriveTokenId()
    );

    const oracleOnePackedData = await tracker.oracleOne.fetch();
    const oracleTwoPackedData = await tracker.oracleTwo.fetch();
    const oracleThreePackedData = await tracker.oracleThree.fetch();
    const oracleFourPackedData = await tracker.oracleFour.fetch();
    const oracleFivePackedData = await tracker.oracleFive.fetch();
    const oracleSixPackedData = await tracker.oracleSix.fetch();
    const oracleSevenPackedData = await tracker.oracleSeven.fetch();
    const oracleEightPackedData = await tracker.oracleEight.fetch();

    const oracleOneSubmission = PriceSubmission.unpack(oracleOnePackedData!);
    const oracleTwoSubmission = PriceSubmission.unpack(oracleTwoPackedData!);
    const oracleThreeSubmission = PriceSubmission.unpack(
      oracleThreePackedData!
    );
    const oracleFourSubmission = PriceSubmission.unpack(oracleFourPackedData!);
    const oracleFiveSubmission = PriceSubmission.unpack(oracleFivePackedData!);
    const oracleSixSubmission = PriceSubmission.unpack(oracleSixPackedData!);
    const oracleSevenSubmission = PriceSubmission.unpack(
      oracleSevenPackedData!
    );
    const oracleEightSubmission = PriceSubmission.unpack(
      oracleEightPackedData!
    );

    assert.deepStrictEqual(
      oracleOneSubmission.price,
      TestAmounts.PRICE_25_CENT
    );
    assert.deepStrictEqual(
      oracleTwoSubmission.price,
      TestAmounts.PRICE_25_CENT
    );
    assert.deepStrictEqual(
      oracleThreeSubmission.price,
      TestAmounts.PRICE_25_CENT
    );
    assert.deepStrictEqual(
      oracleFourSubmission.price,
      TestAmounts.PRICE_25_CENT
    );
    assert.deepStrictEqual(
      oracleFiveSubmission.price,
      TestAmounts.PRICE_25_CENT
    );
    assert.deepStrictEqual(
      oracleSixSubmission.price,
      TestAmounts.PRICE_25_CENT
    );
    assert.deepStrictEqual(
      oracleSevenSubmission.price,
      TestAmounts.PRICE_25_CENT
    );
    assert.deepStrictEqual(
      oracleEightSubmission.price,
      TestAmounts.PRICE_25_CENT
    );
  });

  it('should update the odd price tracker on an odd block', async () => {
    testHelper.chain.local?.setBlockchainLength(UInt32.from(1001));

    const whitelistedOracles = testHelper.whitelistedOracles;
    const oracleName = Array.from(whitelistedOracles.keys())[0];

    await transaction(testHelper.oracles[oracleName], async () => {
      await testHelper.engine.contract.submitPrice(
        TestAmounts.PRICE_2_USD,
        testHelper.whitelist
      );
    });

    const trackerAddress =
      testHelper.networkKeys.oddOraclePriceTracker.publicKey;

    const tracker = new ZkUsdPriceTracker(
      trackerAddress,
      testHelper.engine.contract.deriveTokenId()
    );

    const priceSubmission = await tracker.oracleOne.fetch();
    const submission = PriceSubmission.unpack(priceSubmission!);

    assert.deepStrictEqual(submission.price, TestAmounts.PRICE_2_USD);
  });

  it('should allow the fallback price to be updated with the admin key', async () => {
    await transaction(
      testHelper.deployer,
      async () => {
        await testHelper.engine.contract.updateFallbackPrice(
          TestAmounts.PRICE_52_CENT
        );
      },
      {
        extraSigners: [testHelper.networkKeys.protocolAdmin.privateKey],
      }
    );

    //move block forward
    testHelper.chain.local?.setBlockchainLength(
      testHelper.chain.getNetworkState().blockchainLength.add(1)
    );

    const fallbackPrice =
      await testHelper.masterOracle.contract.getFallbackPrice();

    assert.strictEqual(
      fallbackPrice.toString(),
      TestAmounts.PRICE_52_CENT.toString()
    );
  });

  it('should emit the fallback price update event', async () => {
    await transaction(
      testHelper.deployer,
      async () => {
        await testHelper.engine.contract.updateFallbackPrice(
          TestAmounts.PRICE_48_CENT
        );
      },
      {
        extraSigners: [testHelper.networkKeys.protocolAdmin.privateKey],
      }
    );

    const contractEvents = await testHelper.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'FallbackMinaPriceUpdate');
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.newPrice,
      TestAmounts.PRICE_48_CENT
    );
  });

  it('should update the even fallback price if we are on an odd block', async () => {
    testHelper.chain.local?.setBlockchainLength(UInt32.from(1));
    await transaction(
      testHelper.deployer,
      async () => {
        await testHelper.engine.contract.updateFallbackPrice(
          TestAmounts.PRICE_25_CENT
        );
      },
      {
        extraSigners: [testHelper.networkKeys.protocolAdmin.privateKey],
      }
    );

    const fallbackEvenPrice =
      await testHelper.masterOracle.contract.fallbackPriceEvenBlock.fetch();

    assert.strictEqual(
      fallbackEvenPrice?.toString(),
      TestAmounts.PRICE_25_CENT.toString()
    );
  });

  it('should update the odd fallback price if we are on an even block', async () => {
    testHelper.chain.local?.setBlockchainLength(UInt32.from(2));
    await transaction(
      testHelper.deployer,
      async () => {
        await testHelper.engine.contract.updateFallbackPrice(
          TestAmounts.PRICE_2_USD
        );
      },
      {
        extraSigners: [testHelper.networkKeys.protocolAdmin.privateKey],
      }
    );

    const fallbackOddPrice =
      await testHelper.masterOracle.contract.fallbackPriceOddBlock.fetch();

    assert.strictEqual(
      fallbackOddPrice?.toString(),
      TestAmounts.PRICE_2_USD.toString()
    );
  });

  it('should not allow the fallback price to be updated without the admin key', async () => {
    await assert.rejects(async () => {
      await transaction(testHelper.deployer, async () => {
        await testHelper.engine.contract.updateFallbackPrice(
          TestAmounts.PRICE_2_USD
        );
      });
    }, /Transaction verification failed/i);
  });

  it('should not allow the fallback price to be updated to 0', async () => {
    await assert.rejects(async () => {
      await transaction(
        testHelper.deployer,
        async () => {
          await testHelper.engine.contract.updateFallbackPrice(
            TestAmounts.ZERO
          );
        },
        {
          extraSigners: [testHelper.networkKeys.protocolAdmin.privateKey],
        }
      );
    }, new RegExp(ZkUsdMasterOracleErrors.AMOUNT_ZERO));
  });

  it('should pay out the oracle fee correctly', async () => {
    const packedData =
      await testHelper.engine.contract.protocolDataPacked.fetch();
    const protocolData = ProtocolData.unpack(packedData!);
    const oracleFee = protocolData.oracleFlatFee;

    //get the current balance of the price feed oracle
    const minaBalanceOfEngineBefore = Mina.getBalance(
      testHelper.networkKeys.engine.publicKey
    );

    const oracleFundsInEngineBefore =
      await testHelper.engine.contract.getAvailableOracleFunds();

    const whitelistedOracles = testHelper.whitelistedOracles;
    const oracleName = Array.from(whitelistedOracles.keys())[0];
    const oracle = testHelper.oracles[oracleName];

    // Get oracle's initial balance
    const oracleBalanceBefore = Mina.getBalance(oracle.publicKey);

    // Submit price from oracle
    await transaction(oracle, async () => {
      await testHelper.engine.contract.submitPrice(
        TestAmounts.PRICE_25_CENT,
        testHelper.whitelist
      );
    });

    // Get oracle's balance after submission
    const oracleBalanceAfter = Mina.getBalance(oracle.publicKey);

    const priceFeedOracleBalanceAfter = Mina.getBalance(
      testHelper.networkKeys.engine.publicKey
    );

    const oracleFundsInEngineAfter =
      await testHelper.engine.contract.getAvailableOracleFunds();

    // Verify oracle received the fee
    assert.strictEqual(
      oracleBalanceAfter.toString(),
      oracleBalanceBefore.add(oracleFee).toString()
    );

    assert.deepStrictEqual(
      minaBalanceOfEngineBefore.sub(priceFeedOracleBalanceAfter),
      oracleFee
    );

    assert.deepStrictEqual(
      oracleFundsInEngineBefore.sub(oracleFee),
      oracleFundsInEngineAfter
    );
  });

  it('should fail to submit the price if the contract runs out of available oracle funds', async () => {
    //get the current balance of the price feed oracle
    const priceFeedOracleBalanceBefore =
      await testHelper.engine.contract.getAvailableOracleFunds();

    //set the fee to the balance of the oracle to drain the funds
    await transaction(
      testHelper.deployer,
      async () => {
        await testHelper.engine.contract.updateOracleFee(
          priceFeedOracleBalanceBefore
        );
      },
      {
        extraSigners: [testHelper.networkKeys.protocolAdmin.privateKey],
      }
    );

    //submit a price
    const whitelistedOracles = testHelper.whitelistedOracles;
    const oracleName = Array.from(whitelistedOracles.keys())[0];

    await transaction(testHelper.oracles[oracleName], async () => {
      await testHelper.engine.contract.submitPrice(
        TestAmounts.PRICE_25_CENT,
        testHelper.whitelist
      );
    });

    const availableOracleFundsAfter =
      await testHelper.engine.contract.getAvailableOracleFunds();

    assert.strictEqual(
      availableOracleFundsAfter.toString(),
      UInt64.zero.toString()
    );

    await transaction(
      testHelper.deployer,
      async () => {
        await testHelper.engine.contract.updateOracleFee(
          TestAmounts.COLLATERAL_1_MINA
        );
      },
      {
        extraSigners: [testHelper.networkKeys.protocolAdmin.privateKey],
      }
    );

    //Submit a new price - this should fail
    await assert.rejects(async () => {
      await transaction(testHelper.oracles[oracleName], async () => {
        await testHelper.engine.contract.submitPrice(
          TestAmounts.PRICE_50_CENT,
          testHelper.whitelist
        );
      });
    }, /Overflow/i);
  });

  it('should not allow us to edit the state of the price tracker accounts manually', async () => {
    const trackerAddress = getWriteTrackerAddress();

    await assert.rejects(async () => {
      await transaction(testHelper.deployer, async () => {
        const accountUpdate = AccountUpdate.create(
          trackerAddress,
          testHelper.engine.contract.deriveTokenId()
        );

        const submission = PriceSubmission.new(
          UInt64.from(1e9),
          UInt32.from(1)
        ).pack();

        accountUpdate.body.update.appState[0] = {
          isSome: Bool(true),
          value: PriceSubmissionPacked.toFields(submission)[0],
        };
      });
    }, /Top-level account update can not use or pass on token permissions/i);
  });
});
