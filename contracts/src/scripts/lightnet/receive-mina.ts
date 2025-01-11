import { AccountUpdate, fetchAccount, PublicKey } from 'o1js';
import { transaction } from '../../utils/transaction.js';
import { MinaChain } from '../../mina.js';

async function main() {
  const receiver = PublicKey.fromBase58(
    'B62qmbTQ56amhVUBTH3umviEEnnQhTbKf5EkpyXb62Rzho3T3A1dPYx'
  );
  const amount = 100e9;

  const chain = await MinaChain.initLightnet();

  const funder = await MinaChain.newAccount();

  let accountFunded: Boolean = false;

  // try {
  //   const account = (await fetchAccount({ publicKey: funder.publicKey }))
  //     .account;
  //   console.log('Account:', account);
  //   if (account) {
  //     accountFunded = true;
  //     console.log('Account already funded');
  //   } else {
  //     throw new Error('Account not found');
  //   }
  // } catch (e) {
  //   accountFunded = false;
  //   console.log('Account not found');
  // }

  await transaction(
    funder,
    async () => {
      AccountUpdate.fundNewAccount(funder.publicKey, 1);
      const au = AccountUpdate.createSigned(funder.publicKey);
      au.send({
        to: receiver,
        amount: amount,
      });
    },
    {
      fee: 1e8,
      printTx: true,
    }
  );

  console.log('Mina sent to receiver');
}

main();
