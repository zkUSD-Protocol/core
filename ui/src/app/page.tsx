"use client";
import Head from "next/head.js";
import Image from "next/image.js";

import heroMinaLogo from "../../public/assets/hero-mina-logo.svg";
import arrowRightSmall from "../../public/assets/arrow-right-small.svg";
import { useEffect } from "react";
import { FileSystemCache } from "@lib/utils/cache";

export default function Home() {
  useEffect(() => {
    (async () => {
      const { Mina, PublicKey, Cache } = await import("o1js");
      const {
        ZkUsdEngineContract,
        FungibleTokenContract,
        ZkUsdMasterOracle,
        ZkUsdPriceTracker,
        ZkUsdVault,
      } = await import("zkusd");

      const ZkUsdEngine = ZkUsdEngineContract(
        PublicKey.fromBase58(process.env.NEXT_PUBLIC_TOKEN_ADDRESS!),
        PublicKey.fromBase58(process.env.NEXT_PUBLIC_MASTER_ORACLE_ADDRESS!),
        PublicKey.fromBase58(
          process.env.NEXT_PUBLIC_EVEN_ORACLE_PRICE_TRACKER_ADDRESS!
        ),
        PublicKey.fromBase58(
          process.env.NEXT_PUBLIC_ODD_ORACLE_PRICE_TRACKER_ADDRESS!
        )
      );

      const cache = new FileSystemCache();

      console.log("Cache:", cache);

      console.log("Can write:", cache.canWrite);

      console.time("Compiling contracts");

      console.log("Compiling ZkUsdVault");
      const compiled = await ZkUsdVault.compile({ cache });

      console.log("Compiled:", compiled);

      console.log("Compiling ZkUsdMasterOracle");
      await ZkUsdMasterOracle.compile();

      console.log("Compiling ZkUsdPriceTracker");
      await ZkUsdPriceTracker.compile();

      //@ts-ignore
      const FungibleToken = FungibleTokenContract(ZkUsdEngine);
      console.log("Compiling FungibleToken");
      await FungibleToken.compile();

      console.log("Compiling ZkUsdEngine");
      console.log(ZkUsdEngine);

      await ZkUsdEngine.compile();

      console.timeEnd("Compiling contracts");

      console.log(process.env.NEXT_PUBLIC_TOKEN_ADDRESS);

      //   const { Add } = await import("../../../contracts/build/src/");

      // Update this to use the address (public key) for your zkApp account.
      // To try it out, you can try this address for an example "Add" smart contract that we've deployed to
      // Testnet B62qkwohsqTBPsvhYE8cPZSpzJMgoKn4i1LQRuBAtVXWpaT4dgH6WoA.
      const zkAppAddress = process.env.NEXT_PUBLIC_ENGINE_ADDRESS!;
      // This should be removed once the zkAppAddress is updated.
      if (!zkAppAddress) {
        console.error(
          'The following error is caused because the zkAppAddress has an empty string as the public key. Update the zkAppAddress with the public key for your zkApp account, or try this address for an example "Add" smart contract that we deployed to Testnet: B62qkwohsqTBPsvhYE8cPZSpzJMgoKn4i1LQRuBAtVXWpaT4dgH6WoA'
        );
      }
      //const zkApp = new Add(PublicKey.fromBase58(zkAppAddress))

      let accounts;

      try {
        accounts = await window.mina?.requestAccounts();

        if (!accounts) throw new Error("No accounts found");

        const display = `${accounts[0].slice(0, 6)}...${accounts[0].slice(-4)}`;

        console.log(display);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  return (
    <>
      <Head>
        <title>Mina zkApp UI</title>
        <meta name="description" content="built with o1js" />
        <link rel="icon" href="/assets/favicon.ico" />
      </Head>

      <main>hello</main>
    </>
  );
}
