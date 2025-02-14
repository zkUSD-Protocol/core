export type { SignerZkappCommand, SignerZkappCommandInput, MinaZkappCommand };

import { ZkappCommand as SignerZkappCommand } from 'o1js/dist/node/mina-signer/src/types';
type SignerZkappCommandInput = SignerZkappCommand['zkappCommand'];

import { ZkappCommand as MinaZkappCommand } from 'o1js/dist/node/lib/mina/account-update';
