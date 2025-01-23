import { IMinaNetworkInterface } from '../mina/mina-network-interface.js';
import {
  ZkUsdEngineContract,
  ZkUsdEngineDeployProps,
} from '../contracts/zkusd-engine.js';
import { ZkUsdVault } from '../contracts/zkusd-vault.js';
import { FungibleTokenContract } from '@minatokens/token';
import { getNetworkKeys } from '../config/keys.js';
import {
  AccountUpdate,
  Bool,
  fetchAccount,
  UInt32,
  UInt8,
  VerificationKey,
} from 'o1js';
import { ContractInstance, KeyPair } from '../types.js';
import { transaction } from '../utils/transaction.js';
import { AggregateOraclePrices } from '../proofs/oracle-price-aggregation/prove.js';
import { updateVerificationKeys } from '../utils/update-verification-keys.js';
import { validPriceBlockCount } from '../index.js';
import { fetchMinaAccount } from 'zkcloudworker';
import { TransactionManager } from '../mina/transaction-manager.js';

interface DeployedContracts {
  token: ContractInstance<ReturnType<typeof FungibleTokenContract>>;
  engine: ContractInstance<ReturnType<typeof ZkUsdEngineContract>>;
  oracleAggregationVk: VerificationKey;
}

export async function deploy(
  txMgr: TransactionManager,
  deployer: KeyPair
): Promise<DeployedContracts> {
  let engineVk: VerificationKey;
  const chainId = txMgr.mina.network.chainId;
  console.log('Deploying contracts on', chainId);

  const fee = chainId !== 'local' ? 1e8 : 0;

  const networkKeys = getNetworkKeys(chainId);

  const oracleAggregationVk = new VerificationKey(
    (await AggregateOraclePrices.compile()).verificationKey
  );

  const vaultVerification = await ZkUsdVault.compile();

  const vaultVk = vaultVerification.verificationKey;

  // Update verification keys
  updateVerificationKeys({
    vaultVk,
    oracleAggregationVk,
  });

  const vaultVerificationKeyHash = vaultVerification.verificationKey.hash;

  const ZkUsdEngine = ZkUsdEngineContract({
    zkUsdTokenAddress: networkKeys.token.publicKey,
    minaPriceInputZkProgramVkHash: oracleAggregationVk.hash,
    vaultVerificationKey: vaultVk,
  });

  const FungibleToken = FungibleTokenContract(ZkUsdEngine);

  const token = {
    contract: new ZkUsdEngine.FungibleToken(networkKeys.token.publicKey),
  };

  const engine = {
    contract: new ZkUsdEngine(networkKeys.engine.publicKey),
  };

  //We always need to compile these contracts
  if (txMgr.mina.proofsEnabled) {
    await ZkUsdEngine.FungibleToken.compile();
    engineVk = (await ZkUsdEngine.compile()).verificationKey;
  }

  //Check whether we have the protocol admin account created

  console.log('Creating Protocol Admin account');

  try {
    const adminAccount = (
      await fetchMinaAccount({
        publicKey: networkKeys.protocolAdmin.publicKey,
      })
    ).account;
    if (!adminAccount) throw new Error('Protocol Admin account not found');
    console.log('Protocol Admin account already created');
  } catch (e) {
    console.log(e);
    const txHandle = await txMgr.tx(
      deployer,
      async () => {
        AccountUpdate.fundNewAccount(deployer.publicKey, 1);
        AccountUpdate.createSigned(networkKeys.protocolAdmin.publicKey);
      },
      {
        extraSigners: [networkKeys.protocolAdmin.privateKey],
      }
    );
    await txHandle.awaitIncluded();
  }

  //Think about what we are doing here
  const engineDeployProps: ZkUsdEngineDeployProps = {
    admin: networkKeys.protocolAdmin.publicKey,
    validPriceBlockCount: UInt32.from(
      validPriceBlockCount[txMgr.mina.network.chainId]
    ),
    emergencyStop: Bool(false),
    vaultVerificationKeyHash: vaultVerificationKeyHash!,
  };

  console.log('Checking Token contract');

  try {
    const tokenAccount = (
      await fetchMinaAccount({
        publicKey: networkKeys.token.publicKey,
      })
    ).account;
    if (!tokenAccount) throw new Error('Token contract not found');
    console.log('Token contract already deployed');
  } catch {
    console.log('Not found - deploying Token contract');
    if (txMgr.mina.proofsEnabled) {
      console.log('Deploying engine with vk hash', engineVk!.hash.toString());
    }
    const txHandle = await txMgr.tx(
      deployer,
      async () => {
        AccountUpdate.fundNewAccount(deployer.publicKey, 3);
        await token.contract.deploy({
          symbol: 'zkUSD',
          src: 'TBD',
        });
        await token.contract.initialize(
          networkKeys.engine.publicKey,
          UInt8.from(9),
          Bool(false)
        );
        await engine.contract.deploy(engineDeployProps);
      },
      {
        extraSigners: [
          networkKeys.token.privateKey,
          networkKeys.engine.privateKey,
          networkKeys.protocolAdmin.privateKey,
        ],
      }
    );
    await txHandle.awaitIncluded();
  }

  txMgr.mina.local?.setBlockchainLength(UInt32.from(1000));

  console.log('Initializing Engine contract');

  try {
    const engineTokenAccount = (
      await fetchMinaAccount({
        publicKey: networkKeys.engine.publicKey,
        tokenId: engine.contract.deriveTokenId(),
      })
    ).account;
    if (!engineTokenAccount) throw new Error('Engine contract not found');
    console.log('Engine contract already deployed');
  } catch {
    //should get the latest nonce
    await fetchMinaAccount({ publicKey: networkKeys.engine.publicKey });

    const txHandle = await txMgr.tx(
      deployer,
      async () => {
        AccountUpdate.fundNewAccount(deployer.publicKey, 1);
        await engine.contract.initialize();
      },
      {
        extraSigners: [
          networkKeys.protocolAdmin.privateKey,
          networkKeys.engine.privateKey,
        ],
      }
    );
    await txHandle.awaitIncluded();
  }

  return {
    token,
    engine,
    oracleAggregationVk,
  };
}
