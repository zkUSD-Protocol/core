import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import dotenv from 'dotenv';

dotenv.config();

export const suiSigner: Ed25519Keypair = Ed25519Keypair.fromSecretKey(
  process.env.DEVNET_SUI_SIGNER_PRIVATE_KEY!
);
