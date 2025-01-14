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
  VerificationKey,
  Poseidon,
  TokenContract,
  AccountUpdateForest,
  Int64,
} from 'o1js';
import { ZkUsdVault } from './zkusd-vault.js';

import {
  OracleWhitelist,
  ProtocolDataPacked,
  ProtocolData,
  VaultState,
  MinaPrice
} from '../types.js';
import {
  MinaPriceUpdateEvent,
  FallbackMinaPriceUpdateEvent,
  OracleFundsDepositedEvent,
  MinaPriceSubmissionEvent,
  EmergencyStopToggledEvent,
  AdminUpdatedEvent,
  VerificationKeyUpdatedEvent,
  OracleWhitelistUpdatedEvent,
  OracleFeeUpdated,
  NewVaultEvent,
  DepositCollateralEvent,
  RedeemCollateralEvent,
  MintZkUsdEvent,
  BurnZkUsdEvent,
  LiquidateEvent,
  VaultOwnerUpdatedEvent,
} from '../events.js';
import { MinaPriceInput, MinaPriceProofPublicOutput, verifyMinaPriceInput as verifyMinaPriceInputProof } from '../proofs/mina-price-proof.js';

/**
 * @title   zkUSD Engine contract
 * @notice  This contract is the master contract used to govern the rules of interaction with the zkUSD system.
 *          It uses a token account design model which installs user vaults on the token account of the engine. This
 *          allows the engine to be the admin of the zkUSD token contract, while also managing the price state, interaction with the vaults,
 *          and administrative functionality such as the oracle whitelist.
 */

// Errors
export const ZkUsdEngineErrors = {
  UPDATES_BLOCKED:
    'Updates to the engine accounts can only be made by the engine',
  VAULT_EXISTS: 'Vault already exists',
  SENDER_NOT_WHITELISTED: 'Sender not in the whitelist',
  INVALID_WHITELIST: 'Invalid whitelist',
  PENDING_ACTION_EXISTS: 'Address already has a pending action',
  EMERGENCY_HALT:
    'Oracle is in emergency mode - all protocol actions are suspended',
  AMOUNT_ZERO: 'Amount must be greater than zero',
  INVALID_FEE:
    'Protocol fee is a percentage and must be less than or equal to 100',
  INSUFFICIENT_BALANCE: 'Insufficient balance for withdrawal',
};

export interface ZkUsdEngineDeployProps extends Exclude<DeployArgs, undefined> {
  initialPrice: UInt64;
  admin: PublicKey;
  oracleFlatFee: UInt64;
  emergencyStop: Bool;
  vaultVerificationKeyHash: Field;
}

