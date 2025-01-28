# Upgradability

We want to cater for two different scenarios where we want to upgrade our contracts:

1. We want to be able to upgrade the engine/vault contracts to new versions as we increase our levels of decentralisation.
2. We want to be able to upgrade the engine and vault contracts in the event of a hardfork.

## Upgradability - Engine/Vault Contracts

As our protocol evolves, we want to retain the ability to upgrade the various components of our protocol as we move along the path of decentralisation. This might involve upgrading the engine to utilise a DAO for administrative functions, implement a new fee structure, or improving the oracle price feed.

### Considerations

- When we upgrade a contract to introduce new state, can we overwrite the existing state with the new state?
- How does this look block by block as the verification key changes?
- Will we also need to update the verification key of the vault when we change the engine? (Dont think so)

## Upgradability - Hardfork

We want to be able to upgrade the engine and vault contracts in the event of a hardfork. The difficulty here is that when the hardfork occurs, then the permissions to upgrade the vaults is set to signature, which means that a user will need to retain their private key of the vault in order to upgrade the vault, otherwise the vault will become bricked. We also should not have to rely on users to upgrade their vaults to be able to liquidate their positions, should they become undercollateralised. Which would break the protocol.

### Considerations

- How do we ensure that the vaults are upgraded in the event of a hardfork?
- How can we continue to track the state and health factor of vaults in the event of a hardfork?
  - If the vault is undercollateralised and needs to be liquidated, can we do that from the engine contract and still alter the state of the vault, even though they haven't updated their verification key?
- How can we ensure that the ability to update the verification key of the vault doesnt impact the system?
