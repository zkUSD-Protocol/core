import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { suiSigner } from '../../config/keys.js';
import fs from 'fs/promises';
import { Transaction } from '@mysten/sui/transactions';
import { execSync } from 'child_process';
import assert from 'assert';

const modulePath =
  '/Users/mack/Projects/Blockchain/mina/zkusd-protocol/core/src/top-secret/zkusd/sequencer';

const compiledModulePath =
  '/Users/mack/Projects/Blockchain/mina/zkusd-protocol/core/src/top-secret/zkusd/sequencer/build/zkusd/bytecode_modules/sequence.mv';

type Network = 'mainnet' | 'testnet' | 'devnet' | 'localnet';

export class DeploymentService {
  private _deployer: Ed25519Keypair;
  private _network: Network;
  private _suiClient: SuiClient;

  public packageId: string | null;
  public intentQueueSystemId: string | null;
  public validatorRegistryId: string | null;

  constructor(network: Network) {
    this._deployer = suiSigner;
    this._network = network;
    this._suiClient = new SuiClient({ url: getFullnodeUrl(network) });
    this.packageId = null;
    this.intentQueueSystemId = null;
    this.validatorRegistryId = null;
  }

  public static async create(network: Network) {
    return new DeploymentService(network);
  }

  async deploy() {
    const { modules, dependencies } = await this.compileContracts();

    const tx = new Transaction();

    const [upgradeCap] = tx.publish({
      modules,
      dependencies,
    });

    tx.transferObjects(
      [upgradeCap],
      tx.pure(this._deployer.getPublicKey().toRawBytes())
    );

    // Execute the publish transaction
    const publishResult = await this._suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: this._deployer,
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
    });

    console.log(publishResult);

    for (const obj of publishResult.objectChanges || []) {
      if (obj.type === 'published') {
        this.packageId = obj.packageId;
      }

      if (
        obj.type === 'created' &&
        obj.objectType.includes('::sequence::IntentSequencer')
      ) {
        this.intentQueueSystemId = obj.objectId;
      }
      if (
        obj.type === 'created' &&
        obj.objectType.includes('::sequence::ValidatorRegistry')
      ) {
        this.validatorRegistryId = obj.objectId;
      }
    }
  }

  private async compileContracts() {
    execSync(`sui move build --path ${modulePath}`, {
      encoding: 'utf-8',
    });

    const modules = [await fs.readFile(compiledModulePath, 'base64')];

    const dependencies = [
      '0x1', // Move Standard Library
      '0x2', // Sui Framework
      '0x3', // Sui System
      '0xb', // Sui Bridge
    ];

    return { modules, dependencies };
  }

  private async checkIfPackageExists() {
    const objects = await this._suiClient.getOwnedObjects({
      owner: this._deployer.getPublicKey().toSuiAddress(),
    });

    const packages = objects.data.filter(
      (obj) => obj?.data?.type === 'package'
    );

    console.log(packages);
  }
}
