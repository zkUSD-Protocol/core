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
import { AggregateOraclePrices } from '../proofs/oracle-price-aggregation/prove.js';
import { updateVerificationKeys } from '../utils/update-verification-keys.js';
import { validPriceBlockCount } from '../index.js';
import { fetchMinaAccount } from 'zkcloudworker';
import { TransactionManager } from '@/mina/transaction-manager.js';

interface DeployedContracts {
  token: ContractInstance<ReturnType<typeof FungibleTokenContract>>;
  engine: ContractInstance<ReturnType<typeof ZkUsdEngineContract>>;
  oracleAggregationVk: VerificationKey;
}

export async function deploy(
  txManager: TransactionManager,
  deployer: KeyPair
): Promise<DeployedContracts> {
  let engineVk: VerificationKey;
  const chainId = txManager.mina.network.chainId;
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
  if (txManager.mina.proofsEnabled) {
    await ZkUsdEngine.FungibleToken.compile();
    engineVk = (await ZkUsdEngine.compile()).verificationKey;
  }

  //Check whether we have the protocol admin account created

  console.log('Creating Protocol Admin account');

  let protocolAdminAccountCreationTx;
  try {
    const adminAccount = (
      await fetchAccount({ publicKey: networkKeys.protocolAdmin.publicKey })
    ).account;
    if (!adminAccount) throw new Error('Protocol Admin account not found');
    console.log('Protocol Admin account already created');
  } catch {
    protocolAdminAccountCreationTx =  await txManager.tx(
      deployer,
      async () => {
        AccountUpdate.fundNewAccount(deployer.publicKey, 1);
        AccountUpdate.createSigned(networkKeys.protocolAdmin.publicKey);
      },
      {
        name: 'Create Protocol Admin account',
        extraSigners: [networkKeys.protocolAdmin.privateKey],
      }
    );
  }

  //Think about what we are doing here
  const engineDeployProps: ZkUsdEngineDeployProps = {
    admin: networkKeys.protocolAdmin.publicKey,
    validPriceBlockCount: UInt32.from(
      validPriceBlockCount[chainId]
    ),
    emergencyStop: Bool(false),
    vaultVerificationKeyHash: vaultVerificationKeyHash!,
  };

  console.log('Checking Token contract');

  let deployTokenContractTx;
  try {
    const tokenAccount = (
      await fetchMinaAccount({ publicKey: networkKeys.token.publicKey })
    ).account;
    if (!tokenAccount) throw new Error('Token contract not found');
    console.log('Token contract already deployed');
  } catch {
    console.log('Not found - deploying Token contract');
    if (txManager.mina.proofsEnabled) {
      console.log('Deploying engine with vk hash', engineVk!.hash.toString());
    }
    deployTokenContractTx = await txManager.tx(
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
        name: 'Deploy Token contract',
        extraSigners: [
          networkKeys.token.privateKey,
          networkKeys.engine.privateKey,
          networkKeys.protocolAdmin.privateKey,
        ],
      }
    );
  }

  txManager.mina.local?.setBlockchainLength(UInt32.from(1000));

  Promise.all([
    protocolAdminAccountCreationTx?.awaitIncluded(),
    deployTokenContractTx?.awaitIncluded(),
  ]);


  console.log('Initializing Engine contract');

  let deployEngineContractTx;
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

    deployEngineContractTx = await txManager.tx(
      deployer,
      async () => {
        AccountUpdate.fundNewAccount(deployer.publicKey, 1);
        await engine.contract.initialize();
      },
      {
        name: 'Initialize Engine contract',
        extraSigners: [
          networkKeys.protocolAdmin.privateKey,
          networkKeys.engine.privateKey,
        ],
      }
    );
  }

  deployEngineContractTx?.awaitIncluded();

  return {
    token,
    engine,
    oracleAggregationVk,
  };
}
