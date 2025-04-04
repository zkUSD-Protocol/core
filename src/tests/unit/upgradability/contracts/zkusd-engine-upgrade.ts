import {
  FungibleTokenAdminBase,
  FungibleTokenContract,
} from '@minatokens/token';
import {
  AccountUpdate,
  Bool,
  Field,
  method,
  PublicKey,
  State,
  state,
  UInt64,
  Poseidon,
  TokenContract,
  AccountUpdateForest,
  Int64,
  UInt32,
  VerificationKey,
  UInt8,
} from 'o1js';

import {
  EmergencyStopToggledEvent,
  AdminUpdatedEvent,
  OracleWhitelistUpdatedEvent,
  NewVaultEvent,
  DepositCollateralEvent,
  RedeemCollateralEvent,
  MintZkUsdEvent,
  BurnZkUsdEvent,
  LiquidateEvent,
  VaultOwnerUpdatedEvent,
  ValidPriceBlockCountUpdatedEvent,
} from '../../../../system/events.js';
import {
  MinaPriceInput,
  verifyMinaPriceInput as verifyMinaPriceInputProof,
} from '../../../../proofs/oracle-price-aggregation/verify.js';
import { PriceAggregationProofPublicOutput } from '../../../../proofs/oracle-price-aggregation/common.js';
import { ZkUsdEngineErrors } from '../../../../system/engine.js';
import { MinaPrice, OracleWhitelist } from '../../../../system/oracle.js';
import { Vault, VaultParams } from '../../../../system/vault.js';
import { NO_RESOLUTION_INDEX } from '../../../../system/governance.js';

/**
 * @title   zkUSD Engine contract
 * @notice  This is a fake contract to test the upgradability of the zkUSD engine.
 */

const COLLATERAL_RATIO = UInt8.from(150);
const LIQUIDATION_BONUS_RATIO = UInt8.from(110);

