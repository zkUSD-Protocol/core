import { AccountUpdate, fetchAccount, PublicKey } from 'o1js';
import { transaction } from '../../utils/transaction.js';
import { MinaNetworkInterface } from '@/mina/mina-network-interface.js';

export async function receiveMina() {
  const receiver = PublicKey.fromBase58(
    'B62qmbTQ56amhVUBTH3umviEEnnQhTbKf5EkpyXb62Rzho3T3A1dPYx'
  );
  const amount = 100e9;

  const mina = await MinaNetworkInterface.initLightnet();

  const funder = await mina.newAccount();

  const receiverAccount = (await fetchAccount({ publicKey: receiver })).account;

  await transaction(
    funder,
    async () => {
      if (!receiverAccount) {
        AccountUpdate.fundNewAccount(funder.publicKey, 1);
      }

      const au = AccountUpdate.createSigned(funder.publicKey);
      au.send({
        to: receiver,
        amount: amount,
      });
    },
    {
      fee: 1e8,
    }
  );

  console.log('Mina sent to receiver');
}

receiveMina();
