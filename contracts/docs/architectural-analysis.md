# zkUSD Architecture Analysis and Recommendations

## Introduction

This document presents a comprehensive analysis of the architectural options considered for developing **zkUSD**, a private, algorithmic stablecoin on the Mina Protocol. The aim is to determine the optimal architecture that meets the specific requirements of zkUSD while addressing the inherent limitations and trade-offs of each option. This analysis covers various design choices within the Mina ecosystem, leading to a recommended architecture for zkUSD.

## zkUSD Requirements

Before delving into the architectural options, it's essential to outline the specific requirements and constraints of zkUSD:

- **Overcollateralised Stablecoin**: zkUSD is an exogenous algorithmic stablecoin that requires users to lock up MINA tokens as collateral to mint zkUSD, pegged to the US Dollar.
- **Collateralisation Ratio**: Users must maintain a collateralisation ratio of at least 150% to ensure platform stability and protect against sudden price drops.
- **Collateralised Debt Positions (CDPs)**: The system must track individual users' debt positions, allowing only the position owners to interact with their CDPs (e.g., deposit collateral, mint zkUSD).
- **Liquidations**: The protocol must enable the liquidation of undercollateralised positions by any user, with incentives to encourage timely liquidations.
- **Token Minting/Burning**: The application needs to mint and burn zkUSD tokens under specific conditions to control the stablecoin supply and maintain its peg.
- **Interoperability**: zkUSD must be interoperable within the Mina ecosystem, allowing it to serve as a DeFi primitive and be used across various applications at the base layer.
- **Concurrency Handling**: The architecture must support multiple users interacting with the system concurrently without encountering state update conflicts.

## Analysis of Architecture Options

### 1. Vanilla zkApp

**Overview**:

- A vanilla zkApp on Mina consists of on-chain state and code that governs state transitions.
- Users generate zero-knowledge proofs that they have executed code against a particular state, allowing them to update the state on-chain.
- Proofs include "preconditions" that specify the state of the app when the code was executed.

**Challenges**:

- **Concurrency Issues**: Vanilla zkApps suffer from concurrency limitations. Only one user interaction per block can be processed without causing precondition invalidation for other users.
- **Block Time Constraints**: With Mina's block time of approximately 3 minutes, this limitation severely hampers the application's usability.

**Analysis**:

- While vanilla zkApps offer simplicity, the inability to handle concurrent user interactions makes them unsuitable for zkUSD, which requires multiple users to interact with the protocol simultaneously (e.g., creating CDPs, depositing collateral, initiating liquidations).

### 2. Protokit (L2 App-Chain)

**Overview**:

- Protokit allows developers to build their own Layer 2 (L2) app-chains, handling state management and transaction sequencing.
- State updates are rolled up and settled on Layer 1 (L1).

**Challenges**:

- **Interoperability Limitations**: Actions in zkUSD often result in emissions (minting zkUSD) or immissions (depositing collateral) that need to be reflected on L1 for interoperability.
- **State Settlement Delays**: Rolling up state updates can introduce delays in reflecting critical actions, such as liquidations or collateral adjustments, on L1.

**Analysis**:

- Given the importance of interoperability for zkUSD, using Protokit is not viable. The necessity for real-time state updates on L1 to maintain the stablecoin's peg and allow seamless interaction with other L1 applications outweighs the benefits of an L2 app-chain.

### 3. L2 Chain (e.g., Zeko)

**Overview**:

- Building zkUSD on an existing L2 chain like Zeko could offer faster block times and improved scalability.
- Users deposit MINA tokens to the L2 chain, where they can interact with applications.

**Challenges**:

- **Isolation from L1**: Assets and applications on the L2 chain are isolated from L1 unless specific mechanisms are in place to bridge them.
- **Interoperability Concerns**: Since zkUSD needs to be widely usable within the Mina ecosystem, being confined to an L2 chain limits its utility.

**Analysis**:

- The requirement for high interoperability makes deploying zkUSD on an L2 chain unsuitable. The stablecoin must be accessible and usable across the Mina ecosystem at the base layer.

### 4. Action/Reducer Model

**Overview**:

- The Action/Reducer model decouples user actions from state updates.
- Users dispatch actions that are later reduced in a single transaction to update the state sequentially.

