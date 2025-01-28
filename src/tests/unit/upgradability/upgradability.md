# Upgradability

We want to cater for two different scenarios where we want to upgrade our contracts:

1. We want to be able to upgrade the engine contract to new versions as we improve decentralisation with further development.

## Upgradability - Engine Contract

As our protocol evolves, we want to retain the ability to upgrade the engine contract to new versions as we move along the path of decentralisation. This might involve upgrading the engine to utilise a DAO for administrative functions, implement a new fee structure, or improving the oracle price feed.

### Considerations

- When we upgrade a contract to introduce new state, can we overwrite the existing state with the new state?
- How does this look block by block as the verification key changes?
