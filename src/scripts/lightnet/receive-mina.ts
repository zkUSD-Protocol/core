import { AccountUpdate, fetchAccount, PublicKey } from 'o1js';
import { transaction } from '../../utils/transaction.js';
import { MinaChain } from '../../mina.js';

export async function receiveMina() {
  const receiver = PublicKey.fromBase58(
    'B62qmbTQ56amhVUBTH3umviEEnnQhTbKf5EkpyXb62Rzho3T3A1dPYx'
  );
  const amount = 100e9;

  const chain = await MinaChain.initLightnet();

  const funder = await MinaChain.newAccount();

  let accountFunded: Boolean = false;

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
