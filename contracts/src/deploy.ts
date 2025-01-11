import { MinaChainInstance } from './mina.js';
import { ZkUsdMasterOracle } from './contracts/zkusd-master-oracle.js';
import { ZkUsdPriceTracker } from './contracts/zkusd-price-tracker.js';
import {
  ZkUsdEngineContract,
  ZkUsdEngineDeployProps,
} from './contracts/zkusd-engine.js';
import { ZkUsdVault } from './contracts/zkusd-vault.js';
import { FungibleTokenContract } from '@minatokens/token';
import { getNetworkKeys } from './config/keys.js';
import {
  AccountUpdate,
  Bool,
  fetchAccount,
  Mina,
  UInt32,
  UInt64,
  UInt8,
} from 'o1js';
import { ContractInstance, KeyPair } from './types.js';
import { transaction } from './utils/transaction.js';
import { FileSystemCache } from './utils/cache.js';
import { updateVerificationKeys } from './config/update-verification-keys.js';

interface DeployedContracts {
  token: ContractInstance<ReturnType<typeof FungibleTokenContract>>;
  engine: ContractInstance<ReturnType<typeof ZkUsdEngineContract>>;
  masterOracle: ContractInstance<ZkUsdMasterOracle>;
}

export async function deploy(
  currentNetwork: MinaChainInstance,
  deployer: KeyPair
): Promise<DeployedContracts> {
  const chainId = currentNetwork.network().chainId;
  console.log('Deploying contracts on', chainId);

  const fee = chainId !== 'local' ? 1e8 : 0;
  const cache = new FileSystemCache();

  const networkKeys = getNetworkKeys(chainId);

  const vaultVerification = await ZkUsdVault.compile();
  updateVerificationKeys(vaultVerification.verificationKey);
  const vaultVerificationKeyHash = vaultVerification.verificationKey.hash;

  const ZkUsdEngine = ZkUsdEngineContract(
    networkKeys.token.publicKey,
    networkKeys.masterOracle.publicKey,
    networkKeys.evenOraclePriceTracker.publicKey,
    networkKeys.oddOraclePriceTracker.publicKey,
    vaultVerification.verificationKey
  );

  const token = {
    contract: new ZkUsdEngine.FungibleToken(networkKeys.token.publicKey),
  };

  const engine = {
    contract: new ZkUsdEngine(networkKeys.engine.publicKey),
  };

  const masterOracle = {
    contract: new ZkUsdMasterOracle(
      networkKeys.masterOracle.publicKey,
      engine.contract.deriveTokenId()
    ),
  };

  //We always need to compile these contracts
  await ZkUsdMasterOracle.compile();
  await ZkUsdPriceTracker.compile();

  if (currentNetwork.proofsEnabled) {
    await ZkUsdEngine.FungibleToken.compile();
    await ZkUsdEngine.compile();
  }

  //Check whether we have the protocol admin account created

  console.log('Creating Protocol Admin account');

  try {
    const adminAccount = (
      await fetchAccount({ publicKey: networkKeys.protocolAdmin.publicKey })
    ).account;
    if (!adminAccount) throw new Error('Protocol Admin account not found');
    console.log('Protocol Admin account already created');
  } catch {
    await transaction(
      deployer,
      async () => {
        AccountUpdate.fundNewAccount(deployer.publicKey, 1);
        AccountUpdate.createSigned(networkKeys.protocolAdmin.publicKey);
      },
      {
        extraSigners: [networkKeys.protocolAdmin.privateKey],
        fee,
      }
    );
  }

  //Think about what we are doing here
  const engineDeployProps: ZkUsdEngineDeployProps = {
    initialPrice: UInt64.from(1e9),
    admin: networkKeys.protocolAdmin.publicKey,
    oracleFlatFee: UInt64.from(1e9),
    emergencyStop: Bool(false),
    vaultVerificationKeyHash: vaultVerificationKeyHash!,
  };

  console.log('Checking Token contract');

  try {
    const tokenAccount = (
      await fetchAccount({ publicKey: networkKeys.token.publicKey })
    ).account;
    if (!tokenAccount) throw new Error('Token contract not found');
    console.log('Token contract already deployed');
  } catch {
    console.log('Not found - deploying Token contract');
    await transaction(
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
          networkKeys.evenOraclePriceTracker.privateKey,
        ],
        fee,
      }
    );
  }

  currentNetwork.local?.setBlockchainLength(UInt32.from(1000));

  console.log('Initializing Engine contract');

  try {
    const masterOracleAccount = (
      await fetchAccount({
        publicKey: networkKeys.masterOracle.publicKey,
        tokenId: engine.contract.deriveTokenId(),
      })
    ).account;
    console.log('Master Oracle account', masterOracleAccount);
    if (!masterOracleAccount)
      throw new Error('Master Oracle contract not initialised');
    console.log('Engine already initialised');
  } catch {
    await transaction(
      deployer,
      async () => {
        AccountUpdate.fundNewAccount(deployer.publicKey, 4);
        await engine.contract.initialize();
      },
      {
        extraSigners: [
          networkKeys.protocolAdmin.privateKey,
          networkKeys.engine.privateKey,
          networkKeys.masterOracle.privateKey,
          networkKeys.evenOraclePriceTracker.privateKey,
          networkKeys.oddOraclePriceTracker.privateKey,
        ],
        fee,
      }
    );
  }

  return {
    token,
    engine,
    masterOracle,
  };
}
