# zkUSD Protocol Core

**zkUSD Protocol Core** is the foundational codebase behind the **Fizk Protocol**, which introduces **zkUSD** — a trust-minimized, algorithmic stablecoin built natively for the Mina blockchain.

Our mission is to become the catalyst that transforms Mina into a vibrant and self-sustaining financial hub, all while preserving its core principles of low-cost network security and decentralisation.

---

## Table of Contents

- [About zkUSD](#about-zkusd)
- [Current Status](#current-status)
- [Repository Structure](#repository-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running the Application](#running-the-application)
- [How to Contribute](#how-to-contribute)
- [Community & Resources](#community--resources)
- [License](#license)

---

## About zkUSD

zkUSD is a **fully collateralized, algorithmic stablecoin** backed by MINA and governed by smart contracts written in `o1js` using zkApps on Mina.

It’s designed from the ground up for Mina’s unique architecture, leveraging:

- **Collateralized debt vaults** (CDPs) for zkUSD issuance
- **Decentralized oracles** with off-chain zk-proof price feeds
- Built-in **liquidation mechanics**, reserve management, and incentives
- Future support for **negative interest rate loans**
- Native governance and DAO upgradability
- A roadmap that includes multi-collateral support and real-world asset integrations

For deeper protocol details, see the [whitepaper (v0.1)](https://drive.google.com/file/d/1MINcUqeLzxskjdB8Cq2O38emFrjgVY0q/view).

---

## Current Status

The zkUSD protocol is already live and running as a **working proof-of-concept on Mina’s devnet**. Core functionality — including vault creation, collateral handling, debt minting — is implemented and operational. Liquidations are currently not possible using the UI.

What’s coming next or is actively in progress:

- The legal side of the project.
- Development of **governance modules** (on-chain upgrades, DAO integration)
- A **decentralized CLI** and developer tooling
- Preparing for **mainnet launch**
- **Security audits** of the core protocol
- Continuous improvements and optimization

While the protocol is early-stage, the foundation is solid — and it’s a great time to provide us with your valuable feedback & contribute or build on top.

---

## Project structure

The project is written in Typescript + o1js Mina stack. It is meant to work both on Node.js and Web.
The main API class is ZKUSDClient located in `./src/client/client.ts`. The contracts can be found in: `./src/contracts`. The project is still active heavy development and the overall structure and interfaces may be unstable. Should you encounter any issues, please let us know. In the future a CLI and IPFS powered API will be provided to increase the convenience of devs and power users.

---

## How to Contribute

We're building in the open and welcome contributors of all kinds:

- Testers & auditors
- Doc writers
- zkApp integrators
- Economic & governance model reviewers

To contribute:

1. Fork this repo
2. Create a branch: `git checkout -b your-username/feature/your-feature`
3. Make your changes, commit, and push
4. Open a pull request

Guidelines and coding conventions will be added as the project matures.

---

## Community & Resources

- 🌐 **Website**: [https://devnet.fizk.xyz](https://devnet.fizk.xyz)
- 📄 **Whitepaper v0.1**: [Read Here](https://drive.google.com/file/d/1MINcUqeLzxskjdB8Cq2O38emFrjgVY0q/view)
- 📚 **Docs**: [https://docs.fizk.xyz](https://docs.fizk.xyz)
- 💬 **Discord**: [Join the discussion](https://discord.gg/3fxFtxQK)
- 🐦 **Twitter/X**: [Follow updates](https://x.com/fizk_protocol)
- 📢 **Telegram**: [Join the chat](https://t.me/fizk_protocol)
- 💻 **GitHub**: [https://github.com/zkUSD-Protocol](https://github.com/zkUSD-Protocol)

---

## License

This project is licensed under the [Apache 2.0 License](./LICENSE)