export function ZkUsdEngineContract(
  args:{
  oracleFundTrackerAddress: PublicKey,
  zkUsdTokenAddress: PublicKey,
  minaPriceInputZkProgramVkHash: Field
  }
) {
  const { oracleFundTrackerAddress, zkUsdTokenAddress, minaPriceInputZkProgramVkHash} = args;
  class ZkUsdEngine extends TokenContract implements FungibleTokenAdminBase {
    @state(Field) oracleWhitelistRoot = State<Field>(); // Merkle root of the oracle whitelist
    @state(ProtocolDataPacked) protocolDataPacked = State<ProtocolDataPacked>();
    @state(Field) vaultVerificationKeyHash = State<Field>(); // Hash of the vault verification key
    @state(Bool) interactionFlag = State<Bool>(); // Flag to prevent reentrancy

    static FungibleToken = FungibleTokenContract(ZkUsdEngine);

    readonly events = {
      MinaPriceUpdate: MinaPriceUpdateEvent,
      FallbackMinaPriceUpdate: FallbackMinaPriceUpdateEvent,
      OracleFundsDeposited: OracleFundsDepositedEvent,
      MinaPriceSubmission: MinaPriceSubmissionEvent,
      EmergencyStopToggled: EmergencyStopToggledEvent,
      AdminUpdated: AdminUpdatedEvent,
      VerificationKeyUpdated: VerificationKeyUpdatedEvent,
      OracleWhitelistUpdated: OracleWhitelistUpdatedEvent,
      OracleFeeUpdated: OracleFeeUpdated,
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
        setVerificationKey:
          Permissions.VerificationKey.impossibleDuringCurrentVersion(),
        setPermissions: Permissions.impossible(),
        editState: Permissions.proof(),
        send: Permissions.proof(),
      });

      this.oracleWhitelistRoot.set(Field.from(0));

      this.protocolDataPacked.set(
        ProtocolData.new({
          admin: args.admin,
          oracleFlatFee: args.oracleFlatFee,
          emergencyStop: args.emergencyStop,
        }).pack()
      );

      this.vaultVerificationKeyHash.set(args.vaultVerificationKeyHash);
    }

    //Blocks the updating of state of the token accounts
    approveBase(forest: AccountUpdateForest): Promise<void> {
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
     * @notice  Returns the total amount of funds available to the oracle
     * @returns The total amount of funds available to the oracle
     */
    public async getAvailableOracleFunds(): Promise<UInt64> {
      const account = AccountUpdate.create(
        oracleFundTrackerAddress,
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
      //Get the vault
      const vault = new ZkUsdVault(vaultAddress, this.deriveTokenId());

      //Return the health factor
      return vault.getHealthFactor(minaPrice);
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
      const vault = new ZkUsdVault(vaultAddress, this.deriveTokenId());

      //Update the owner
      await vault.updateOwner(newOwner, owner);

      //Get the zkUSD token contract
      const zkUSD = new ZkUsdEngine.FungibleToken(zkUsdTokenAddress);

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
      //Preconditions
      const vaultVerificationKeyHash =
        this.vaultVerificationKeyHash.getAndRequireEquals();

      //The sender is the owner of the vault
      const owner = this.sender.getAndRequireSignature();

      //Get the zkUSD token contract
      const zkUSD = new ZkUsdEngine.FungibleToken(zkUsdTokenAddress);

      //We create an account for the owner on the zkUSD token contract (if they don't already have one)
      await zkUSD.getBalanceOf(owner);

      //Create the new vault on the token account of the engine
      const vault = AccountUpdate.createSigned(
        vaultAddress,
        this.deriveTokenId()
      );

      //Prevents memo and fee changes
      vault.body.useFullCommitment = Bool(true);

      //Ensures that the vault does not already exist
      vault.account.isNew
        .getAndRequireEquals()
        .assertTrue(ZkUsdEngineErrors.VAULT_EXISTS);

      //Get the verification key for the vault
      const vaultVerificationKey = new VerificationKey(
        ZkUsdVault._verificationKey!
      );

      //Ensure that the verification key is the correct one for the vault
      vaultVerificationKey.hash.assertEquals(vaultVerificationKeyHash);

      //Set the verification key for the vault
      vault.body.update.verificationKey = {
        isSome: Bool(true),
        value: vaultVerificationKey,
      };

      //Set the permissions for the vault
      vault.body.update.permissions = {
        isSome: Bool(true),
        value: {
          ...Permissions.default(),
          send: Permissions.proof(),
          // IMPORTANT: We need to think about upgradability here
          setVerificationKey:
            Permissions.VerificationKey.impossibleDuringCurrentVersion(),
          setPermissions: Permissions.impossible(),
          access: Permissions.proof(), //Should this be none or proof?
          setZkappUri: Permissions.none(),
          setTokenSymbol: Permissions.none(),
        },
      };

      //Set the initial state for the vault
      const initialVaultState = new VaultState({
        collateralAmount: UInt64.zero,
        debtAmount: UInt64.zero,
        owner: owner,
      });

      // Convert vault state to fields
      const vaultStateFields = VaultState.toFields(initialVaultState);

      // Create an array of all 8 app state updates, setting unused fields to Field(0)
      const appStateUpdates = Array(8).fill({
        isSome: Bool(true),
        value: Field(0),
      });

      // Update only the fields we need
      vaultStateFields.forEach((field, index) => {
        appStateUpdates[index] = {
          isSome: Bool(true),
          value: field,
        };
      });

      //Set the app state for the vault
      vault.body.update.appState = appStateUpdates;

      //Emit the NewVault event
      this.emitEvent(
        'NewVault',
        new NewVaultEvent({
          vaultAddress: vaultAddress,
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
      const vault = new ZkUsdVault(vaultAddress, this.deriveTokenId());

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
      const { collateralAmount, debtAmount } = await vault.depositCollateral(
        amount,
        owner
      );

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
          vaultCollateralAmount: collateralAmount,
          vaultDebtAmount: debtAmount,
        })
      );
    }

    /**
     * @notice  Verifies the Mina price input proof against contract data.
     * @param   minaPriceInput The Mina price input proof
      * @returns The verified Mina price. If the proof is invalid, this function will throw an error.
     */
    verifyMinaPriceInput(minaPriceInput: MinaPriceInput): MinaPriceProofPublicOutput {
      const firstValidBlockHeight = this.network.blockchainLength.get()
      // TODO how to constrain?

      const lastValidBlockHeight = firstValidBlockHeight.add(1);
      // Verify the sender is in the whitelist
      verifyMinaPriceInputProof({
        input: minaPriceInput,
        oracleWhitelistRoot: this.oracleWhitelistRoot.getAndRequireEquals(),
        proofVkHash: minaPriceInputZkProgramVkHash,
        firstValidBlockHeight,
        lastValidBlockHeight,
      });
      return minaPriceInput.proof.publicOutput;
    }

    // TODO
    incentivizeOracle(oracle: PublicKey) {
      const fee = this.getOracleFee();
    }

    /**
     * @notice  Redeems collateral from a vault
     * @param   vaultAddress The address of the vault to redeem collateral from
     * @param   amount The amount of collateral to redeem
     */
    @method async redeemCollateral(vaultAddress: PublicKey, amount: UInt64, minaPriceInput: MinaPriceInput) {
      //Get the vault
      const vault = new ZkUsdVault(vaultAddress, this.deriveTokenId());

      //Get the owner of the collateral
      const owner = this.sender.getAndRequireSignature();

      // verify the price input
      const {minaPrice, incentivizedOracle} = this.verifyMinaPriceInput(minaPriceInput);

      // incentivize the oracle that provided the valid price
      this.incentivizeOracle(incentivizedOracle);

      //Redeem the collateral
      const { collateralAmount, debtAmount } = await vault.redeemCollateral(
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
     */
    @method async mintZkUsd(vaultAddress: PublicKey, amount: UInt64, minaPriceInput: MinaPriceInput) {
      //Get the vault
      const vault = new ZkUsdVault(vaultAddress, this.deriveTokenId());

      //Get the zkUSD token contract
      const zkUSD = new ZkUsdEngine.FungibleToken(zkUsdTokenAddress);

      //Get the owner of the zkUSD
      const owner = this.sender.getAndRequireSignature();

      // verify the price input
      const {minaPrice, incentivizedOracle} = this.verifyMinaPriceInput(minaPriceInput);

      // incentivize the oracle that provided the valid price
      this.incentivizeOracle(incentivizedOracle);

      //Manage the debt in the vault
      const { collateralAmount, debtAmount } = await vault.mintZkUsd(
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
      const vault = new ZkUsdVault(vaultAddress, this.deriveTokenId());

      //Get the owner of the zkUSD
      // we have sender signature from zkUSD.burn
      // TODO verify
      const owner = this.sender.getUnconstrained();

      //Get the zkUSD token contract
      const zkUSD = new ZkUsdEngine.FungibleToken(zkUsdTokenAddress);

      //Manage the debt in the vault
      const { collateralAmount, debtAmount } = await vault.burnZkUsd(
        amount,
        owner
      );

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
    @method async liquidate(vaultAddress: PublicKey, minaPriceInput: MinaPriceInput) {
      //Get the vault
      const vault = new ZkUsdVault(vaultAddress, this.deriveTokenId());

      //Get the zkUSD token contract
      const zkUSD = new ZkUsdEngine.FungibleToken(zkUsdTokenAddress);

      // Get the liquidator
      // NOTE. we have sender signature from zkUSD.burn
      //       so we can use unconstrained
      const liquidator = this.sender.getUnconstrained();

      // Get the vault owner
      const vaultOwner = vault.owner.getAndRequireEquals();

      // verify the price input
      const {minaPrice, incentivizedOracle} = this.verifyMinaPriceInput(minaPriceInput);

      // incentivize the oracle that provided the valid price
      this.incentivizeOracle(incentivizedOracle);

      const { oldVaultState, liquidatorCollateral, vaultOwnerCollateral } =
        await vault.liquidate(minaPrice);

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
        to: vaultOwner,
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

    /**
     * @notice  Updates the oracle whitelist merkle root
     * @param   whitelist The new oracle whitelist merkle root
     */
    @method async updateOracleWhitelist(whitelist: OracleWhitelist) {
      //Precondition
      const previousHash = this.oracleWhitelistRoot.getAndRequireEquals();

      //Ensure admin signature
      await this.ensureAdminSignature();

      const updatedWhitelistHash = Poseidon.hash(
        OracleWhitelist.toFields(whitelist)
      );
      this.oracleWhitelistRoot.set(updatedWhitelistHash);

      this.emitEvent('OracleWhitelistUpdated', {
        previousHash,
        newHash: updatedWhitelistHash,
      });
    }

    async getOracleFee(){
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );
      return protocolData.oracleFlatFee;
    }

    /**
     * @notice  Updates the oracle fee
     * @param   fee The new oracle fee
     */
    @method async updateOracleFee(fee: UInt64) {
      //Precondition
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );

      const previousFee = protocolData.oracleFlatFee;
      //Ensure admin signature
      await this.ensureAdminSignature();

      protocolData.oracleFlatFee = fee;
      this.protocolDataPacked.set(protocolData.pack());

      this.emitEvent('OracleFeeUpdated', {
        previousFee: previousFee,
        newFee: fee,
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
     * @notice  Deposits funds into the oracle account
     * @param   amount The amount of funds to deposit
     */
    @method async depositOracleFunds(amount: UInt64) {
      //We track the funds in the token account of the engine address
      const oracleFundsTrackerUpdate = AccountUpdate.create(
        oracleFundTrackerAddress,
        this.deriveTokenId()
      );

      oracleFundsTrackerUpdate.balanceChange = Int64.fromUnsigned(amount);

      //Create the account update for the deposit
      const depositUpdate = AccountUpdate.createSigned(
        this.sender.getUnconstrained()
      );

      depositUpdate.send({
        to: this.address,
        amount: amount,
      });

      this.emitEvent('OracleFundsDeposited', {
        amount: amount,
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
  }
  return ZkUsdEngine;
}
