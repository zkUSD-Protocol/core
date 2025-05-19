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
  Poseidon,
} from 'o1js';
import { MinaPrice } from '../../../system/oracle.js';

// Errors
export const VaultErrors = {
  VaultEXISTS: 'Vault already exists',
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
};

/**
 * @title   Vault Struct
 * @notice  Core vault implementation that manages user collateral and debt positions
 * @dev     Combines the account update mechanism with vault state management
 *          All vault operations (deposit, withdraw, mint, burn) are performed through this struct
 * @param   accountUpdate - The account update object used for on-chain state modifications
 * @param   state - The current state of the vault containing collateral and debt information
 */
export class Vault extends Struct({
  type: UInt8, // Collateral type of vault
  collateralAmount: UInt64,
  debtAmount: UInt64,
}) {
  static COLLATERAL_RATIO: Field = Field.from(150); // The collateral ratio is the minimum ratio of collateral to debt that the vault must maintain
  static COLLATERAL_RATIO_PRECISION = Field.from(100); // The precision of the collateral ratio
  static PROTOCOL_FEE_PRECISION = UInt64.from(100); // The precision of the protocol fee
  static UNIT_PRECISION = Field.from(1e9); // The precision of the unit - Mina has 9 decimal places
  static MIN_HEALTH_FACTOR = UInt64.from(100); // The minimum health factor that the vault must maintain when adjusted
  static LIQUIDATION_BONUS_RATIO = Field.from(110); // The bonus ratio for liquidators when liquidating a vault

  /**
   * @notice  This method is used to initialize a new vault
   * @returns The initialized vault
   */
  static new(type: UInt8): Vault {
    return new Vault({
      type: type,
      collateralAmount: UInt64.zero,
      debtAmount: UInt64.zero,
    });
  }

  pack(): Field {
    const bits = [
      ...this.type.value.toBits(8),
      ...this.collateralAmount.value.toBits(64),
      ...this.debtAmount.value.toBits(64),
    ];

    return Field.fromBits(bits);
  }

  static unpack(packedVault: Field): Vault {
    const bitFields = [
      { name: 'type', length: 8 },
      { name: 'collateralAmount', length: 64 },
      { name: 'debtAmount', length: 64 },
    ];

    const TOTAL_BITS = bitFields.reduce((sum, f) => sum + f.length, 0);
    if (TOTAL_BITS > 254) {
      throw new Error(
        `VaultPacked uses ${TOTAL_BITS} bits, exceeding the 254-bit limit.`
      );
    }

    const bits = packedVault.toBits(TOTAL_BITS);
    let offset = 0;
    const readBits = (len: number) => {
      const slice = bits.slice(offset, offset + len);
      offset += len;
      return Field.fromBits(slice);
    };

    const type = UInt8.Unsafe.fromField(readBits(8));
    const collateralAmount = UInt64.Unsafe.fromField(readBits(64));
    const debtAmount = UInt64.Unsafe.fromField(readBits(64));

    return new Vault({
      type,
      collateralAmount,
      debtAmount,
    });
  }

  hash(): Field {
    return Poseidon.hash([
      this.type.value,
      this.collateralAmount.value,
      this.debtAmount.value,
    ]);
  }

  toFields(): Field[] {
    return [
      this.type.value,
      this.collateralAmount.value,
      this.debtAmount.value,
    ];
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
    const collateralValue = this.calculateUsdValue(collateralAmount, minaPrice);
    const maxAllowedDebt = this.calculateMaxAllowedDebt(collateralValue);
    const debtInFields = debtAmount.toFields()[0];
    return UInt64.fromFields([this.safeDiv(maxAllowedDebt, debtInFields)]);
  }

  /**
   * @notice  This method is used to deposit collateral into the vault
   * @param   amount - The amount of collateral to deposit
   * @param   owner - The public key of the vault owner
   * @returns The new vault state after the deposit
   */
  depositCollateral(amount: UInt64) {
    // Ensure deposit amount is positive
    amount.assertGreaterThan(UInt64.zero, VaultErrors.AMOUNT_ZERO);

    this.collateralAmount = this.collateralAmount.add(amount);
  }

  /**
   * @notice  This method is used to redeem collateral from the vault
   * @param   amount - The amount of collateral to redeem
   * @param   owner - The public key of the vault owner
   * @param   minaPrice - The current price of MINA in nanoUSD
   * @returns The new vault state after the redemption
   */
  redeemCollateral(amount: UInt64, minaPrice: MinaPrice) {
    // Ensure redemption amount is positive
    amount.assertGreaterThan(UInt64.zero, VaultErrors.AMOUNT_ZERO);
    // Verify sufficient collateral exists
    amount.assertLessThanOrEqual(
      this.collateralAmount,
      VaultErrors.INSUFFICIENT_COLLATERAL
    );

    // Calculate remaining collateral after withdrawal
    const remainingCollateral = this.collateralAmount.sub(amount);

    // Check if vault remains healthy after withdrawal
    const healthFactor = this.calculateHealthFactor(
      remainingCollateral,
      this.debtAmount,
      minaPrice
    );

    // Ensure health factor stays above minimum
    healthFactor.assertGreaterThanOrEqual(
      Vault.MIN_HEALTH_FACTOR,
      VaultErrors.HEALTH_FACTOR_TOO_LOW
    );

    this.collateralAmount = remainingCollateral;
  }

  /**
   * @notice  This method is used to mint zkUSD against the vault
   * @param   amount - The amount of zkUSD to mint
   * @param   owner - The public key of the vault owner
   * @param   minaPrice - The current price of MINA in nanoUSD
   * @returns The new vault state after the mint
   */
  mintZkUsd(amount: UInt64, minaPrice: MinaPrice) {
    // Ensure mint amount is positive
    amount.assertGreaterThan(UInt64.zero, VaultErrors.AMOUNT_ZERO);

    // Calculate health factor after potential mint
    const healthFactor = this.calculateHealthFactor(
      this.collateralAmount,
      this.debtAmount.add(amount),
      minaPrice
    );

    // Ensure vault remains healthy after minting
    healthFactor.assertGreaterThanOrEqual(
      Vault.MIN_HEALTH_FACTOR,
      VaultErrors.HEALTH_FACTOR_TOO_LOW
    );

    // Create new vault state with increased debt
    this.debtAmount = this.debtAmount.add(amount);
  }

  /**
   * @notice  This method is used to burn zkUSD against the vault
   * @param   amount - The amount of zkUSD to burn
   * @param   owner - The public key of the vault owner
   * @returns The new vault state after the burn
   */
  burnZkUsd(amount: UInt64) {
    // Ensure burn amount is positive
    amount.assertGreaterThan(UInt64.zero, VaultErrors.AMOUNT_ZERO);

    // Verify sufficient debt exists to burn
    this.debtAmount.assertGreaterThanOrEqual(
      amount,
      VaultErrors.AMOUNT_EXCEEDS_DEBT
    );

    // Create new vault state with reduced debt
    this.debtAmount = this.debtAmount.sub(amount);
  }

  /**
   * @notice  This method is used to liquidate the vault
   * @param   minaPrice - The current price of MINA in nanoUSD
   * @returns The results of the liquidation
   */
  liquidate(minaPrice: MinaPrice): LiquidationResults {
    // Calculate current health factor
    const healthFactor = this.calculateHealthFactor(
      this.collateralAmount,
      this.debtAmount,
      minaPrice
    );

    // Ensure vault is eligible for liquidation
    healthFactor.assertLessThanOrEqual(
      Vault.MIN_HEALTH_FACTOR,
      VaultErrors.HEALTH_FACTOR_TOO_HIGH
    );

    // Store old state for event emission
    const oldVault = this;

    // Reset vault state after liquidation
    this.collateralAmount = UInt64.zero;
    this.debtAmount = UInt64.zero;

    // Calculate collateral distribution between liquidator and owner
    const { liquidatorCollateral, vaultOwnerCollateral } =
      this.computeLiquidationAmounts({
        collateralAmount: this.collateralAmount.value,
        liquidatedDebt: this.debtAmount.value,
        minaPrice,
      });

    return new LiquidationResults({
      oldVault: oldVault,
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
      this.collateralAmount,
      this.debtAmount,
      minaPrice
    );
  }

  /**
   * @notice  This method is used to calculate the USD value of the collateral
   * @param   amount - The amount of collateral
   * @param   minaPrice - MINA/nanoUSD price
   * @returns The USD value of the collateral
   */
  public calculateUsdValue(amount: UInt64, minaPrice: MinaPrice): Field {
    return this.fieldIntegerDiv(
      amount.value.mul(minaPrice.priceNanoUSD.value),
      Vault.UNIT_PRECISION
    );
  }

  /**
   * @notice  Calculates the equivalent MINA value for a given USD amount based on the current USD price.
   * @param   usdValue - The USD amount to be converted.
   * @param   minaPrice - The current MINA/nanoUSD price.
   * @returns The calculated MINA value corresponding to the provided USD amount.
   */
  public calculateMinaValue(usdValue: Field, minaPrice: MinaPrice): Field {
    return this.fieldIntegerDiv(
      usdValue.mul(Vault.UNIT_PRECISION),
      minaPrice.priceNanoUSD.value
    );
  }

  /**
   * @notice  This method is used to calculate the maximum allowed debt based on the collateral value
   * @param   collateralValue - The USD value of the collateral
   * @returns The maximum allowed debt based on our collateral ratio - which is 150%
   */
  public calculateMaxAllowedDebt(collateralValue: Field): Field {
    const numCollateralValue = collateralValue.mul(
      Vault.COLLATERAL_RATIO_PRECISION
    );

    const maxAllowedDebt = this.fieldIntegerDiv(
      numCollateralValue,
      Vault.COLLATERAL_RATIO
    ).mul(Vault.COLLATERAL_RATIO_PRECISION);

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
  public computeLiquidationAmounts(args: {
    collateralAmount: Field;
    liquidatedDebt: Field;
    minaPrice: MinaPrice;
  }) {
    // TODO verify rounding and precision
    const { collateralAmount, liquidatedDebt, minaPrice } = args;

    // Calculate the USD value of the collateral
    const liquidatedDebtMina = this.calculateMinaValue(
      liquidatedDebt,
      minaPrice
    );

    const liquidatorMaxCollateral = this.fieldIntegerDiv(
      liquidatedDebtMina.mul(Vault.LIQUIDATION_BONUS_RATIO),
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
  public fieldIntegerDiv(x: Field, y: Field): Field {
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
  public safeDiv(numerator: Field, denominator: Field): Field {
    const isDenominatorZero = denominator.equals(Field(0));
    const safeDenominator = Provable.if(
      isDenominatorZero,
      Field(1),
      denominator
    );

    const divisionResult = this.fieldIntegerDiv(numerator, safeDenominator);

    return Provable.if(
      isDenominatorZero,
      UInt64.MAXINT().toFields()[0],
      divisionResult
    );
  }
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
  oldVault: Vault,
  liquidatorCollateral: UInt64,
  vaultOwnerCollateral: UInt64,
}) {}