**Challenges**:

- **Account Update Limit**: Mina imposes a limit of 9 account updates per transaction.
- **Coupled Account and State Updates**: For zkUSD, account updates (e.g., minting tokens) must occur atomically with state updates to maintain protocol integrity.
- **Concurrency Risks**: Decoupling account updates from state updates can lead to inconsistencies and protocol instability as account updates can be processed without the accompanying state transition.

**Analysis**:

- The need for atomicity between account updates and state updates in zkUSD makes the Action/Reducer model impractical. The account update limit further constrains the number of actions that can be processed together, leading to potential system instability.

### 5. Batch Reducer

**Overview**:

- The Batch Reducer is similar to the Action/Reducer model but processes batches of actions.

**Challenges**:

- **Same as Action/Reducer**: The Batch Reducer faces the same limitations regarding account update limits and the need for atomic state and account updates.

**Analysis**:

- The Batch Reducer does not resolve the fundamental issues present in the Action/Reducer model and is therefore not suitable for zkUSD.

### 6. Off-Chain State

**Overview**:

- Off-chain state management involves maintaining state data off-chain (e.g., in Merkle Trees), with only the root hash stored on-chain.
- Users interact with the off-chain state and submit proofs to update the on-chain root hash.

**Challenges**:

- **Account Update Atomicity**: Similar to the Action/Reducer model, account updates must occur atomically with state updates.
- **Potential for Exploits**: Any potential solutions that ensure that only one action is allowed to be pending at a time has the potential for exploits which could lead to platform instability.

**Analysis**:

- While off-chain state management offers some advantages, the inability to ensure atomicity between account and state updates, along with potential security exploits, makes it unsuitable for zkUSD's requirements.

## Conclusion

### Final Choice: Multiple zkUSD Vaults

_Credit to @rpanic for the idea._

**Overview**:

- Instead of a single orchestrator contract managing all CDPs, each user deploys their own **zkUSD Vault**—a personal zkApp that manages their CDPs.
- These vaults are independent and contain all the logic necessary for managing collateral, minting zkUSD, and handling liquidations.
- Vaults communicate with the network via events, allowing anyone to monitor and initiate liquidations if a vault becomes undercollateralised.

**Advantages**:

- **Concurrency Handling**: Since each vault is a separate zkApp, users can interact with their own vaults without affecting others. This eliminates concurrency issues inherent in single-contract architectures.
- **Atomic Operations**: Account updates and state transitions are confined within individual vaults, ensuring atomicity.
- **Interoperability**: zkUSD tokens minted from vaults are standard tokens on the base layer, ensuring they are interoperable across the Mina ecosystem.
- **Security**: Users have full control over their vaults, and liquidation logic can be securely implemented within each vault.

**Analysis**:

- This architecture aligns perfectly with zkUSD's requirements. It leverages the strengths of vanilla zkApps while mitigating concurrency issues by decentralising state management to individual vaults.
- Liquidations are still possible, as vaults emit events that the network can monitor.
- The approach maintains interoperability, as zkUSD tokens are standard tokens on the base layer.

## Recommendations

Based on the analysis, the recommended architecture for zkUSD is to:

- **Implement Individual zkUSD Vaults for Each User**:

  - Each user deploys their own vault zkApp to manage their CDPs.
  - Vaults handle collateral management, minting/burning of zkUSD, and enforce protocol rules (e.g., maintaining collateralisation ratios).

- **Utilise a L1 token for zkUSD Tokens**:

  - Ensures that zkUSD tokens are interoperable across the Mina ecosystem.
  - Allows for seamless integration with other DeFi applications and protocols.

- **Implement Liquidation Monitoring via Events**:

  - Vaults emit events containing necessary data (e.g., collateralisation ratios).
  - Network participants can monitor these events and initiate liquidations when required.

- **Ensure Security and Privacy**:

  - Vaults encapsulate all user-specific logic, enhancing security.
  - Utilise zero-knowledge proofs to maintain user privacy where applicable.

- **Plan for Scalability and User Experience**:
  - Provide a UI to simplify vault deployment for end-users.
  - Optimise vault logic to minimise transaction costs and improve performance.

## References

- Mina Protocol Documentation: [https://docs.minaprotocol.com/](https://docs.minaprotocol.com/)
