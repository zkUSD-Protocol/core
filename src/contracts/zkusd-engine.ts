import {
  FungibleTokenAdminBase,
  FungibleTokenContract,
} from '@minatokens/token';
import {
  AccountUpdate,
  Bool,
  DeployArgs,
  Field,
  method,
  PublicKey,
  State,
  state,
  UInt64,
  Permissions,
  Poseidon,
  TokenContract,
  AccountUpdateForest,
  Int64,
  UInt32,
  VerificationKey,
} from 'o1js';

import { Vault } from '../system/vault.js';
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
} from '../system/events.js';
import {
  MinaPriceInput,
  verifyMinaPriceInput as verifyMinaPriceInputProof,
} from '../proofs/oracle-price-aggregation/verify.js';
import { PriceAggregationProofPublicOutput } from '../proofs/oracle-price-aggregation/common.js';
import {
  ProtocolData,
  ProtocolDataPacked,
  ZkUsdEngineErrors,
} from '../system/engine.js';
import { MinaPrice, OracleWhitelist } from '../system/oracle.js';

/**
 * @title   zkUSD Engine contract
 * @notice  This contract is the master contract used to govern the rules of interaction with the zkUSD system.
 *          It uses a token account design model which installs user vaults on the token account of the engine. This
 *          allows the engine to be the admin of the zkUSD token contract, while also managing the price state, interaction with the vaults,
 *          and administrative functionality such as the oracle whitelist.
 */

export interface ZkUsdEngineDeployProps extends Exclude<DeployArgs, undefined> {
  admin: PublicKey;
  validPriceBlockCount: UInt32;
  emergencyStop: Bool;
}

