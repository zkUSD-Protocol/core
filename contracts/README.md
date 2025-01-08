# zkUSD Protocol

zkUSD is a private, algorithmic stablecoin protocol built on the Mina Protocol. It enables users to mint zkUSD tokens by depositing MINA as collateral through individual vaults.

## Overview

zkUSD implements a novel architecture where the `ZkUsdEngine` contract manages the protocol administration. All other contracts, including individual user vaults, are installed on the token account of the engine contract. This design allows for:

- **Centralized Protocol Administration**: The `ZkUsdEngine` contract governs all interactions and state management through vault contracts installed on the engine's token account.
- **Decentralized State Management**: Each vault operates independently, eliminating concurrency issues.
- **Atomic Operations**: All state transitions are confined within individual vaults.
- **Interoperability**: zkUSD is available on L1 Mina.
- **Enhanced Security**: Users maintain full control over their vaults.

## Key Components

### ZkUsdEngine Contract

The `ZkUsdEngine` contract is the master contract responsible for:

- Managing protocol administration and interactions.
- Oracle whitelisting and fee management.
- Emergency controls and administrative functions.
- Deploying and managing individual user vaults.

### Individual User Vaults

Key features:

- Lock MINA collateral.
- Mint zkUSD tokens.
- Manage collateralization through redemption and burning of debt (zkUSD).
- Vaults allow liquidation by anyone if they become undercollateralized, ensuring platform stability.
- Any deposited MINA is delegated, and the vault earns those rewards, effectively providing negative interest rates on loans.

### Price Feed Tracker Accounts

Two tracker accounts are installed on the engine's token account. These trackers are used to track the price of zkUSD.

- Aggregates price submissions from whitelisted oracles.
- Calculates median prices.
- Handles price updates across even/odd blocks lagging pattern to ensure consistent price updates while accounting for Mina's concurrency limitations.

## Installation

### Clone

```sh
git clone https://github.com/zkUSD-Protocol/zkUSD

cd zkUSD
```

### Install Dependencies

```sh
npm install
```

### Test

```sh
npm test
```
