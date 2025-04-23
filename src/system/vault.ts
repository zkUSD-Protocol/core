// ============================================================================
// Vault Types
// ============================================================================

import {
  Struct,
  UInt64,
  PublicKey,
  AccountUpdate,
  Field,
  Permissions,
  Bool,
  Account,
  Provable,
  Mina,
  UInt8,
} from 'o1js';
import { MinaPrice } from './oracle.js';

// Errors
export const VaultErrors = {
  VAULT_EXISTS: 'Vault already exists',
  AMOUNT_ZERO: 'Transaction amount must be greater than zero',
  HEALTH_FACTOR_TOO_LOW:
    'Vault would become undercollateralized (health factor < 100). Add more collateral or reduce debt first',
  HEALTH_FACTOR_TOO_HIGH:
    'Cannot liquidate: Vault is sufficiently collateralized (health factor > 100)',
  AMOUNT_EXCEEDS_DEBT:
    'Cannot repay more than the current outstanding debt amount',
  INVALID_ORACLE_SIG: 'Invalid price feed signature from oracle',
  ORACLE_EXPIRED:
    'Price feed data has expired - please use current oracle data',
  INSUFFICIENT_BALANCE: 'Requested amount exceeds the vaults zkUSD balance',
  INSUFFICIENT_COLLATERAL:
    'Requested amount exceeds the deposited collateral in the vault ',
  VAULT_CREATION_DISABLED: 'Vault creation is currently disabled',
};

/**
 * @title   Vault State Struct
 * @notice  Represents the current state of a user's vault, tracking their collateral, debt, and ownership
 * @dev     This struct is used to map the vault state to the token account state of the user
 * @param   collateralAmount - The amount of MINA collateral deposited in the vault
 * @param   debtAmount - The current amount of zkUSD debt minted against the collateral
 * @param   owner - The public key of the vault owner who has control over vault operations
 */
export class VaultState extends Struct({
  collateralAmount: UInt64,
  debtAmount: UInt64,
  owner: PublicKey,
}) {}

export class VaultParams extends Struct({
  collateralRatio: UInt8,
  liquidationBonusRatio: UInt8,
}) {}

/**
 * @title   Vault Struct
 * @notice  Core vault implementation that manages user collateral and debt positions
 * @dev     Combines the account update mechanism with vault state management
 *          All vault operations (deposit, withdraw, mint, burn) are performed through this struct
 * @param   accountUpdate - The account update object used for on-chain state modifications
 * @param   state - The current state of the vault containing collateral and debt information
 */
