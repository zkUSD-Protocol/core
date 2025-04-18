import { PublicKey, PrivateKey } from 'o1js';
import { blockchain } from '../mina/networks.js';
import { OracleWhitelist } from '../system/oracle.js';

// Define the interface for an oracle
export interface Oracle {
  publicKey: PublicKey;
  endpoint?: string;
}

// Define the interface for oracle configuration
export interface OracleConfig {
  oracles: Oracle[];
  oracleWhitelist: OracleWhitelist;
  realOraclesCount: number;
  dummyOracleKey: PrivateKey;
}

// Dummy oracle key and public key used for filling empty slots
const DUMMY_ORACLE_KEY = PrivateKey.fromBase58(
  'EKF9wzfMKegnYdxpAJ49ger3mN2ZkBA5KZuDRjribNtuczKjz5sk'
);

const DUMMY_ORACLE_PUBLIC_KEY = PublicKey.fromBase58(
  'B62qmAgjsmkoSjoAhdDuGJ334326D2H6WsF22dy96E5qYphsfYLC4E5'
);

// Hardcoded oracle configurations
const DEVNET_ORACLES: Oracle[] = [
  {
    publicKey: PublicKey.fromBase58(
      'B62qrYmswnMHuSg8wzeQBYu3fFC2bY2QN8G9d3x4unTkA33oC917nbF'
    ),
    endpoint: 'https://oracle1.fizk.xyz/api/price',
  },
  {
    publicKey: PublicKey.fromBase58(
      'B62qjnCpbdT1yP3SPTczLkM4QwKu2y5GxonpYm2kjkvTQ38Ck2Lhmeo'
    ),
    endpoint: 'https://oracle2.fizk.xyz/api/price',
  },
  {
    publicKey: PublicKey.fromBase58(
      'B62qrrhbuYP5UxWbhdL9FHTGfeAERjx8ofCjQPUVS9cfQ9ijR8PrvAk'
    ),
    endpoint: 'https://oracle3.fizk.xyz/api/price',
  },
  {
    publicKey: PublicKey.fromBase58(
      'B62qq68r9VHAasJeh45oXdXoKx2vbMw6dsz7YD4FFSJ2ZbgEsUNee99'
    ),
    endpoint: 'https://zkusd.oracle.nori.global/api/price',
  },
  // Fill remaining slots with dummy oracles
  ...Array(OracleWhitelist.MAX_PARTICIPANTS - 4).fill({
    publicKey: DUMMY_ORACLE_PUBLIC_KEY,
  }),
];

function isSupportedNetwork(network: blockchain) {
  if (network !== 'devnet') {
    throw new Error(
      `Oracle configuration only supports devnet. Received: ${network}`
    );
  }
}

/**
 * Determines if an oracle is a real oracle or a dummy placeholder
 * @param oracle The oracle to check
 * @returns true if this is a real oracle, false if it's a dummy
 */
function isRealOracle(oracle: Oracle): boolean {
  // Compare the public key to the dummy public key
  return !oracle.publicKey.equals(DUMMY_ORACLE_PUBLIC_KEY).toBoolean();
}

/**
 * Returns oracle configuration for a specific network
 * @param network The blockchain network to get oracles for
 * @returns Oracle configuration including list of oracles, count of real oracles, and dummy oracle key
 */
export function getOracles(network: blockchain): OracleConfig {
  isSupportedNetwork(network);

  // Select the appropriate oracle list based on network
  const oracles = DEVNET_ORACLES;

  // Dynamically count real oracles by filtering out dummy oracles
  const realOraclesCount = oracles.filter(isRealOracle).length;

  return {
    oracles,
    realOraclesCount,
    dummyOracleKey: DUMMY_ORACLE_KEY,
    oracleWhitelist: new OracleWhitelist({
      addresses: oracles.map((oracle) => oracle.publicKey),
    }),
  };
}

/**
 * Returns a list of real oracles (excluding placeholder oracles)
 * @param network The blockchain network (devnet or mainnet)
 * @returns List of active oracles
 */
export function getActiveOracles(network: blockchain): Oracle[] {
  isSupportedNetwork(network);

  const { oracles } = getOracles(network);

  // Filter out dummy oracles
  return oracles.filter(isRealOracle);
}

/**
 * Returns the oracle public keys in the format expected by the OracleWhitelist contract
 * @param network The blockchain network (devnet or mainnet)
 * @returns Array of oracle public keys with exact length required by OracleWhitelist
 */
export function getOraclePublicKeys(network: blockchain): PublicKey[] {
  isSupportedNetwork(network);

  const { oracles } = getOracles(network);
  return oracles.map((oracle) => oracle.publicKey);
}

/**
 * Utility function to get an oracle by its public key
 * @param network The blockchain network (devnet or mainnet)
 * @param publicKey Public key to search for
 * @returns Oracle configuration or null if not found
 */
export function getOracleByPublicKey(
  network: blockchain,
  publicKey: string
): Oracle | null {
  isSupportedNetwork(network);

  const { oracles } = getOracles(network);
  return oracles.find((o) => o.publicKey.toBase58() === publicKey) || null;
}

/**
 * Returns the maximum number of oracles supported by the system
 * @returns Maximum number of oracles
 */
export function getMaxOraclesCount(): number {
  return OracleWhitelist.MAX_PARTICIPANTS;
}
