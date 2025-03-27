import { MinaNetworkInterface } from '../../mina/network-interface.js';
import { TransactionManager } from '../../transaction/manager.js';
import {
  AccountUpdate,
  Bool,
  fetchLastBlock,
  PrivateKey,
  PublicKey,
  Signature,
  UInt64,
} from 'o1js';
import { OracleWhitelist } from '../../system/oracle.js';
import { getContractKeys } from '../../config/keys.js';
import {
  ExternalTransactionExecutor,
  HttpClientProver,
  ITransactionExecutor,
} from '../../index.node.js';
import { KeyPair } from '../../types/utility.js';
import dotenv from 'dotenv';
import Client from 'mina-signer';
import {
  AggregateOraclePrices,
  OraclePriceSubmissions,
  PriceSubmission,
} from '../../proofs/oracle-price-aggregation/prove.js';
import { LocalTransactionExecutor } from '../../transaction/local-executor.js';
import { MinaPriceInput } from '../../proofs/oracle-price-aggregation/verify.js';
import { ZkUsdEngineContract } from '../../contracts/zkusd-engine.js';
import {
  PriceProofArgs,
  TransactionArgs,
  ZkusdEngineTransactionType,
} from '../../system/transaction.js';

const client = new Client({
  network: 'testnet',
});

dotenv.config();

const VAULT_TO_LIQUIDATE =
  'B62qo81uqMWNqbcrRM6s7gXJm6Dmau3ERDaRbr3n5JTxvixEQsCcbwg';

const ORACLES = [
  {
    publicKey: PublicKey.fromBase58(
      'B62qrYmswnMHuSg8wzeQBYu3fFC2bY2QN8G9d3x4unTkA33oC917nbF'
    ),
    endpoint: 'http://localhost:3335/api/price',
  },
  {
    publicKey: PublicKey.fromBase58(
      'B62qjnCpbdT1yP3SPTczLkM4QwKu2y5GxonpYm2kjkvTQ38Ck2Lhmeo'
    ),
    endpoint: 'http://localhost:3336/api/price',
  },
  {
    publicKey: PublicKey.fromBase58(
      'B62qrrhbuYP5UxWbhdL9FHTGfeAERjx8ofCjQPUVS9cfQ9ijR8PrvAk'
    ),
    endpoint: 'http://localhost:3337/api/price',
  },
];
const ORACLE_DUMMY_PRIVATE_KEY = process.env.DEVNET_ORACLE_DUMMY_PRIVATE_KEY!;
const ORACLE_DUMMY_PUBLIC_KEY = process.env.DEVNET_ORACLE_DUMMY_PUBLIC_KEY!;

const LIQUIDATOR: KeyPair = {
  privateKey: PrivateKey.fromBase58(process.env.DEVNET_LIQUIDATOR_PRIVATE_KEY!),
  publicKey: PublicKey.fromBase58(process.env.DEVNET_LIQUIDATOR_PUBLIC_KEY!),
};

const buildPriceInput = async () => {
  const latestBlock = await fetchLastBlock();
  const blockHeight = latestBlock.blockchainLength;

  const submissions = await Promise.all(
    Array.from({
      length: OracleWhitelist.MAX_PARTICIPANTS,
    }).map(async (_, index) => {
      let signature: Signature;
      let price: UInt64;
      let isDummy: Bool;
      let publicKey: PublicKey;

      if (index < ORACLES.length) {
        const response = await fetch(ORACLES[index].endpoint);
        const oracleResponse = await response.json();

        price = UInt64.from(oracleResponse.signed.data.price);
        signature = Signature.fromBase58(oracleResponse.signed.signature);
        publicKey = ORACLES[index].publicKey;
        isDummy = Bool(false);

        const validSig: Bool = signature.verify(publicKey, [
          price.toFields()[0],
          blockHeight.toFields()[0],
        ]);

        if (!validSig) {
          throw new Error(`Oracle ${index} returned invalid signature`);
        }
      } else {
        // Dummy oracle submission
        price = UInt64.MAXINT(); //dummy price
        const dummySigned = client.signFields(
          [price.toBigInt(), blockHeight.toBigint()],
          ORACLE_DUMMY_PRIVATE_KEY
        );
        signature = Signature.fromBase58(dummySigned.signature);
        isDummy = Bool(true);
        publicKey = PublicKey.fromBase58(ORACLE_DUMMY_PUBLIC_KEY);
      }

      return new PriceSubmission({
        publicKey,
        price,
        signature,
        blockHeight,
        isDummy,
      });
    })
  );

  console.log(submissions);

  const oracleAggregationVk = await AggregateOraclePrices.compile();

  const oracleWhitelist = new OracleWhitelist({
    addresses: Array.from({ length: OracleWhitelist.MAX_PARTICIPANTS }).map(
      (_, index) => {
        if (index < ORACLES.length) {
          return ORACLES[index].publicKey;
        } else {
          return PublicKey.fromBase58(ORACLE_DUMMY_PUBLIC_KEY);
        }
      }
    ),
  });

  const oracleWhitelistHash = OracleWhitelist.hash(oracleWhitelist);

  const oraclePriceSubmissions = new OraclePriceSubmissions({
    submissions,
  });

  // Generate the proof
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

  const minaPriceInput = new MinaPriceInput({
    proof: programOutput.proof,
    verificationKey: oracleAggregationVk.verificationKey,
  });

  return minaPriceInput;
};

async function liquidateVault() {
  const MinaChain = await MinaNetworkInterface.initDevnet();
  const executor: ITransactionExecutor = new LocalTransactionExecutor();
  const txMgr = TransactionManager.new(MinaChain, { local: executor });

  const { token: tokenAddress, engine: engineAddress } =
    getContractKeys('devnet');

  const minaPriceInput = await buildPriceInput();

  const ZkUsdEngine = ZkUsdEngineContract({
    zkUsdTokenAddress: tokenAddress,
    minaPriceInputZkProgramVkHash: minaPriceInput.verificationKey.hash,
  });

  const FungibleToken = ZkUsdEngine.FungibleToken;

  await ZkUsdEngine.compile();
  await FungibleToken.compile();

  const engine = new ZkUsdEngine(engineAddress);
  const token = new FungibleToken(tokenAddress);

  console.log(minaPriceInput);

  const txArgs: TransactionArgs = {
    transactionType: ZkusdEngineTransactionType.LIQUIDATE,
    args: {
      transactionId: PrivateKey.random().toBase58(),
      vaultAddress: VAULT_TO_LIQUIDATE,
      minaPriceProof: minaPriceInput.proof.toJSON(),
    },
  } as TransactionArgs;

  const tx = await txMgr.engineTx(LIQUIDATOR, txArgs, engine, minaPriceInput);

  console.log(tx.hash);

  tx.subscribeToLifecycle(async (lifecycle) => {
    console.log(lifecycle);
  });
}

liquidateVault();