export function ZkUsdEngineUpgradeContract(args: {
  zkUsdTokenAddress: PublicKey;
  minaPriceInputZkProgramVkHash: Field;
}) {
  const { zkUsdTokenAddress, minaPriceInputZkProgramVkHash } = args;
  class ZkUsdEngineUpgrade
    extends TokenContract
    implements FungibleTokenAdminBase
  {
    @state(Field) oracleWhitelistHash = State<Field>(); // Posieden hash of the oracle whitelist
    @state(UInt32) validPriceBlockCount = State<UInt32>(); // Valid price block count
    @state(Field) hashedSecret = State<Field>(); // Posieden hash of the secret
    @state(Bool) emergencyStop = State<Bool>(); // Emergency stop
    @state(Bool) interactionFlag = State<Bool>(); // Flag to ensure token interaction is only done through the engine

    static ZKUSD_TOKEN_ADDRESS = zkUsdTokenAddress; // The address of the zkUSD token contract
    static MINIMUM_VALID_ORACLE_SUBMISSIONS: UInt32 = UInt32.from(3); // The minimum number of valid oracle submissions required to update the price

    static FungibleToken = FungibleTokenContract(ZkUsdEngineUpgrade);

    readonly events = {
      EmergencyStopToggled: EmergencyStopToggledEvent,
      AdminUpdated: AdminUpdatedEvent,
      OracleWhitelistUpdated: OracleWhitelistUpdatedEvent,
      ValidPriceBlockCountUpdated: ValidPriceBlockCountUpdatedEvent,
      VaultOwnerUpdated: VaultOwnerUpdatedEvent,
      NewVault: NewVaultEvent,
      DepositCollateral: DepositCollateralEvent,
      RedeemCollateral: RedeemCollateralEvent,
      MintZkUsd: MintZkUsdEvent,
      BurnZkUsd: BurnZkUsdEvent,
      Liquidate: LiquidateEvent,
    };

    //Blocks the updating of state of the token accounts
    approveBase(forest: AccountUpdateForest): Promise<void> {
      throw Error(ZkUsdEngineErrors.UPDATES_BLOCKED);
    }

    /**
     * @notice  Initializes the upgraded engine contract
     *
     */
    @method async initialize(
      secret: Field,
      oracleWhitelist: OracleWhitelist,
      validPriceBlockCount: UInt32
    ) {
      //We now need to reset the state of the engine
      //Set the secret hash
      this.hashedSecret.set(Poseidon.hash([secret]));

      //Set the oracle whitelist hash
      this.oracleWhitelistHash.set(OracleWhitelist.hash(oracleWhitelist));

      //Set the valid price block count
      this.validPriceBlockCount.set(validPriceBlockCount);

      //Set the emergency stop
      this.emergencyStop.set(Bool(false));

      //Set the interaction flag
      this.interactionFlag.set(Bool(false));
    }

    /**
     * @notice  Returns the total amount of collateral deposited into the engine
     * @returns The total amount of collateral deposited into the engine
     */
    public async getTotalDepositedCollateral(): Promise<UInt64> {
      const account = AccountUpdate.create(
        this.address,
        this.deriveTokenId()
      ).account;
      const balance = account.balance.getAndRequireEquals();
      return balance;
    }

    public async getVaultParams(): Promise<VaultParams> {
      // return vault params from protocol data
      return {
        collateralRatio: COLLATERAL_RATIO,
        liquidationBonusRatio: LIQUIDATION_BONUS_RATIO,
      };
    }

    public async retrieveVault(vaultAddress: PublicKey) {
      const vaultUpdate =
        AccountUpdate.create(
          vaultAddress,
          this.deriveTokenId()
        );
      return Vault(await this.getVaultParams()).getAndRequireEquals(vaultUpdate);
    }

    /**
     * @notice  Returns the health factor of a vault
     * @param   vaultAddress The address of the vault
     * @returns The health factor of the vault
     */
    public async getVaultHealthFactor(
      vaultAddress: PublicKey,
      minaPrice: MinaPrice
    ): Promise<UInt64> {
      const vault = await this.retrieveVault(vaultAddress);

      //Return the health factor
      return vault.getHealthFactor(minaPrice);
    }

    /**
     * @notice  Ensures the protocol is not stopped
     */
    async ensureProtocolNotStopped() {
      this.emergencyStop
        .getAndRequireEquals()
        .assertFalse(ZkUsdEngineErrors.EMERGENCY_HALT);
    }

    /**
     * @notice  Internal helper to validate the hashed secret
     * @param   secret The secret to validate
     */
    async ensureHashedSecret(secret: Field) {
      const providedHashedSecret = Poseidon.hash([secret]);
      providedHashedSecret.assertEquals(
        this.hashedSecret.getAndRequireEquals()
      );
    }

    /**
     * @notice  Verifies the Mina price input proof against contract data.
     * @param   minaPriceInput The Mina price input proof
     * @returns The verified Mina price. If the proof is invalid, this function will throw an error.
     */
    verifyMinaPriceInput(
      minaPriceInput: MinaPriceInput
    ): PriceAggregationProofPublicOutput {
      const validPriceBlockCount =
        this.validPriceBlockCount.getAndRequireEquals();

      const firstValidBlock =
        minaPriceInput.proof.publicOutput.minaPrice.currentBlockHeight;
      const lastValidBlock = firstValidBlock.add(validPriceBlockCount);

      this.network.blockchainLength.requireBetween(
        firstValidBlock,
        lastValidBlock
      );

      verifyMinaPriceInputProof({
        input: minaPriceInput,
        oracleWhitelistHash: this.oracleWhitelistHash.getAndRequireEquals(),
        proofVkHash: minaPriceInputZkProgramVkHash,
        currentBlockHeight: firstValidBlock,
      });

      minaPriceInput.proof.publicOutput.validSubmissions.count.assertGreaterThanOrEqual(
        ZkUsdEngineUpgrade.MINIMUM_VALID_ORACLE_SUBMISSIONS
      );

      return minaPriceInput.proof.publicOutput;
    }

    /**
     * @notice  Updates the owner of a vault
     * @param   vaultAddress The address of the vault to update the owner of
     * @param   newOwner The new owner of the vault
     */
    @method async updateVaultOwner(
      vaultAddress: PublicKey,
      newOwner: PublicKey
    ) {
      //Get signature from the current owner
      const owner = this.sender.getAndRequireSignature();

      const vault = await this.retrieveVault(vaultAddress);

      //Update the owner
      const newVaultState = vault.updateOwner(newOwner, owner);

      //Get the zkUSD token contract
      const zkUSD = new ZkUsdEngineUpgrade.FungibleToken(
        ZkUsdEngineUpgrade.ZKUSD_TOKEN_ADDRESS
      );

      //We create an account for the owner on the zkUSD token contract (if they don't already have one)
      await zkUSD.getBalanceOf(newOwner);

      //Emit the VaultOwnerUpdated event
      this.emitEvent(
        'VaultOwnerUpdated',
        new VaultOwnerUpdatedEvent({
          vaultAddress: vaultAddress,
          previousOwner: owner,
          newOwner: newOwner,
        })
      );
    }

    /**
     * @notice  Creates a new vault
     * @dev     The vault is deployed manually on the token account of the engine contract, this way
     *          we can ensure that updates to the vaults only happen through interaction with
     *          the engine contract. This pattern also allows the engine to be the admin account for the
     *          zkUSD token contract, which reduces the number of account updates when users take actions
     *          against their vaults
     * @param   vaultAddress The address of the vault to create
     */
    @method async createVault(vaultAddress: PublicKey) {
      //The sender is the owner of the vault
      const owner = this.sender.getAndRequireSignature();

      //Get the zkUSD token contract
      const zkUSD = new ZkUsdEngineUpgrade.FungibleToken(
        ZkUsdEngineUpgrade.ZKUSD_TOKEN_ADDRESS
      );

      //We create an account for the owner on the zkUSD token contract (if they don't already have one)
      await zkUSD.getBalanceOf(owner);

      //Create the new vault on the token account of the engine
      const newVaultUpdate = AccountUpdate.createSigned(
        vaultAddress,
        this.deriveTokenId()
      );

      const params = await this.getVaultParams();
      Vault(params).initialize(newVaultUpdate, owner);

      //Emit the NewVault event
      this.emitEvent(
        'NewVault',
        new NewVaultEvent({
          vaultAddress: vaultAddress,
          owner: owner,
        })
      );
    }

    /**
     * @notice  Deposits collateral into a vault
     * @notice  The actual collateral is held by the engine contract, we are using the vault to track
     *          the state of each debt position
     * @param   vaultAddress The address of the vault to deposit collateral to
     * @param   amount The amount of collateral to deposit
     */
    @method async depositCollateral(vaultAddress: PublicKey, amount: UInt64) {
      //Get the vault
      const vault = await this.retrieveVault(vaultAddress);

      //Create the account update for the collateral deposit
      const collateralDeposit = AccountUpdate.createSigned(
        this.sender.getUnconstrained()
      );

      //Send the collateral to the engine contract
      collateralDeposit.send({
        to: this.address,
        amount: amount,
      });

      //Get the owner of the collateral deposit, as we already have a signature from them
      const owner = collateralDeposit.publicKey;

      //Deposit the collateral into the vault
      const newVaultState = vault.depositCollateral(amount, owner);

      //Update the total deposited collateral
      const totalDepositedCollateral = AccountUpdate.create(
        this.address,
        this.deriveTokenId()
      );
      totalDepositedCollateral.balanceChange = Int64.fromUnsigned(amount);

      //Emit the DepositCollateral event
      this.emitEvent(
        'DepositCollateral',
        new DepositCollateralEvent({
          vaultAddress: vaultAddress,
          amountDeposited: amount,
          vaultCollateralAmount: newVaultState.collateralAmount,
          vaultDebtAmount: newVaultState.debtAmount,
        })
      );
    }

    /**
     * @notice  Redeems collateral from a vault
     * @param   vaultAddress The address of the vault to redeem collateral from
     * @param   amount The amount of collateral to redeem
     */
    @method async redeemCollateral(
      vaultAddress: PublicKey,
      amount: UInt64,
      minaPriceInput: MinaPriceInput
    ) {
      //Ensure the protocol is not stopped
      await this.ensureProtocolNotStopped();

      //Get the vault
      const vault = await this.retrieveVault(vaultAddress);

      //Get the owner of the collateral
      const owner = this.sender.getAndRequireSignature();

      // verify the price input
      const { minaPrice } = this.verifyMinaPriceInput(minaPriceInput);

      //Redeem the collateral
      const { collateralAmount, debtAmount } = vault.redeemCollateral(
        amount,
        owner,
        minaPrice
      );

      //Send the collateral back to the sender
      this.send({
        to: owner,
        amount: amount,
      });

      //Update the total deposited collateral
      const totalDepositedCollateral = AccountUpdate.create(
        this.address,
        this.deriveTokenId()
      );
      totalDepositedCollateral.balanceChange = Int64.fromUnsigned(amount).neg();

      //Emit the RedeemCollateral event
      this.emitEvent(
        'RedeemCollateral',
        new RedeemCollateralEvent({
          vaultAddress: vaultAddress,
          amountRedeemed: amount,
          vaultCollateralAmount: collateralAmount,
          vaultDebtAmount: debtAmount,
          minaPrice: minaPrice.priceNanoUSD,
        })
      );
    }

    /**
     * @notice  Mints zkUSD for a vault
     * @param   vaultAddress The address of the vault to mint zkUSD for
     * @param   amount The amount of zkUSD to mint
     * @param   minaPriceInput The mina price input
     */
    @method async mintZkUsd(
      vaultAddress: PublicKey,
      amount: UInt64,
      minaPriceInput: MinaPriceInput
    ) {
      //Ensure the protocol is not stopped
      await this.ensureProtocolNotStopped();

      const vault = await this.retrieveVault(vaultAddress);

      //Get the zkUSD token contract
      const zkUSD = new ZkUsdEngineUpgrade.FungibleToken(
        ZkUsdEngineUpgrade.ZKUSD_TOKEN_ADDRESS
      );

      //Get the owner of the zkUSD
      const owner = this.sender.getAndRequireSignature();

      // verify the price input
      const { minaPrice } = this.verifyMinaPriceInput(minaPriceInput);

      //Manage the debt in the vault
      const { collateralAmount, debtAmount } = vault.mintZkUsd(
        amount,
        owner,
        minaPrice
      );

      //Mint the zkUSD for the recipient
      await zkUSD.mint(owner, amount);

      //Set the interaction flag to true
      this.interactionFlag.set(Bool(true));

      //Emit the MintZkUsd event
      this.emitEvent(
        'MintZkUsd',
        new MintZkUsdEvent({
          vaultAddress: vaultAddress,
          amountMinted: amount,
          vaultCollateralAmount: collateralAmount,
          vaultDebtAmount: debtAmount,
          minaPrice: minaPrice.priceNanoUSD,
        })
      );
    }

    /**
     * @notice  Burns zkUSD from a vault
     * @param   vaultAddress The address of the vault to burn zkUSD from
     * @param   amount The amount of zkUSD to burn
     */
    @method async burnZkUsd(vaultAddress: PublicKey, amount: UInt64) {
      //Get the vault
      const vault = await this.retrieveVault(vaultAddress);

      //Get the owner of the zkUSD
      // we have sender signature from zkUSD.burn
      // TODO verify
      const owner = this.sender.getUnconstrained();

      //Get the zkUSD token contract
      const zkUSD = new ZkUsdEngineUpgrade.FungibleToken(
        ZkUsdEngineUpgrade.ZKUSD_TOKEN_ADDRESS
      );

      //Manage the debt in the vault
      const { collateralAmount, debtAmount } = vault.burnZkUsd(amount, owner);

      //Burn the zkUSD from the sender
      await zkUSD.burn(owner, amount);

      //Emit the BurnZkUsd event
      this.emitEvent(
        'BurnZkUsd',
        new BurnZkUsdEvent({
          vaultAddress: vaultAddress,
          amountBurned: amount,
          vaultCollateralAmount: collateralAmount,
          vaultDebtAmount: debtAmount,
        })
      );
    }

    /**
     * @notice  Liquidates a vault as long as the health factor is below 100
     *          The liquidator receives the collateral in value of the repaid debt
     *          plus a bonus. The rest is sent to the vault owner.
     * @param   vaultAddress The address of the vault to liquidate
     */
    @method async liquidate(
      vaultAddress: PublicKey,
      minaPriceInput: MinaPriceInput
    ) {
      //Ensure the protocol is not stopped
      await this.ensureProtocolNotStopped();

      // //Get the vault
      const vault = await this.retrieveVault(vaultAddress);

      // //Get the zkUSD token contract
      const zkUSD = new ZkUsdEngineUpgrade.FungibleToken(
        ZkUsdEngineUpgrade.ZKUSD_TOKEN_ADDRESS
      );

      // Get the liquidator
      // NOTE. we have sender signature from zkUSD.burn
      //       so we can use unconstrained
      const liquidator = this.sender.getUnconstrained();

      // verify the price input
      const { minaPrice } = this.verifyMinaPriceInput(minaPriceInput);

      const { oldVaultState, liquidatorCollateral, vaultOwnerCollateral } =
        vault.liquidate(minaPrice);

      oldVaultState.collateralAmount.assertEquals(
        liquidatorCollateral.add(vaultOwnerCollateral)
      );

      //Burn the debt from the liquidator
      await zkUSD.burn(liquidator, oldVaultState.debtAmount);

      //Send the collateral to the liquidator
      this.send({
        to: liquidator,
        amount: liquidatorCollateral,
      });

      //Send the collateral to the vault owner
      this.send({
        to: oldVaultState.owner,
        amount: vaultOwnerCollateral,
      });

      //Update the total deposited collateral
      const totalDepositedCollateral = AccountUpdate.create(
        this.address,
        this.deriveTokenId()
      );
      totalDepositedCollateral.balanceChange = Int64.fromUnsigned(
        oldVaultState.collateralAmount
      ).neg();

      //Emit the Liquidate event
      this.emitEvent(
        'Liquidate',
        new LiquidateEvent({
          vaultAddress,
          liquidator: this.sender.getUnconstrained(),
          vaultCollateralLiquidated: oldVaultState.collateralAmount,
          vaultDebtRepaid: oldVaultState.debtAmount,
          minaPrice: minaPrice.priceNanoUSD,
        })
      );
    }

    /**
     * @notice  Toggles the emergency stop state of the protocol
     * @dev     Can only be called by authorized addresses via protocol vault
     * @param   shouldStop True to stop the protocol, false to resume
     */
    @method async toggleEmergencyStop(shouldStop: Bool, secret: Field) {
      const emergencyStop = this.emergencyStop.getAndRequireEquals();

      //Assertions
      shouldStop
        .equals(emergencyStop)
        .assertFalse('Protocol is already in desired state');

      //Do we have the right permissions to toggle the protocol?
      await this.ensureHashedSecret(secret);

      //Toggle the protocol state
      this.emergencyStop.set(shouldStop);

      //Emit the Liquidate event
      this.emitEvent(
        'EmergencyStopToggled',
        new EmergencyStopToggledEvent({
          resolutionIndex: NO_RESOLUTION_INDEX,
          emergencyStop: shouldStop,
        })
      );
    }

    /**
     * @notice  Updates the oracle whitelist merkle root
     * @param   whitelist The new oracle whitelist merkle root
     */
    @method async updateOracleWhitelist(
      whitelist: OracleWhitelist,
      secret: Field
    ) {
      //Precondition
      const previousHash = this.oracleWhitelistHash.getAndRequireEquals();

      //Ensure admin signature
      await this.ensureHashedSecret(secret);

      this.oracleWhitelistHash.set(OracleWhitelist.hash(whitelist));

      this.emitEvent('OracleWhitelistUpdated', {
        previousHash,
        newHash: OracleWhitelist.hash(whitelist),
      });
    }

    async getValidPriceBlockCount() {
      const validPriceBlockCount =
        this.validPriceBlockCount.getAndRequireEquals();
      return validPriceBlockCount;
    }

    /**
     * @notice  Updates the valid price block count
     * @param   count The new valid price block count
     */
    @method async updateValidPriceBlockCount(count: UInt32, secret: Field) {
      //Precondition
      const validPriceBlockCount =
        this.validPriceBlockCount.getAndRequireEquals();

      const previousCount = validPriceBlockCount;
      //Ensure admin signature
      await this.ensureHashedSecret(secret);

      this.validPriceBlockCount.set(count);

      this.emitEvent('ValidPriceBlockCountUpdated', {
        previousCount: previousCount,
        newCount: count,
      });
    }

    /**
     * @notice  This method is used to assert the interaction flag, this is used to ensure that the zkUSD token contract knows it is being called from the vault
     * @returns True if the flag is set
     */
    assertInteractionFlag() {
      this.interactionFlag.requireEquals(Bool(true));
      this.interactionFlag.set(Bool(false));
      return Bool(true);
    }

    //   FUNGIBLE TOKEN ADMIN FUNCTIONS

    /**
     * @notice  Returns true if the account update is valid
     * @param   accountUpdate The account update
     * @returns True if the account update is valid
     */
    @method.returns(Bool)
    public async canMint(_accountUpdate: AccountUpdate) {
      return this.assertInteractionFlag();
    }

    /**
     * @notice  Returns true if the admin can change the admin
     * @param   admin The admin
     * @returns True if the admin can change the admin
     */
    @method.returns(Bool)
    public async canChangeAdmin(_admin: PublicKey) {
      //We need the admin signature to change the admin

      return Bool(false);
    }

    /**
     * @notice  Returns true if the admin can pause the token
     * @returns True if the admin can pause the token
     */
    @method.returns(Bool)
    public async canPause(): Promise<Bool> {
      //We need the admin signature to pause the token, we will only do this in case of upgrades
      return Bool(false);
    }

    /**
     * @notice  Returns true if the admin can resume the token
     * @returns True if the admin can resume the token
     */
    @method.returns(Bool)
    public async canResume(): Promise<Bool> {
      //We need the admin signature to resume the token
      return Bool(false);
    }

    @method.returns(Bool)
    public async canChangeVerificationKey(vk: VerificationKey): Promise<Bool> {
      //We need the admin signature to change the verification key
      return Bool(false);
    }
  }

  return ZkUsdEngineUpgrade;
}