export function Vault(params: VaultParams) {
  const VaultClas = class Vault_ extends Struct({
    accountUpdate: AccountUpdate,
    state: VaultState,
  }) {
    static COLLATERAL_RATIO: Field = params.collateralRatio.value; // The collateral ratio is the minimum ratio of collateral to debt that the vault must maintain
    static COLLATERAL_RATIO_PRECISION = Field.from(100); // The precision of the collateral ratio
    static PROTOCOL_FEE_PRECISION = UInt64.from(100); // The precision of the protocol fee
    static UNIT_PRECISION = Field.from(1e9); // The precision of the unit - Mina has 9 decimal places
    static MIN_HEALTH_FACTOR = UInt64.from(100); // The minimum health factor that the vault must maintain when adjusted
    static LIQUIDATION_BONUS_RATIO = params.liquidationBonusRatio.value; // The bonus ratio for liquidators when liquidating a vault

    /**
     * @notice  This method is used to initialize a new vault
     * @param   accountUpdate - The account update object used for on-chain state modifications
     * @param   owner - The public key of the vault owner who has control over vault operations
     * @returns The initialized vault
     */
    static initialize(accountUpdate: AccountUpdate, owner: PublicKey): Vault_ {
      // Prevents memo and fee changes to ensure transaction integrity
      accountUpdate.body.useFullCommitment = Bool(true);

      // Ensures this is a new vault creation to prevent overwriting existing vaults
      accountUpdate.account.isNew
        .getAndRequireEquals()
        .assertTrue(VaultErrors.VAULT_EXISTS);

      // Configure vault permissions:
      // - Prevent verification key changes (for security)
      // - Prevent permission changes (This should remain after a hard fork)
      // - Access and edit state can be set to none as we control all interactions through the engine contract
      accountUpdate.body.update.permissions = {
        isSome: Bool(true),
        value: {
          ...Permissions.default(),
          send: Permissions.proof(),
          setVerificationKey:
            Permissions.VerificationKey.impossibleDuringCurrentVersion(),
          setPermissions: Permissions.impossible(),
          access: Permissions.none(),
          setZkappUri: Permissions.none(),
          setTokenSymbol: Permissions.none(),
          editState: Permissions.none(),
        },
      };

      // Initialize vault with zero collateral and debt
      const initialVaultState = new VaultState({
        collateralAmount: UInt64.zero,
        debtAmount: UInt64.zero,
        owner: owner,
      });

      // Convert state to fields and update on-chain storage
      const initialVaultStateFields = VaultState.toFields(initialVaultState);
      initialVaultStateFields.forEach((field, index) => {
        accountUpdate.body.update.appState[index] = {
          isSome: Bool(true),
          value: field,
        };
      });

      return new Vault_({
        accountUpdate: accountUpdate,
        state: initialVaultState,
      });
    }

    /**
     * @notice  This method is used to retrieve the state of an existing vault
     * @param   accountUpdate - The account update object used to retrieve the vault state
     * @returns The retrieved vault state
     */
    static getAndRequireEquals(accountUpdate: AccountUpdate): Vault_ {
      //TODO: We should constrain the token id of the account to the engine token id

      const state = Vault_.retrieveStateAndRequireEquals(accountUpdate);

      return new Vault_({
        accountUpdate: accountUpdate,
        state: state,
      });
    }

    /**
     * @notice  This method is used to map the zkapp account state to the vault state
     * @param   account - The account object used to retrieve the vault state
     * @returns The retrieved vault state
     */
    static fromAccount(account: Account): VaultState {
      if (!account.zkapp?.appState) {
        throw new Error('Invalid zkApp account state');
      }

      //TODO: constrain the token id of the account to the engine token id

      return VaultState.fromFields(account.zkapp?.appState);
    }

    /**
     * @notice  This method is used to retrieve the state of an existing vault and add preconditions to the account update
     * @param   accountUpdate - The account update object used to retrieve the vault state
     * @returns The retrieved vault state
     */
    static retrieveStateAndRequireEquals(
      accountUpdate: AccountUpdate
    ): VaultState {
      const vaultStateFieldsType = Provable.Array(
        Field,
        VaultState.sizeInFields()
      );
      let inProver_ = Provable.inProver();

      let stateAsFields = Provable.witness(vaultStateFieldsType, () => {
        let account;

        try {
          account = Mina.getAccount(
            accountUpdate.publicKey,
            accountUpdate.tokenId
          );
        } catch (err) {
          console.log(err);

          if (inProver_) {
            throw err;
          }
          let message =
            `VaultState.getAndAddPreconditions failed, either:\n` +
            `1. We can't find this zkapp account in the ledger\n` +
            `2. Because the zkapp account was not found in the cache. ` +
            `Try calling \`await fetchAccount(zkappAddress)\` first.\n` +
            `If none of these are the case, then please reach out on Discord at #zkapp-developers and/or open an issue to tell us!`;

          throw Error(message);
        }

        if (account.zkapp?.appState === undefined) {
          // if the account is not a zkapp account, let the default state be all zeroes
          return Array(VaultState.sizeInFields()).fill(Field(0));
        }

        let stateAsFields = [];

        for (let i = 0; i < VaultState.sizeInFields(); i++) {
          stateAsFields.push(account.zkapp?.appState[i]);
        }

        return stateAsFields;
      });

      // Add preconditions to the account update
      stateAsFields.forEach((field, index) => {
        accountUpdate.body.preconditions.account.state[index] = {
          isSome: Bool(true),
          value: field,
        };
      });

      return VaultState.fromFields(stateAsFields);
    }

    /**
     * @notice  This method is used to calculate the health factor of the vault.
     *          We calculate the health factor by dividing the maximum allowed debt by the debt amount.
     *          The health factor is a normalised mesaure of the "healthiness" of the vault.
     *
     *          A health factor > 100 is over collateralised
     *          A health factor < 100 is under collateralised and will be liquidated
     *
     * @param   collateralAmount - The amount of collateral
     * @param   debtAmount - The amount of debt
     * @param   minaPrice - MINA/nanoUSD price
     * @returns The health factor of the vault
     */
    public calculateHealthFactor(
      collateralAmount: UInt64,
      debtAmount: UInt64,
      minaPrice: MinaPrice
    ): UInt64 {
      const collateralValue = calculateUsdValue(collateralAmount, minaPrice);
      const maxAllowedDebt = calculateMaxAllowedDebt(collateralValue);
      const debtInFields = debtAmount.toFields()[0];
      return UInt64.fromFields([safeDiv(maxAllowedDebt, debtInFields)]);
    }

    /**
     * @notice  This method is used to update the owner of the vault
     * @param   newOwner - The new owner of the vault
     * @param   owner - The current owner of the vault
     * @returns The new vault state after the owner update
     */
    updateOwner(newOwner: PublicKey, owner: PublicKey): VaultState {
      this.state.owner.assertEquals(owner);

      const newVaultState = new VaultState({
        collateralAmount: this.state.collateralAmount,
        debtAmount: this.state.debtAmount,
        owner: newOwner,
      });

      const newVaultStateFields = VaultState.toFields(newVaultState);
      newVaultStateFields.forEach((field, index) => {
        this.accountUpdate.body.update.appState[index] = {
          isSome: Bool(true),
          value: field,
        };
      });

      return newVaultState;
    }

    /**
     * @notice  This method is used to deposit collateral into the vault
     * @param   amount - The amount of collateral to deposit
     * @param   owner - The public key of the vault owner
     * @returns The new vault state after the deposit
     */
    depositCollateral(amount: UInt64, owner: PublicKey): VaultState {
      // Verify the caller is the vault owner
      this.state.owner.assertEquals(owner);
      // Ensure deposit amount is positive
      amount.assertGreaterThan(UInt64.zero, VaultErrors.AMOUNT_ZERO);

      // Create new vault state with increased collateral
      const newVaultState = new VaultState({
        collateralAmount: this.state.collateralAmount.add(amount),
        debtAmount: this.state.debtAmount,
        owner: owner,
      });

      // Update on-chain state
      const newVaultStateFields = VaultState.toFields(newVaultState);
      newVaultStateFields.forEach((field, index) => {
        this.accountUpdate.body.update.appState[index] = {
          isSome: Bool(true),
          value: field,
        };
      });

      return newVaultState;
    }

    /**
     * @notice  This method is used to redeem collateral from the vault
     * @param   amount - The amount of collateral to redeem
     * @param   owner - The public key of the vault owner
     * @param   minaPrice - The current price of MINA in nanoUSD
     * @returns The new vault state after the redemption
     */
    redeemCollateral(
      amount: UInt64,
      owner: PublicKey,
      minaPrice: MinaPrice
    ): VaultState {
      // Verify caller is vault owner
      this.state.owner.assertEquals(owner);
      // Ensure redemption amount is positive
      amount.assertGreaterThan(UInt64.zero, VaultErrors.AMOUNT_ZERO);
      // Verify sufficient collateral exists
      amount.assertLessThanOrEqual(
        this.state.collateralAmount,
        VaultErrors.INSUFFICIENT_COLLATERAL
      );

      // Calculate remaining collateral after withdrawal
      const remainingCollateral = this.state.collateralAmount.sub(amount);

      // Check if vault remains healthy after withdrawal
      const healthFactor = this.calculateHealthFactor(
        remainingCollateral,
        this.state.debtAmount,
        minaPrice
      );

      // Ensure health factor stays above minimum
      healthFactor.assertGreaterThanOrEqual(
        Vault_.MIN_HEALTH_FACTOR,
        VaultErrors.HEALTH_FACTOR_TOO_LOW
      );

      // Create new vault state with reduced collateral
      const newVaultState = new VaultState({
        collateralAmount: remainingCollateral,
        debtAmount: this.state.debtAmount,
        owner: owner,
      });

      // Update on-chain state
      const newVaultStateFields = VaultState.toFields(newVaultState);
      newVaultStateFields.forEach((field, index) => {
        this.accountUpdate.body.update.appState[index] = {
          isSome: Bool(true),
          value: field,
        };
      });

      return newVaultState;
    }

    /**
     * @notice  This method is used to mint zkUSD against the vault
     * @param   amount - The amount of zkUSD to mint
     * @param   owner - The public key of the vault owner
     * @param   minaPrice - The current price of MINA in nanoUSD
     * @returns The new vault state after the mint
     */
    mintZkUsd(
      amount: UInt64,
      owner: PublicKey,
      minaPrice: MinaPrice
    ): VaultState {
      // Verify caller is vault owner
      this.state.owner.assertEquals(owner);

      // Ensure mint amount is positive
      amount.assertGreaterThan(UInt64.zero, VaultErrors.AMOUNT_ZERO);

      // Calculate health factor after potential mint
      const healthFactor = this.calculateHealthFactor(
        this.state.collateralAmount,
        this.state.debtAmount.add(amount),
        minaPrice
      );

      // Ensure vault remains healthy after minting
      healthFactor.assertGreaterThanOrEqual(
        Vault_.MIN_HEALTH_FACTOR,
        VaultErrors.HEALTH_FACTOR_TOO_LOW
      );

      // Create new vault state with increased debt
      const newVaultState = new VaultState({
        collateralAmount: this.state.collateralAmount,
        debtAmount: this.state.debtAmount.add(amount),
        owner: owner,
      });

      // Update on-chain state
      const newVaultStateFields = VaultState.toFields(newVaultState);
      newVaultStateFields.forEach((field, index) => {
        this.accountUpdate.body.update.appState[index] = {
          isSome: Bool(true),
          value: field,
        };
      });

      return newVaultState;
    }

    /**
     * @notice  This method is used to burn zkUSD against the vault
     * @param   amount - The amount of zkUSD to burn
     * @param   owner - The public key of the vault owner
     * @returns The new vault state after the burn
     */
    burnZkUsd(amount: UInt64, owner: PublicKey): VaultState {
      // Verify caller is vault owner
      this.state.owner.assertEquals(owner);
      // Ensure burn amount is positive
      amount.assertGreaterThan(UInt64.zero, VaultErrors.AMOUNT_ZERO);

      // Verify sufficient debt exists to burn
      this.state.debtAmount.assertGreaterThanOrEqual(
        amount,
        VaultErrors.AMOUNT_EXCEEDS_DEBT
      );

      // Create new vault state with reduced debt
      const newVaultState = new VaultState({
        collateralAmount: this.state.collateralAmount,
        debtAmount: this.state.debtAmount.sub(amount),
        owner: owner,
      });

      // Update on-chain state
      const newVaultStateFields = VaultState.toFields(newVaultState);
      newVaultStateFields.forEach((field, index) => {
        this.accountUpdate.body.update.appState[index] = {
          isSome: Bool(true),
          value: field,
        };
      });

      return newVaultState;
    }

    /**
     * @notice  This method is used to liquidate the vault
     * @param   minaPrice - The current price of MINA in nanoUSD
     * @returns The results of the liquidation
     */
    liquidate(minaPrice: MinaPrice): LiquidationResults {
      // Calculate current health factor
      const healthFactor = this.calculateHealthFactor(
        this.state.collateralAmount,
        this.state.debtAmount,
        minaPrice
      );

      // Ensure vault is eligible for liquidation
      healthFactor.assertLessThanOrEqual(
        Vault_.MIN_HEALTH_FACTOR,
        VaultErrors.HEALTH_FACTOR_TOO_HIGH
      );

      // Store old state for event emission
      const oldVaultState = this.state;

      // Reset vault state after liquidation
      const newVaultState = new VaultState({
        collateralAmount: UInt64.zero,
        debtAmount: UInt64.zero,
        owner: this.state.owner,
      });

      // Update on-chain state
      const newVaultStateFields = VaultState.toFields(newVaultState);
      newVaultStateFields.forEach((field, index) => {
        this.accountUpdate.body.update.appState[index] = {
          isSome: Bool(true),
          value: field,
        };
      });

      // Calculate collateral distribution between liquidator and owner
      const { liquidatorCollateral, vaultOwnerCollateral } =
        computeLiquidationAmounts({
          collateralAmount: this.state.collateralAmount.value,
          liquidatedDebt: this.state.debtAmount.value,
          minaPrice,
        });

      return new LiquidationResults({
        oldVaultState,
        liquidatorCollateral: UInt64.Unsafe.fromField(liquidatorCollateral),
        vaultOwnerCollateral: UInt64.Unsafe.fromField(vaultOwnerCollateral),
      });
    }

    /**
     * @notice  This method is used to get the health factor of the vault
     * @param   minaPrice - The current price of MINA in nanoUSD
     * @returns The health factor of the vault
     */
    public getHealthFactor(minaPrice: MinaPrice): UInt64 {
      return this.calculateHealthFactor(
        this.state.collateralAmount,
        this.state.debtAmount,
        minaPrice
      );
    }
  };

  /**
   * @notice  This method is used to calculate the USD value of the collateral
   * @param   amount - The amount of collateral
   * @param   minaPrice - MINA/nanoUSD price
   * @returns The USD value of the collateral
   */
  function calculateUsdValue(amount: UInt64, minaPrice: MinaPrice): Field {
    return fieldIntegerDiv(
      amount.value.mul(minaPrice.priceNanoUSD.value),
      VaultClas.UNIT_PRECISION
    );
  }

  /**
   * @notice  Calculates the equivalent MINA value for a given USD amount based on the current USD price.
   * @param   usdValue - The USD amount to be converted.
   * @param   minaPrice - The current MINA/nanoUSD price.
   * @returns The calculated MINA value corresponding to the provided USD amount.
   */
  function calculateMinaValue(usdValue: Field, minaPrice: MinaPrice): Field {
    return fieldIntegerDiv(
      usdValue.mul(VaultClas.UNIT_PRECISION),
      minaPrice.priceNanoUSD.value
    );
  }

  /**
   * @notice  This method is used to calculate the maximum allowed debt based on the collateral value
   * @param   collateralValue - The USD value of the collateral
   * @returns The maximum allowed debt based on our collateral ratio - which is 150%
   */
  function calculateMaxAllowedDebt(collateralValue: Field): Field {
    const numCollateralValue = collateralValue.mul(
      VaultClas.COLLATERAL_RATIO_PRECISION
    );

    const maxAllowedDebt = fieldIntegerDiv(
      numCollateralValue,
      VaultClas.COLLATERAL_RATIO
    ).mul(VaultClas.COLLATERAL_RATIO_PRECISION);

    return maxAllowedDebt;
  }

  /**
   * @notice  Computes the amounts of collateral to be sent to the liquidator and the vault owner
   *          during a liquidation process.
   * @param   args - An object containing the following properties:
   *           - collateralAmount: The total amount of collateral in the vault (UInt64).
   *           - liquidatedDebt: The amount of debt to be liquidated from the vault (UInt64).
   *           - minaPrice: The USD price of the collateral (UInt64).
   * @returns A promise that resolves to an object containing:
   *           - liquidatorCollateral: The amount of collateral to be sent to the liquidator.
   *           - ownerCollateral: The remaining collateral to be returned to the vault owner.
   */
  function computeLiquidationAmounts(args: {
    collateralAmount: Field;
    liquidatedDebt: Field;
    minaPrice: MinaPrice;
  }) {
    // TODO verify rounding and precision
    const { collateralAmount, liquidatedDebt, minaPrice } = args;

    // Calculate the USD value of the collateral
    const liquidatedDebtMina = calculateMinaValue(liquidatedDebt, minaPrice);

    const liquidatorMaxCollateral = fieldIntegerDiv(
      liquidatedDebtMina.mul(VaultClas.LIQUIDATION_BONUS_RATIO),
      Field(100)
    );

    // Calculate the USD value of the collateral that the liquidator will get
    const liquidatorCollateral = Provable.if(
      collateralAmount.greaterThanOrEqual(liquidatorMaxCollateral),
      liquidatorMaxCollateral,
      collateralAmount
    );

    // Calculate the collateral amount that the vault owner will get
    const vaultOwnerCollateral = collateralAmount.sub(liquidatorCollateral);

    return { liquidatorCollateral, vaultOwnerCollateral };
  }

  /**
   * @notice  This method is used to perform integer division on fields
   * @param   x - The numerator
   * @param   y - The denominator
   * @returns The quotient of the division
   */
  function fieldIntegerDiv(x: Field, y: Field): Field {
    // Ensure y is not zero to avoid division by zero
    y.assertNotEquals(Field(0), 'Division by zero');

    // Witness the quotient q = floor(x / y)
    const q = Provable.witness(Field, () => {
      const xn = x.toBigInt();
      const yn = y.toBigInt();
      const qn = xn / yn; // Integer division
      return Field(qn);
    });

    // Compute the remainder r = x - q * y
    const r = x.sub(q.mul(y));

    // Add constraints to ensure x = q * y + r, and 0 ≤ r < y
    r.assertGreaterThanOrEqual(Field(0));
    r.assertLessThan(y);

    // Enforce the relation x = q * y + r
    x.assertEquals(q.mul(y).add(r));

    // Return the quotient q
    return q;
  }

  /**
   * @notice  This method is used to safely divide two fields (incase we have a zero denominator)
   * @param   numerator - The numerator
   * @param   denominator - The denominator
   * @returns The quotient of the division
   */
  function safeDiv(numerator: Field, denominator: Field): Field {
    const isDenominatorZero = denominator.equals(Field(0));
    const safeDenominator = Provable.if(
      isDenominatorZero,
      Field(1),
      denominator
    );

    const divisionResult = fieldIntegerDiv(numerator, safeDenominator);

    return Provable.if(
      isDenominatorZero,
      UInt64.MAXINT().toFields()[0],
      divisionResult
    );
  }

  return VaultClas;
}

/**
 * @title   Liquidation Results Struct
 * @notice  Contains the results of a vault liquidation process
 * @dev     Used to track the state changes and collateral distribution after liquidation
 * @param   oldVaultState - The state of the vault before liquidation
 * @param   liquidatorCollateral - Amount of collateral to be transferred to the liquidator
 * @param   vaultOwnerCollateral - Remaining collateral to be returned to the vault owner
 */
export class LiquidationResults extends Struct({
  oldVaultState: VaultState,
  liquidatorCollateral: UInt64,
  vaultOwnerCollateral: UInt64,
}) {}
