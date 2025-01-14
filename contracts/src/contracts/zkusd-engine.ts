import {
  FungibleTokenAdminBase,
  FungibleTokenContract,
  FungibleTokenAdmin,
  FungibleToken,
} from '@minatokens/token';
import {
  AccountUpdate,
  Bool,
  DeployArgs,
  Field,
  method,
  Provable,
  PublicKey,
  State,
  state,
  UInt32,
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
  PriceSubmission,
  PriceSubmissionPacked,
} from '../types.js';
import { ZkUsdMasterOracle } from './zkusd-master-oracle.js';
import { ZkUsdPriceTracker } from './zkusd-price-tracker.js';
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
  zkUsdTokenAddress: PublicKey,
  masterOracleAddress: PublicKey,
  evenOraclePriceTrackerAddress: PublicKey,
  oddOraclePriceTrackerAddress: PublicKey,
  vaultVerificationKey: VerificationKey
) {
  class ZkUsdEngine extends TokenContract implements FungibleTokenAdminBase {
    @state(UInt64) minaPriceEvenBlock = State<UInt64>();
    @state(UInt64) minaPriceOddBlock = State<UInt64>();
    @state(Field) oracleWhitelistHash = State<Field>(); // Hash of the oracle whitelist
    @state(ProtocolDataPacked) protocolDataPacked = State<ProtocolDataPacked>();
    @state(Field) vaultVerificationKeyHash = State<Field>(); // Hash of the vault verification key
    @state(Bool) interactionFlag = State<Bool>(); // Flag to ensure token interaction is only done through the engine

    static zkUsdTokenAddress = zkUsdTokenAddress;
    static masterOracleAddress = masterOracleAddress;
    static evenOraclePriceTrackerAddress = evenOraclePriceTrackerAddress;
    static oddOraclePriceTrackerAddress = oddOraclePriceTrackerAddress;
    static vaultVerificationKey = vaultVerificationKey;

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

      this.minaPriceEvenBlock.set(args.initialPrice);
      this.minaPriceOddBlock.set(args.initialPrice);

      this.oracleWhitelistHash.set(Field.from(0));

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

      // //Set up the master oracle to track the oracle funds and manage the fallback price
      const masterOracle = AccountUpdate.createSigned(
        ZkUsdEngine.masterOracleAddress,
        this.deriveTokenId()
      );
      masterOracle.body.useFullCommitment = Bool(true);
      masterOracle.account.isNew.getAndRequireEquals().assertTrue();

      //Get the verification key for the master oracle
      const masterOracleVerificationKey = new VerificationKey(
        ZkUsdMasterOracle._verificationKey!
      );

      masterOracle.body.update.verificationKey = {
        isSome: Bool(true),
        value: masterOracleVerificationKey,
      };

      masterOracle.body.update.appState[0].value = this.minaPriceEvenBlock
        .getAndRequireEquals()
        .toFields()[0];
      masterOracle.body.update.appState[0].isSome = Bool(true);
      masterOracle.body.update.appState[1].value = this.minaPriceOddBlock
        .getAndRequireEquals()
        .toFields()[0];
      masterOracle.body.update.appState[1].isSome = Bool(true);

      masterOracle.account.permissions.set(permissions);

      //Set up the oracle price trackers
      const evenOraclePriceTracker = AccountUpdate.createSigned(
        ZkUsdEngine.evenOraclePriceTrackerAddress,
        this.deriveTokenId()
      );

      const oddOraclePriceTracker = AccountUpdate.createSigned(
        ZkUsdEngine.oddOraclePriceTrackerAddress,
        this.deriveTokenId()
      );

      const priceTrackerVerificationKey = new VerificationKey(
        ZkUsdPriceTracker._verificationKey!
      );

      evenOraclePriceTracker.body.update.verificationKey = {
        isSome: Bool(true),
        value: priceTrackerVerificationKey,
      };

      oddOraclePriceTracker.body.update.verificationKey = {
        isSome: Bool(true),
        value: priceTrackerVerificationKey,
      };

      const blockchainLength = this.network.blockchainLength.get();

      //As the admin is initializing, we dont need to check the blockchain length
      this.network.blockchainLength.requireNothing();

      const evenPackedPriceSubmission = PriceSubmission.new(
        this.minaPriceEvenBlock.getAndRequireEquals(),
        UInt32.from(blockchainLength)
      ).pack();

      const oddPackedPriceSubmission = PriceSubmission.new(
        this.minaPriceOddBlock.getAndRequireEquals(),
        UInt32.from(blockchainLength)
      ).pack();

      for (let i = 0; i < OracleWhitelist.MAX_PARTICIPANTS; i++) {
        evenOraclePriceTracker.body.update.appState[i].value =
          evenPackedPriceSubmission.packedData;
        evenOraclePriceTracker.body.update.appState[i].isSome = Bool(true);
        oddOraclePriceTracker.body.update.appState[i].value =
          oddPackedPriceSubmission.packedData;
        oddOraclePriceTracker.body.update.appState[i].isSome = Bool(true);
      }

      evenOraclePriceTracker.account.isNew.getAndRequireEquals().assertTrue();
      oddOraclePriceTracker.account.isNew.getAndRequireEquals().assertTrue();

      evenOraclePriceTracker.account.permissions.set(permissions);
      oddOraclePriceTracker.account.permissions.set(permissions);
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
        ZkUsdEngine.masterOracleAddress,
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
      vaultAddress: PublicKey
    ): Promise<UInt64> {
      //Get the vault
      const vault = new ZkUsdVault(vaultAddress, this.deriveTokenId());

      //Get the price
      const minaPrice = await this.getMinaPrice();

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
      const zkUSD = new ZkUsdEngine.FungibleToken(
        ZkUsdEngine.zkUsdTokenAddress
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
      //Preconditions
      const vaultVerificationKeyHash =
        this.vaultVerificationKeyHash.getAndRequireEquals();

      //The sender is the owner of the vault
      const owner = this.sender.getAndRequireSignature();

      //Get the zkUSD token contract
      const zkUSD = new ZkUsdEngine.FungibleToken(
        ZkUsdEngine.zkUsdTokenAddress
      );

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

      //Ensure that the verification key is the correct one for the vault
      ZkUsdEngine.vaultVerificationKey.hash.assertEquals(
        vaultVerificationKeyHash
      );

      //Set the verification key for the vault
      vault.body.update.verificationKey = {
        isSome: Bool(true),
        value: ZkUsdEngine.vaultVerificationKey,
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
     * @notice  Redeems collateral from a vault
     * @param   vaultAddress The address of the vault to redeem collateral from
     * @param   amount The amount of collateral to redeem
     */
    @method async redeemCollateral(vaultAddress: PublicKey, amount: UInt64) {
      //Get the vault
      const vault = new ZkUsdVault(vaultAddress, this.deriveTokenId());

      //Get the price
      const minaPrice = await this.getMinaPrice();

      //Get the owner of the collateral
      const owner = this.sender.getAndRequireSignature();

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
          minaPrice,
        })
      );
    }

    /**
     * @notice  Mints zkUSD for a vault
     * @param   vaultAddress The address of the vault to mint zkUSD for
     * @param   amount The amount of zkUSD to mint
     */
    @method async mintZkUsd(vaultAddress: PublicKey, amount: UInt64) {
      //Get the vault
      const vault = new ZkUsdVault(vaultAddress, this.deriveTokenId());

      //Get the zkUSD token contract
      const zkUSD = new ZkUsdEngine.FungibleToken(
        ZkUsdEngine.zkUsdTokenAddress
      );

      //Get the price
      const minaPrice = await this.getMinaPrice();

      //Get the owner of the zkUSD
      const owner = this.sender.getAndRequireSignature();

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
          minaPrice,
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
      const zkUSD = new ZkUsdEngine.FungibleToken(
        ZkUsdEngine.zkUsdTokenAddress
      );

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
    @method async liquidate(vaultAddress: PublicKey) {
      //Get the vault
      const vault = new ZkUsdVault(vaultAddress, this.deriveTokenId());

      //Get the zkUSD token contract
      const zkUSD = new ZkUsdEngine.FungibleToken(
        ZkUsdEngine.zkUsdTokenAddress
      );

      // Get the liquidator
      // NOTE. we have sender signature from zkUSD.burn
      //       so we can use unconstrained
      const liquidator = this.sender.getUnconstrained();

      // Get the vault owner
      const vaultOwner = vault.owner.getAndRequireEquals();

      //Get the price
      const minaPrice = await this.getMinaPrice();

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
          minaPrice,
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
     * @notice  Updates the oracle whitelist hash
     * @param   whitelist The new oracle whitelist
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
        ZkUsdEngine.masterOracleAddress,
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
     * @notice  Updates the fallback price
     * @param   newMinaPrice The new fallback price
     */
    @method async updateFallbackPrice(newMinaPrice: UInt64) {
      //Ensure admin signature
      await this.ensureAdminSignature();

      const masterOracle = new ZkUsdMasterOracle(
        ZkUsdEngine.masterOracleAddress,
        this.deriveTokenId()
      );

      await masterOracle.updateFallbackPrice(newMinaPrice);

      this.emitEvent('FallbackMinaPriceUpdate', {
        newPrice: newMinaPrice,
      });
    }

    /**
     * @notice  Submits a new price update from an oracle as an action to be reduced
     * @notice  This oracle contract should always have funds from the protocol to pay the oracle fee
     *          However in the event that it doesn't, we should not fail the price submission
     *          We hope that the oracles will have enough good will to continue to submit prices
     *          until the contract is funded again
     * @param   minaPrice The new price of MINA in USD
     * @param   whitelist The whitelist of authorized oracles
     */
    @method async submitPrice(minaPrice: UInt64, whitelist: OracleWhitelist) {
      const { isOddBlock } = this.getBlockInfo();
      //We need to ensure the sender is the oracle in the whitelist
      const submitter = this.sender.getAndRequireSignature();
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );
      const blockchainLength =
        this.network.blockchainLength.getAndRequireEquals();

      //Get the current oracle fee
      const oracleFee = protocolData.oracleFlatFee;

      //Ensure price is greater than zero
      minaPrice
        .greaterThan(UInt64.zero)
        .assertTrue(ZkUsdEngineErrors.AMOUNT_ZERO);

      const oraclePriceTrackerAddress = Provable.if(
        isOddBlock,
        ZkUsdEngine.oddOraclePriceTrackerAddress,
        ZkUsdEngine.evenOraclePriceTrackerAddress
      );

      //Validate the sender is authorized to submit a price update
      await this.validateWhitelist(submitter, whitelist);

      for (let i = 0; i < whitelist.addresses.length; i++) {
        let isAtIndex: Bool = Provable.if(
          submitter.equals(whitelist.addresses[i]),
          Bool(true),
          Bool(false)
        );

        let minaPriceUpdate = AccountUpdate.createIf(
          isAtIndex,
          oraclePriceTrackerAddress,
          this.deriveTokenId()
        );

        const submission = PriceSubmission.new(
          minaPrice,
          blockchainLength
        ).pack();

        minaPriceUpdate.body.useFullCommitment = Bool(true);

        minaPriceUpdate.body.update.appState[i] = {
          isSome: Bool(true),
          value: PriceSubmissionPacked.toFields(submission)[0],
        };
      }

      const oracleFundsTracker = AccountUpdate.create(
        ZkUsdEngine.masterOracleAddress,
        this.deriveTokenId()
      );

      oracleFundsTracker.balanceChange = Int64.fromUnsigned(oracleFee).neg();

      //TRANSACTION FAILS IF WE DONT HAVE AVAILABLE ORACLE FUNDS

      // Pay the oracle fee for the price submission
      const receiverUpdate = AccountUpdate.create(submitter);

      receiverUpdate.balance.addInPlace(oracleFee);
      this.balance.subInPlace(oracleFee);

      // Add price submission event
      this.emitEvent(
        'MinaPriceSubmission',
        new MinaPriceSubmissionEvent({
          submitter: submitter,
          price: minaPrice,
          oracleFee: oracleFee,
        })
      );
    }

    /**
     * @notice  Settles pending price updates and calculates the median price
     * @dev     Updates the price based on the median of submitted prices.
     * @dev     It does this by maintaining an array of prices and a count of the number of prices submitted.
     *          It then reduces the array by replacing the fallback price with the submitted price if the index matches the count.
     *          It increments the count until it reaches the max number of participants, after which it will use the last submitted price in the array.
     *          We should never have more than 10 pending actions at one time.
     * @dev     The median price is calculated with the new state. If we have less than 3 submitted prices, we use the fallback price in the median calculation.
     */
    @method async settlePriceUpdate() {
      //Preconditions
      const { isOddBlock } = this.getBlockInfo();
      const currentPrices = this.getAndRequireCurrentMinaPrices();

      //Get the master oracle
      const masterOracle = new ZkUsdMasterOracle(
        ZkUsdEngine.masterOracleAddress,
        this.deriveTokenId()
      );

      //Get the fallback price
      const fallbackPrice = await masterOracle.getFallbackPrice();

      //If we are on the odd block, we get the median price from the even price tracker
      //Otherwise, we get the median price from the odd price tracker
      const priceTrackerAddress = Provable.if(
        isOddBlock,
        ZkUsdEngine.evenOraclePriceTrackerAddress,
        ZkUsdEngine.oddOraclePriceTrackerAddress
      );

      const priceTracker = new ZkUsdPriceTracker(
        priceTrackerAddress,
        this.deriveTokenId()
      );

      const medianPrice = await priceTracker.calculateMedianPrice(
        fallbackPrice
      );

      //Update the correct price based on the median price
      const { evenPrice, oddPrice } = this.updateBlockMinaPrices(
        isOddBlock,
        medianPrice,
        currentPrices
      );

      this.minaPriceEvenBlock.set(evenPrice);
      this.minaPriceOddBlock.set(oddPrice);

      // Add price update event
      this.emitEvent(
        'MinaPriceUpdate',
        new MinaPriceUpdateEvent({
          newPrice: medianPrice,
        })
      );
    }

    /**
     * @notice  Returns the current price
     * @notice  If the protcol is halted, this will fail, meaning that no actions can be taken from the vaults
     * @returns The MINA/USD price based on the current block
     */
    async getMinaPrice(): Promise<UInt64> {
      //Preconditions
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );
      const { isOddBlock } = this.getBlockInfo();

      //Ensure the protocol is not halted
      protocolData.emergencyStop.assertFalse(ZkUsdEngineErrors.EMERGENCY_HALT);

      //Get the current prices
      const prices = this.getCurrentMinaPrices();

      //Ensure the correct price is returned based on the current block
      this.minaPriceOddBlock.requireEqualsIf(isOddBlock, prices.odd);
      this.minaPriceEvenBlock.requireEqualsIf(isOddBlock.not(), prices.even);

      return Provable.if(isOddBlock, prices.odd, prices.even);
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

    /**
     * @notice  Returns the current block info to be used to set the isOddBlock flag
     * @returns The current block length and the isOddBlock flag
     */
    getBlockInfo(): { blockchainLength: UInt32; isOddBlock: Bool } {
      const blockchainLength =
        this.network.blockchainLength.getAndRequireEquals();
      const isOddBlock = blockchainLength.mod(2).equals(UInt32.from(1));
      return { blockchainLength, isOddBlock };
    }

    /**
     * @notice  Updates the price based on the current block, if we are on an odd block, we update the even price, otherwise we update the odd price
     * @param   isOddBlock The isOddBlock flag
     * @param   newMinaPrice The new price MINA/USD price
     * @param   currentPrices The current prices
     * @returns The updated prices
     */
    updateBlockMinaPrices(
      isOddBlock: Bool,
      newMinaPrice: UInt64,
      currentPrices: { even: UInt64; odd: UInt64 }
    ) {
      const evenPrice = Provable.if(
        isOddBlock,
        newMinaPrice,
        currentPrices.even
      );
      const oddPrice = Provable.if(
        isOddBlock.not(),
        newMinaPrice,
        currentPrices.odd
      );
      return { evenPrice, oddPrice };
    }

    /**
     * @notice  Helper function to return the current prices
     * @returns The current prices of MINA in USD
     */
    getCurrentMinaPrices(): { even: UInt64; odd: UInt64 } {
      return {
        even: this.minaPriceEvenBlock.get(),
        odd: this.minaPriceOddBlock.get(),
      };
    }

    /**
     * @notice  Helper function to return the current prices and set the preconditions
     * @returns The current prices of MINA in USD
     */
    getAndRequireCurrentMinaPrices(): { even: UInt64; odd: UInt64 } {
      return {
        even: this.minaPriceEvenBlock.getAndRequireEquals(),
        odd: this.minaPriceOddBlock.getAndRequireEquals(),
      };
    }

    /**
     * @notice  Validates the sender is in the whitelist. The whitelist hash is maintained in the protocol vault.
     * @param   submitter The sender
     * @param   whitelist The whitelist
     */
    async validateWhitelist(submitter: PublicKey, whitelist: OracleWhitelist) {
      //Gets the current whitelist hash from the protocol vault
      const whitelistHash = this.oracleWhitelistHash.getAndRequireEquals();

      //Ensure the whitelist hash matches the submitted whitelist
      whitelistHash.assertEquals(
        Poseidon.hash(OracleWhitelist.toFields(whitelist)),
        ZkUsdEngineErrors.INVALID_WHITELIST
      );

      //Check if the sender is in the whitelist
      let isWhitelisted = Bool(false);
      for (let i = 0; i < whitelist.addresses.length; i++) {
        isWhitelisted = isWhitelisted.or(
          submitter.equals(whitelist.addresses[i])
        );
      }

      isWhitelisted.assertTrue(ZkUsdEngineErrors.SENDER_NOT_WHITELISTED);
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
