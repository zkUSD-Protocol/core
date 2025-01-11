"use client";
import Head from "next/head.js";
import Image from "next/image.js";

import heroMinaLogo from "../../public/assets/hero-mina-logo.svg";
import arrowRightSmall from "../../public/assets/arrow-right-small.svg";
import { cache, useEffect } from "react";
import { useCloudWorker } from "@/lib/context/cloud-worker";
import { useVault } from "@/lib/context/vault";
import { PrivateKey, PublicKey } from "o1js";
import { useAccount } from "@/lib/context/account";

export default function Home() {
  const { executeTransaction } = useCloudWorker();
  const { createVault } = useVault();
  const { account, displayAccount, isConnected } = useAccount();

  const handleCreateVault = async () => {
    const vaultPrivateKey = PrivateKey.random();
    const vaultAddress = vaultPrivateKey.toPublicKey();

    console.log("Creating vault with address", vaultAddress);

    const tx = await createVault(vaultPrivateKey);
    console.log(tx);
  };

  useEffect(() => {
    handleCreateVault();
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