export function ZkUsdEngineContract(args: {
  zkUsdTokenAddress: PublicKey;
  minaPriceInputZkProgramVkHash: Field;
}) {
  const { zkUsdTokenAddress, minaPriceInputZkProgramVkHash } = args;
  class ZkUsdEngine extends TokenContract implements FungibleTokenAdminBase {
    @state(Field) oracleWhitelistHash = State<Field>(); // Posieden hash of the oracle whitelist
    @state(ProtocolDataPacked) protocolDataPacked = State<ProtocolDataPacked>(); // Protocol data
    @state(Bool) interactionFlag = State<Bool>(); // Flag to ensure token interaction is only done through the engine

    static ZKUSD_TOKEN_ADDRESS = zkUsdTokenAddress; // The address of the zkUSD token contract
    static MINIMUM_VALID_ORACLE_SUBMISSIONS: UInt32 = UInt32.from(3); // The minimum number of valid oracle submissions required to update the price

    static FungibleToken = FungibleTokenContract(ZkUsdEngine);

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

    /**
     * @notice  Deploys the oracle contract and sets initial state
     * @param   args.initialPrice We initialise the contract with a price
     */
    async deploy(args: ZkUsdEngineDeployProps) {
      await super.deploy(args);

      this.account.permissions.set({
        ...Permissions.default(),
        setPermissions: Permissions.impossible(),

        /**
         * Due to Mina's transaction versioning system, verification key permissions are automatically
         * reset to 'signature' during network upgrades (hardforks). This means that achieving complete
         * immutability for verification keys is currently not possible in the Mina protocol.
         *
         * Given this constraint, and our commitment to continuous protocol improvements, we explicitly
         * set the verification key permission to 'signature'. This allows us to upgrade the protocol's
         * proof system as needed and as we improve our decentralisation efforts.
         *
         * This design choice balances protocol upgradeability with security, acknowledging that
         * true immutability of verification keys is not achievable under Mina's current architecture.
         */
        setVerificationKey: Permissions.VerificationKey.signature(),

        editState: Permissions.proof(),
        send: Permissions.proof(),
      });

      this.oracleWhitelistHash.set(Field.from(0));

      this.protocolDataPacked.set(
        ProtocolData.new({
          admin: args.admin,
          validPriceBlockCount: args.validPriceBlockCount,
          emergencyStop: args.emergencyStop,
        }).pack()
      );
    }

    //Blocks the updating of state of the token accounts
    approveBase(_forest: AccountUpdateForest): Promise<void> {
      throw Error(ZkUsdEngineErrors.UPDATES_BLOCKED);
    }

    /**
     * @notice The initialize method is necessary for setting up the various helper token accounts
     *         that are used to track the state of the system.
     */
    @method async initialize() {
      //Ensure admin key
      await this.ensureAdminSignature();

      //Set the permissions to track the collateral deposits on the engine
      let au = AccountUpdate.createSigned(this.address, this.deriveTokenId());
      au.account.isNew.getAndRequireEquals().assertTrue();
      let permissions = Permissions.default();
      permissions.send = Permissions.none();
      permissions.setPermissions = Permissions.impossible();
      au.account.permissions.set(permissions);

      //Here we can set the editState permission to none because these permissions are set
      //on a token account which means all updates have to be approved by the engine
      permissions.editState = Permissions.none();
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

    /**
     * @notice  Returns the health factor of a vault
     * @param   vaultAddress The address of the vault
     * @returns The health factor of the vault
     */
    public async getVaultHealthFactor(
      vaultAddress: PublicKey,
      minaPrice: MinaPrice
    ): Promise<UInt64> {
      const vaultUpdate = AccountUpdate.create(
        vaultAddress,
        this.deriveTokenId()
      );

      //Get the vault
      const vault = Vault.getAndRequireEquals(vaultUpdate);

      //Return the health factor
      return vault.getHealthFactor(minaPrice);
    }

    /**
     * @notice  Ensures the protocol is not stopped
     */
    async ensureProtocolNotStopped() {
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );
      protocolData.emergencyStop.assertFalse(ZkUsdEngineErrors.EMERGENCY_HALT);
    }

    /**
     * @notice  Internal helper to validate admin signature
     * @returns The signed account update from the admin
     */
    async ensureAdminSignature(): Promise<AccountUpdate> {
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );
      return AccountUpdate.createSigned(protocolData.admin);
    }

    /**
     * @notice  Verifies the Mina price input proof against contract data.
     * @param   minaPriceInput The Mina price input proof
     * @returns The verified Mina price. If the proof is invalid, this function will throw an error.
     */
    verifyMinaPriceInput(
      minaPriceInput: MinaPriceInput
    ): PriceAggregationProofPublicOutput {
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );

      const firstValidBlock =
        minaPriceInput.proof.publicOutput.minaPrice.currentBlockHeight;
      const lastValidBlock = firstValidBlock.add(
        protocolData.validPriceBlockCount
      );

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
        ZkUsdEngine.MINIMUM_VALID_ORACLE_SUBMISSIONS
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

      //Get the vault
      const vaultUpdate = AccountUpdate.create(
        vaultAddress,
        this.deriveTokenId()
      );
      const vault = Vault.getAndRequireEquals(vaultUpdate);

      //Update the owner
      vault.updateOwner(newOwner, owner);

      //Get the zkUSD token contract
      const zkUSD = new ZkUsdEngine.FungibleToken(
        ZkUsdEngine.ZKUSD_TOKEN_ADDRESS
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
      const zkUSD = new ZkUsdEngine.FungibleToken(
        ZkUsdEngine.ZKUSD_TOKEN_ADDRESS
      );

      //We create an account for the owner on the zkUSD token contract (if they don't already have one)
      await zkUSD.getBalanceOf(owner);

      //Create the new vault on the token account of the engine
      const newVaultUpdate = AccountUpdate.createSigned(
        vaultAddress,
        this.deriveTokenId()
      );

      Vault.initialize(newVaultUpdate, owner);

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
      // const vault = new ZkUsdVault(vaultAddress, this.deriveTokenId());
      const vaultUpdate = AccountUpdate.create(
        vaultAddress,
        this.deriveTokenId()
      );

      const vault = Vault.getAndRequireEquals(vaultUpdate);

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
      const vaultUpdate = AccountUpdate.create(
        vaultAddress,
        this.deriveTokenId()
      );

      const vault = Vault.getAndRequireEquals(vaultUpdate);

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

      const vaultUpdate = AccountUpdate.create(
        vaultAddress,
        this.deriveTokenId()
      );

      const vault = Vault.getAndRequireEquals(vaultUpdate);

      //Get the zkUSD token contract
      const zkUSD = new ZkUsdEngine.FungibleToken(
        ZkUsdEngine.ZKUSD_TOKEN_ADDRESS
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
      const vaultUpdate = AccountUpdate.create(
        vaultAddress,
        this.deriveTokenId()
      );

      const vault = Vault.getAndRequireEquals(vaultUpdate);

      //Get the owner of the zkUSD
      // we have sender signature from zkUSD.burn
      // TODO verify
      const owner = this.sender.getUnconstrained();

      //Get the zkUSD token contract
      const zkUSD = new ZkUsdEngine.FungibleToken(
        ZkUsdEngine.ZKUSD_TOKEN_ADDRESS
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
      const vaultUpdate = AccountUpdate.create(
        vaultAddress,
        this.deriveTokenId()
      );
      const vault = Vault.getAndRequireEquals(vaultUpdate);

      // //Get the zkUSD token contract
      const zkUSD = new ZkUsdEngine.FungibleToken(
        ZkUsdEngine.ZKUSD_TOKEN_ADDRESS
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
    @method async toggleEmergencyStop(shouldStop: Bool) {
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );

      //Assertions
      shouldStop
        .equals(protocolData.emergencyStop)
        .assertFalse('Protocol is already in desired state');

      //Do we have the right permissions to toggle the protocol?
      await this.ensureAdminSignature();

      //Toggle the protocol state
      protocolData.emergencyStop = shouldStop;
      this.protocolDataPacked.set(protocolData.pack());

      //Emit the Liquidate event
      this.emitEvent(
        'EmergencyStopToggled',
        new EmergencyStopToggledEvent({
          emergencyStop: shouldStop,
        })
      );
    }

    @method.returns(Vault) // TODO does it have to be a methods
    async retrieveVault(vaultAddress: PublicKey) {
      const vaultUpdate = AccountUpdate.create(
        vaultAddress,
        this.deriveTokenId()
      );
      return Vault.getAndRequireEquals(vaultUpdate);
    }

    /**
     * @notice  Updates the oracle whitelist merkle root
     * @param   whitelist The new oracle whitelist merkle root
     */
    @method async updateOracleWhitelist(whitelist: OracleWhitelist) {
      //Precondition
      const previousHash = this.oracleWhitelistHash.getAndRequireEquals();

      //Ensure admin signature
      await this.ensureAdminSignature();

      const updatedWhitelistHash = Poseidon.hash(
        OracleWhitelist.toFields(whitelist)
      );
      this.oracleWhitelistHash.set(updatedWhitelistHash);

      this.emitEvent('OracleWhitelistUpdated', {
        previousHash,
        newHash: updatedWhitelistHash,
      });
    }

    async getValidPriceBlockCount() {
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );
      return protocolData.validPriceBlockCount;
    }

    /**
     * @notice  Updates the valid price block count
     * @param   count The new valid price block count
     */
    @method async updateValidPriceBlockCount(count: UInt32) {
      //Precondition
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );

      const previousCount = protocolData.validPriceBlockCount;
      //Ensure admin signature
      await this.ensureAdminSignature();

      protocolData.validPriceBlockCount = count;
      this.protocolDataPacked.set(protocolData.pack());

      this.emitEvent('ValidPriceBlockCountUpdated', {
        previousCount: previousCount,
        newCount: count,
      });
    }

    /**
     * @notice  Updates the admin public key
     * @param   newAdmin The new admin public key
     */
    @method async updateAdmin(newAdmin: PublicKey) {
      //Ensure admin signature
      await this.ensureAdminSignature();

      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );

      const previousAdmin = protocolData.admin;

      protocolData.admin = newAdmin;
      this.protocolDataPacked.set(protocolData.pack());

      this.emitEvent('AdminUpdated', {
        previousAdmin,
        newAdmin,
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
      await this.ensureAdminSignature();
      return Bool(true);
    }

    /**
     * @notice  Returns true if the admin can pause the token
     * @returns True if the admin can pause the token
     */
    @method.returns(Bool)
    public async canPause(): Promise<Bool> {
      //We need the admin signature to pause the token, we will only do this in case of upgrades
      await this.ensureAdminSignature();
      return Bool(true);
    }

    /**
     * @notice  Returns true if the admin can resume the token
     * @returns True if the admin can resume the token
     */
    @method.returns(Bool)
    public async canResume(): Promise<Bool> {
      //We need the admin signature to resume the token
      await this.ensureAdminSignature();
      return Bool(true);
    }

    /**
     * @notice  Returns true if the admin can change the verification key
     * @returns True if the admin can change the verification key
     */
    @method.returns(Bool)
    public async canChangeVerificationKey(_vk: VerificationKey): Promise<Bool> {
      return Bool(true); // TODO change it to read the permission instead
    }
  }

  return ZkUsdEngine;
}
