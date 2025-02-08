import { TestHelper, TestAmounts } from '../../test-helper.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { AccountUpdate, AccountUpdateForest, Bool, Int64, UInt8 } from 'o1js';
import { FungibleTokenErrors } from '@minatokens/token';
import { MinaPriceInput } from '../../../proofs/oracle-price-aggregation/verify.js';

describe('zkUSD Token Test Suite', () => {
  let th: TestHelper<'local'>;
  let priceOneUsd: MinaPriceInput;

  before(async () => {
    th = await TestHelper.initLocalChain({ proofsEnabled: false });
    await th.deployTokenContracts();
    await th.createLocalAgents('alice', 'bob');
    await th.createVaults('alice', 'bob');

    priceOneUsd = await th.getMinaPriceInput(TestAmounts.PRICE_1_USD);

    // First deposit collateral to allow minting
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.depositCollateral(
          th.agents.alice.vault!.publicKey,
          TestAmounts.COLLATERAL_900_MINA
        );
      },
      { name: 'Token Test Suite: Setup - Alice deposits collateral' }
    );

    // First deposit collateral to allow minting
    await th.includeTx(
      th.agents.bob.keys,
      async () => {
        await th.engine.contract.depositCollateral(
          th.agents.bob.vault!.publicKey,
          TestAmounts.COLLATERAL_900_MINA
        );
      },
      { name: 'Token Test Suite: Setup - Bob deposits collateral' }
    );
  });

  describe('Token Initialization', () => {
    it('should not allow re-initialization of token', async () => {
      await assert.rejects(async () => {
        await th.includeTx(
          th.deployer,
          async () => {
            await th.token.contract.initialize(
              th.networkKeys.engine.publicKey,
              UInt8.from(9),
              Bool(false)
            );
          },
          { name: 'Token Test Suite: Should reject re-initialization of token' }
        );
      });
    });
  });

  describe('Minting Controls', () => {
    it('should not allow direct minting via token contract', async () => {
      await assert.rejects(async () => {
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            AccountUpdate.create(th.agents.alice.vault!.publicKey);
            await th.token.contract.mint(
              th.agents.alice.keys.publicKey,
              TestAmounts.DEBT_1_ZKUSD
            );
          },
          {
            name: 'Token Test Suite: Should reject direct minting via token contract',
          }
        );
      });
    });

    it('should not allow minting with token private key', async () => {
      await assert.rejects(async () => {
        await th.includeTx(
          th.deployer,
          async () => {
            AccountUpdate.create(th.agents.alice.vault!.publicKey);
            await th.token.contract.mint(
              th.agents.alice.keys.publicKey,
              TestAmounts.DEBT_1_ZKUSD
            );
          },
          {
            extraSigners: [th.networkKeys.token.privateKey],
            name: 'Token Test Suite: Should reject minting with token private key',
          }
        );
      });
    });

    it('should allow minting via vault with correct interaction flag', async () => {
      await th.engine.contract.interactionFlag.fetch();

      // Then try to mint through the vault
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.mintZkUsd(
            th.agents.alice.vault!.publicKey,
            TestAmounts.DEBT_5_ZKUSD,
            priceOneUsd
          );
        },
        {
          name: 'Token Test Suite: Alice minting via vault with correct interaction flag',
        }
      );

      const balance = await th.token.contract.getBalanceOf(
        th.agents.alice.keys.publicKey
      );
      assert.deepStrictEqual(balance, TestAmounts.DEBT_5_ZKUSD);
    });

    it('should reset interaction flag after minting', async () => {
      const flag = await th.engine.contract.interactionFlag.fetch();
      assert.deepStrictEqual(flag, Bool(false));
    });
  });

  describe('Burning Controls', () => {
    it('should allow direct burning via token contract', async () => {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.token.contract.burn(
            th.agents.alice.keys.publicKey,
            TestAmounts.DEBT_1_ZKUSD
          );
        },
        { name: 'Token Test Suite: Alice burning via token contract' }
      );
    });
  });

  describe('Transfer Controls', () => {
    it('should allow transfer between accounts', async () => {
      // First mint some tokens to alice
      await th.includeTx(th.agents.alice.keys, async () => {
        await th.engine.contract.mintZkUsd(
          th.agents.alice.vault!.publicKey,
          TestAmounts.DEBT_5_ZKUSD,
          priceOneUsd
        );
      });

      const initialBalanceSender = await th.token.contract.getBalanceOf(
        th.agents.alice.keys.publicKey
      );
      const initialBalanceReceiver = await th.token.contract.getBalanceOf(
        th.agents.bob.keys.publicKey
      );

      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.token.contract.transfer(
            th.agents.alice.keys.publicKey,
            th.agents.bob.keys.publicKey,
            TestAmounts.DEBT_1_ZKUSD
          );
        },
        { name: 'Token Test Suite: Alice transferring tokens to Bob' }
      );

      const finalBalanceSender = await th.token.contract.getBalanceOf(
        th.agents.alice.keys.publicKey
      );
      const finalBalanceReceiver = await th.token.contract.getBalanceOf(
        th.agents.bob.keys.publicKey
      );

      assert.deepStrictEqual(
        finalBalanceSender,
        initialBalanceSender.sub(TestAmounts.DEBT_1_ZKUSD)
      );
      assert.deepStrictEqual(
        finalBalanceReceiver,
        initialBalanceReceiver.add(TestAmounts.DEBT_1_ZKUSD)
      );
    });

    it('should reject transfer without sender signature', async () => {
      await assert.rejects(async () => {
        await th.includeTx(
          th.agents.bob.keys,
          async () => {
            await th.token.contract.transfer(
              th.agents.alice.keys.publicKey,
              th.agents.bob.keys.publicKey,
              TestAmounts.DEBT_1_ZKUSD
            );
          },
          { name: 'Token Test Suite: Bob transferring tokens to Alice' }
        );
      });
    });

    it('should reject transfer to/from circulation account', async () => {
      await assert.rejects(
        async () => {
          await th.includeTx(
            th.agents.alice.keys,
            async () => {
              await th.token.contract.transfer(
                th.agents.alice.keys.publicKey,
                th.networkKeys.token.publicKey,
                TestAmounts.DEBT_1_ZKUSD
              );
            },
            {
              name: 'Token Test Suite: Alice transferring tokens to circulation account',
            }
          );
        },
        (err: any) => {
          return err.message.includes(
            FungibleTokenErrors.noTransferFromCirculation
          );
        }
      );

      await assert.rejects(
        async () => {
          await th.includeTx(
            th.agents.alice.keys,
            async () => {
              await th.token.contract.transfer(
                th.networkKeys.token.publicKey,
                th.agents.alice.keys.publicKey,
                TestAmounts.DEBT_1_ZKUSD
              );
            },
            {
              name: 'Token Test Suite: Transferring tokens from circulation account',
            }
          );
        },
        (err: any) => {
          return err.message.includes(
            FungibleTokenErrors.noTransferFromCirculation
          );
        }
      );
    });
  });

  describe('Account Updates', () => {
    it('should reject unbalanced token updates', async () => {
      const updateSend = AccountUpdate.createSigned(
        th.agents.alice.keys.publicKey,
        th.token.contract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(
        TestAmounts.DEBT_1_ZKUSD
      ).neg();

      const updateReceive = AccountUpdate.create(
        th.agents.bob.keys.publicKey,
        th.token.contract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(
        TestAmounts.DEBT_5_ZKUSD
      );

      await assert.rejects(async () => {
        await th.includeTx(
          th.deployer,
          async () => {
            await th.token.contract.approveBase(
              AccountUpdateForest.fromFlatArray([updateSend, updateReceive])
            );
          },
          { name: 'Token Test Suite: Approving unbalanced token updates' }
        );
      }, /Flash-minting or unbalanced transaction detected/i);
    });

    it('should reject flash-minting attempts', async () => {
      const updateReceive = AccountUpdate.create(
        th.agents.bob.keys.publicKey,
        th.token.contract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(
        TestAmounts.DEBT_1_ZKUSD
      );

      const updateSend = AccountUpdate.createSigned(
        th.agents.alice.keys.publicKey,
        th.token.contract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(
        TestAmounts.DEBT_1_ZKUSD
      ).neg();

      await assert.rejects(
        async () => {
          await th.includeTx(
            th.deployer,
            async () => {
              await th.token.contract.approveBase(
                AccountUpdateForest.fromFlatArray([updateReceive, updateSend])
              );
            },
            { name: 'Token Test Suite: Approving flash-minting updates' }
          );
        },
        (err: any) => {
          return err.message.includes(FungibleTokenErrors.flashMinting);
        }
      );
    });
  });

  describe('Token State Queries', () => {
    it('should return correct decimals', async () => {
      const decimals = await th.token.contract.getDecimals();
      assert.deepStrictEqual(decimals, UInt8.from(9));
    });

    it('should track circulating supply correctly', async () => {
      // First mint some tokens to alice
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.mintZkUsd(
            th.agents.alice.vault!.publicKey,
            TestAmounts.DEBT_50_ZKUSD,
            priceOneUsd
          );
        },
        { name: 'Token Test Suite: Alice minting 50 zkUSD' }
      );

      // Then mint some tokens to bob
      await th.includeTx(
        th.agents.bob.keys,
        async () => {
          await th.engine.contract.mintZkUsd(
            th.agents.bob.vault!.publicKey,
            TestAmounts.DEBT_30_ZKUSD,
            priceOneUsd
          );
        },
        { name: 'Token Test Suite: Bob minting 30 zkUSD' }
      );

      const aliceBalance = await th.token.contract.getBalanceOf(
        th.agents.alice.keys.publicKey
      );
      const bobBalance = await th.token.contract.getBalanceOf(
        th.agents.bob.keys.publicKey
      );

      const circulatingSupply = await th.token.contract.getCirculating();

      assert.deepStrictEqual(circulatingSupply, aliceBalance.add(bobBalance));
    });
  });
});
