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
  UInt8,
} from 'o1js';

import { Vault, VaultErrors, VaultParams } from '../system/vault.js';
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
  CollateralRatioUpdatedEvent,
  LiquidationBonusRatioUpdatedEvent,
  ConfigMerkleRootUpdatedEvent,
  VerificationKeyUpdatedEvent,
  VaultDebtCeilingUpdatedEvent,
  VaultCreationToggledEvent,
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
  ZkUsdEngineMethodCodes,
} from '../system/engine.js';
import { MinaPrice, OracleWhitelist } from '../system/oracle.js';
import {
  ZkUsdGovernmentConstructor,
} from '../system/governance.js';
import { ZkusdProtocolUpdateOperation } from '../system/update/operation.js';
import {
  ZkusdUpdateMinaBlockchainState,
  requireBlockchainPreconditions,
} from '../system/update/blockchain-state.js';
import { ZkusdUpdateProtocolState } from '../system/update/protocol-state.js';
import { ZkusdProtocolUpdateSpec } from '../system/update/input.js';
import { ResolutionTree } from '../system/council/resolution-tree.js';

/**
 * @title   zkUSD Engine contract
 * @notice  This contract is the master contract used to govern the rules of interaction with the zkUSD system.
 *          ItIpnsAddr uses a token account design model which installs user vaults on the token account of the engine. This
 *          allows the engine to be the admin of the zkUSD token contract, while also managing the price state, interaction with the vaults,
 *          and administrative functionality such as the oracle whitelist.
 */

export interface ZkUsdEngineDeployProps extends Exclude<DeployArgs, undefined> {
  admin: PublicKey;
  validPriceBlockCount: UInt8;
  emergencyStop: Bool;
  vaultCreationDisabled: Bool;
  collateralRatio: UInt8;
  liquidationBonusRatio: UInt8;
  vaultDebtCeiling: UInt64;
}
export const MinimalViableCollateralRatio: UInt8 = UInt8.from(115);
export const MinimalViablePriceValidity: UInt8 = UInt8.one;

export function ZkUsdEngineContract(args: {
  zkUsdTokenAddress: PublicKey;
  zkUsdGovernmentAddress: PublicKey;
  minaPriceInputZkProgramVkHash: Field;
  GovernmentClass: ZkUsdGovernmentConstructor;
}) {
  const { zkUsdTokenAddress, minaPriceInputZkProgramVkHash } = args;
  class ZkUsdEngine extends TokenContract implements FungibleTokenAdminBase {
    // -- on-chain data --
    @state(Field) oracleWhitelistHash = State<Field>(); // Poseidon hash of the oracle whitelist
    @state(ProtocolDataPacked) protocolDataPacked = State<ProtocolDataPacked>(); // Protocol data
    @state(Bool) interactionFlag = State<Bool>(); // Flag to ensure token interaction is only done through the engine

    // -- off-chain data --
    @state(Field) configMerkleRoot = State<Field>(); // Merkle root of the contract offchain state. (not used yet)

    // -- government data --

    static ZKUSD_TOKEN_ADDRESS = zkUsdTokenAddress; // The address of the zkUSD token contract
    static MINIMUM_VALID_ORACLE_SUBMISSIONS: UInt32 = UInt32.from(3); // The minimum number of valid oracle submissions required to update the price

    static FungibleToken = FungibleTokenContract(ZkUsdEngine);

    readonly events = {
      EmergencyStopToggled: EmergencyStopToggledEvent,
      AdminUpdated: AdminUpdatedEvent,
      OracleWhitelistUpdated: OracleWhitelistUpdatedEvent,
      ValidPriceBlockCountUpdated: ValidPriceBlockCountUpdatedEvent,
      VerificationKeyUpdated: VerificationKeyUpdatedEvent,
      VaultOwnerUpdated: VaultOwnerUpdatedEvent,
      NewVault: NewVaultEvent,
      DepositCollateral: DepositCollateralEvent,
      RedeemCollateral: RedeemCollateralEvent,
      MintZkUsd: MintZkUsdEvent,
      BurnZkUsd: BurnZkUsdEvent,
      Liquidate: LiquidateEvent,
      CollateralRatioUpdated: CollateralRatioUpdatedEvent,
      LiquidationBonusRatioUpdated: LiquidationBonusRatioUpdatedEvent,
      ConfigMerkleRootUpdated: ConfigMerkleRootUpdatedEvent,
      VaultDebtCeilingUpdated: VaultDebtCeilingUpdatedEvent,
      VaultCreationToggled: VaultCreationToggledEvent,
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
         * Between hardforks, we can use the 'proof' permission to upgrade the proof system. This is managed
         * by the zkUSD governing layer.
         *
         * This design choice balances protocol upgradeability with decentralised governance and security, while acknowledging that
         * true immutability of verification keys is not achievable under Mina's current architecture.
         */
        setVerificationKey: Permissions.VerificationKey.proofOrSignature(),

        editState: Permissions.proof(),
        send: Permissions.proof(),
      });

      this.oracleWhitelistHash.set(Field.from(0));

      this.protocolDataPacked.set(
        ProtocolData.new({
          admin: args.admin,
          validPriceBlockCount: args.validPriceBlockCount,
          emergencyStop: args.emergencyStop,
          vaultCreationDisabled: args.vaultCreationDisabled,
          collateralRatio: args.collateralRatio,
          liquidationBonusRatio: args.liquidationBonusRatio,
          vaultDebtCeiling: args.vaultDebtCeiling,
        }).pack()
      );
    }

    /**
     * @notice  Blocks the updating of state of the token accounts
     */
    approveBase(_forest: AccountUpdateForest): Promise<void> {
      throw Error(ZkUsdEngineErrors.UPDATES_BLOCKED);
    }

    /**
     * @notice The initialize method is necessary for setting up the various helper token accounts
     *         that are used to track the state of the system.
     */
    @method async initialize() {
      super.init()
      //Ensure admin key
      this.ensureAdminSignature();

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
     *
     * VAULT METHODS
     *
     *
     */

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

      //Get the vault & add the precondition
      const vault = await this.retrieveVault(vaultAddress);

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
      // Check vault creation toggle
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );
      protocolData.vaultCreationDisabled.assertFalse(
        VaultErrors.VAULT_CREATION_DISABLED
      );

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
      this.ensureProtocolNotStopped();

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
      this.ensureProtocolNotStopped();

      const vault = await this.retrieveVault(vaultAddress);

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

      // Enforce the vault debt ceiling
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );
      debtAmount
        .lessThanOrEqual(protocolData.vaultDebtCeiling)
        .assertTrue('Minting would exceed the vault debt ceiling.');

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
      //Ensure the protocol is not stopped // TODO reconsider
      this.ensureProtocolNotStopped();

      // //Get the vault
      const vault = await this.retrieveVault(vaultAddress);

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
     *
     * GOVERNANCE METHODS
     *
     *
     */

    @method async govUpdateVaultDebtCeiling(
      updateSpec: ZkusdProtocolUpdateSpec,
      resolutionWitness: ResolutionTree.Witness
    ) {
      const { protocolDataBefore, operation } = await this.runGovUpdateCommon(
        ZkUsdEngineMethodCodes.GovUpdateVaultDebtCeiling,
        updateSpec,
        resolutionWitness
      );
      const oldCeiling = protocolDataBefore.vaultDebtCeiling;
      const newCeiling = operation.vaultDebtCeiling.execute(oldCeiling);

      protocolDataBefore.vaultDebtCeiling = newCeiling;
      this.protocolDataPacked.set(protocolDataBefore.pack());

      this.emitEvent(
        'VaultDebtCeilingUpdated',
        new VaultDebtCeilingUpdatedEvent({
          resolutionIndex: updateSpec.govResolutionIndex,
          oldValue: oldCeiling,
          newValue: newCeiling,
        })
      );
    }
    /**
     * Toggle emergency stop via governance
     */
    @method async govToggleEmergencyStop(
      updateSpec: ZkusdProtocolUpdateSpec,
      resolutionWitness: ResolutionTree.Witness
    ) {
      const { protocolDataBefore, operation } = await this.runGovUpdateCommon(
        ZkUsdEngineMethodCodes.GovStopProtocol,
        updateSpec,
        resolutionWitness
      );

      // Mutate directly
      protocolDataBefore.emergencyStop = operation.emergencyStop.execute(
        protocolDataBefore.emergencyStop
      );
      this.protocolDataPacked.set(protocolDataBefore.pack());

      this.emitEvent(
        'EmergencyStopToggled',
        new EmergencyStopToggledEvent({
          resolutionIndex: updateSpec.govResolutionIndex,
          emergencyStop: protocolDataBefore.emergencyStop,
        })
      );
    }

    /**
     * Update valid price block count via governance
     */
    @method async govUpdateValidPriceBlockCount(
      updateSpec: ZkusdProtocolUpdateSpec,
      resolutionWitness: ResolutionTree.Witness
    ) {
      const { protocolDataBefore, operation } = await this.runGovUpdateCommon(
        ZkUsdEngineMethodCodes.GovUpdateValidPriceBlockCount,
        updateSpec,
        resolutionWitness
      );

      // Mutate
      protocolDataBefore.validPriceBlockCount =
        operation.validPriceBlockCount.execute(
          protocolDataBefore.validPriceBlockCount
        );
      this.protocolDataPacked.set(protocolDataBefore.pack());

      this.emitEvent(
        'ValidPriceBlockCountUpdated',
        new ValidPriceBlockCountUpdatedEvent({
          resolutionIndex: updateSpec.govResolutionIndex,
          previousCount: protocolDataBefore.validPriceBlockCount, // mutated holds new, but you may capture old before
          newCount: protocolDataBefore.validPriceBlockCount,
        })
      );
    }

    /**
     * Update liquidation bonus ratio via governance
     */
    @method async govUpdateLiquidationBonusRatio(
      updateSpec: ZkusdProtocolUpdateSpec,
      resolutionWitness: ResolutionTree.Witness
    ) {
      const { protocolDataBefore, operation } = await this.runGovUpdateCommon(
        ZkUsdEngineMethodCodes.GovUpdateLiquidationBonusRatio,
        updateSpec,
        resolutionWitness
      );

      // Mutate
      protocolDataBefore.liquidationBonusRatio =
        operation.liquidationBonusRatio.execute(
          protocolDataBefore.liquidationBonusRatio
        );
      this.protocolDataPacked.set(protocolDataBefore.pack());

      this.emitEvent(
        'LiquidationBonusRatioUpdated',
        new LiquidationBonusRatioUpdatedEvent({
          resolutionIndex: updateSpec.govResolutionIndex,
          oldRatio: protocolDataBefore.liquidationBonusRatio,
          newRatio: protocolDataBefore.liquidationBonusRatio,
        })
      );
    }

    @method async govUpdateCollateralRatio(
      updateSpec: ZkusdProtocolUpdateSpec,
      resolutionWitness: ResolutionTree.Witness
    ) {
      // perform common checks
      const { protocolDataBefore, operation } = await this.runGovUpdateCommon(
        ZkUsdEngineMethodCodes.GovUpdateCollateralRatio,
        updateSpec,
        resolutionWitness
      );

      // execute the collateral ratio update
      const newCollateralRatio = operation.collateralRatio.execute(
        protocolDataBefore.collateralRatio
      );

      newCollateralRatio.assertGreaterThanOrEqual(MinimalViableCollateralRatio);

      // store the updated data
      const updatedProtocolData = ProtocolData.new({
        admin: protocolDataBefore.admin,
        validPriceBlockCount: protocolDataBefore.validPriceBlockCount,
        emergencyStop: protocolDataBefore.emergencyStop,
        collateralRatio: newCollateralRatio,
        liquidationBonusRatio: protocolDataBefore.liquidationBonusRatio,
      });
      this.protocolDataPacked.set(updatedProtocolData.pack());

      // emit an event
      this.emitEvent(
        'CollateralRatioUpdated',
        new CollateralRatioUpdatedEvent({
          resolutionIndex: updateSpec.govResolutionIndex,
          oldRatio: protocolDataBefore.collateralRatio,
          newRatio: newCollateralRatio,
        })
      );
    }

    @method async govUpdateOracleWhitelist(
      whitelist: OracleWhitelist,
      updateSpec: ZkusdProtocolUpdateSpec,
      resolutionWitness: ResolutionTree.Witness
    ) {
      //Precondition
      const previousHash = this.oracleWhitelistHash.getAndRequireEquals();

      const { operation } = await this.runGovUpdateCommon(
        ZkUsdEngineMethodCodes.GovUpdateValidPriceBlockCount,
        updateSpec,
        resolutionWitness
      );

      // check if whitelist matches the proof
      const whitelisthash = Poseidon.hash(OracleWhitelist.toFields(whitelist));
      const oldWhitelistHash = this.oracleWhitelistHash.getAndRequireEquals();

      // Step 2: execute the collateral ratio update
      const proofWhitelistHash =
        operation.oracleWhitelistHash.execute(oldWhitelistHash);
      whitelisthash.assertEquals(proofWhitelistHash);

      this.oracleWhitelistHash.set(whitelisthash);

      this.emitEvent(
        'OracleWhitelistUpdated',
        new OracleWhitelistUpdatedEvent({
          resolutionIndex: updateSpec.govResolutionIndex,
          previousHash,
          newHash: whitelisthash,
        })
      );
    }

    // This must use a different UpdateSpec that contains
    // the engine vk in its inputs.
    @method async govUpdateEngineVerificationKey(
      newVerificationKey: VerificationKey,
      updateSpec: ZkusdProtocolUpdateSpec,
      resolutionWitness: ResolutionTree.Witness
    ) {
      //Precondition

      // TODO maybe we could save the old vkh in the state to then
      // verify the precondition

      const { operation } = await this.runGovUpdateCommon(
        ZkUsdEngineMethodCodes.GovCRITICALUpdateVerificationKey,
        updateSpec,
        resolutionWitness
      );

      // this is fine, the operation will ignore its argument
      const newProofsVKH = operation.newVerificationKey.execute(Field.from(0));
      newProofsVKH.assertNotEquals(Field.from(0));

      newVerificationKey.hash.assertEquals(newProofsVKH);

      this.account.verificationKey.set(newVerificationKey);

      this.emitEvent(
        'VerificationKeyUpdated',
        new VerificationKeyUpdatedEvent({
          resolutionIndex: updateSpec.govResolutionIndex,
          newVerificationKeyHash: newProofsVKH,
        })
      );
    }

    @method async govUpdateConfigMerkleRoot(
      updateSpec: ZkusdProtocolUpdateSpec,
      resolutionWitness: ResolutionTree.Witness
    ) {
      const { operation } = await this.runGovUpdateCommon(
        ZkUsdEngineMethodCodes.GovUpdateOracleWhitelist,
        updateSpec,
        resolutionWitness
      );

      const oldConfigMerkleRoot = this.configMerkleRoot.getAndRequireEquals();

      // Step 2: execute the collateral ratio update
      const newConfigRoot =
        operation.configMerkleRoot.execute(oldConfigMerkleRoot);

      this.configMerkleRoot.set(newConfigRoot);

      this.emitEvent(
        'ConfigMerkleRootUpdated',
        new ConfigMerkleRootUpdatedEvent({
          resolutionIndex: updateSpec.govResolutionIndex,
          oldRoot: oldConfigMerkleRoot,
          newRoot: newConfigRoot,
        })
      );
    }

    @method async govToggleVaultCreation(
      updateSpec: ZkusdProtocolUpdateSpec,
      resolutionWitness: ResolutionTree.Witness
    ) {
      const { protocolDataBefore, operation } = await this.runGovUpdateCommon(
        ZkUsdEngineMethodCodes.GovToggleVaultCreation,
        updateSpec,
        resolutionWitness
      );

      // Mutate directly
      protocolDataBefore.vaultCreationDisabled =
        operation.vaultCreationDisabled.execute(
          protocolDataBefore.vaultCreationDisabled
        );
      this.protocolDataPacked.set(protocolDataBefore.pack());

      this.emitEvent(
        'VaultCreationToggled',
        new VaultCreationToggledEvent({
          resolutionIndex: updateSpec.govResolutionIndex,
          vaultCreationDisabled: protocolDataBefore.vaultCreationDisabled,
        })
      );
    }

    /**
     * @notice  Updates the admin public key
     * @param   newAdmin The new admin public key
     */
    @method async updateAdmin(newAdmin: PublicKey) {
      //Ensure admin signature
      this.ensureAdminSignature();

      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );

      const previousAdmin = this.getAdmin();

      protocolData.admin = newAdmin;
      this.protocolDataPacked.set(protocolData.pack());

      this.emitEvent('AdminUpdated', {
        previousAdmin,
        newAdmin,
      });
    }

    /**
     *
     * PUBLIC METHODS
     *
     *
     */

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
     * @notice  Returns the vault parameters based on the protocol data
     * @returns The vault parameters
     */
    public async getVaultParams(): Promise<VaultParams> {
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );
      return protocolData.getVaultParams();
    }

    /**
     * @notice  Returns the vault class based on the protocol data
     * @returns The vault class
     */
    public async getVaultClass(): Promise<ReturnType<typeof Vault>> {
      return Vault(await this.getVaultParams());
    }

    /**
     * @notice  Retrieves a vault
     * @param   vaultAddress The address of the vault
     * @returns The vault
     */
    public async retrieveVault(vaultAddress: PublicKey) {
      const vaultUpdate = AccountUpdate.create(
        vaultAddress,
        this.deriveTokenId()
      );
      return Vault(await this.getVaultParams()).getAndRequireEquals(
        vaultUpdate
      );
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
      //Get the vault & add the precondition
      const vault = await this.retrieveVault(vaultAddress);

      //Return the health factor
      return vault.getHealthFactor(minaPrice);
    }

    /**
     *
     * INTERNAL METHODS
     *
     *
     */

    /**
     * @notice  This method is used to assert the interaction flag, this is used to ensure that the zkUSD token contract knows it is being called from the vault
     * @returns True if the flag is set
     */
    assertInteractionFlag(): Bool {
      this.interactionFlag.requireEquals(Bool(true));
      this.interactionFlag.set(Bool(false));
      return Bool(true);
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
        protocolData.validPriceBlockCount.toUInt32()
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
     * @notice  Returns the admin public key
     * @returns The admin public key
     */
    getAdmin(): PublicKey {
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );
      return protocolData.admin;
    }

    /**
     * @notice  Returns true if the protocol is emergency stopped
     * @returns True if the protocol is emergency stopped
     */
    isEmergencyStopped(): Bool {
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );
      return protocolData.emergencyStop;
    }

    /**
     * @notice  Returns the protocol data
     * @returns The protocol data
     */
    getProtocolData(): ProtocolData {
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );
      return protocolData;
    }

    /**
     * @notice  Returns the valid price block count
     * @returns The valid price block count
     */
    getValidPriceBlockCount(): UInt8 {
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );
      return protocolData.validPriceBlockCount;
    }

    /**
     * @notice  Builds the protocol state for the update
     * @returns The protocol state
     */
    buildProtocolState(): ZkusdUpdateProtocolState {
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );
      return new ZkusdUpdateProtocolState({
        emergencyStop: protocolData.emergencyStop,
        collateralRatio: protocolData.collateralRatio,
        liquidationBonusRatio: protocolData.liquidationBonusRatio,
        validPriceBlockCount: protocolData.validPriceBlockCount,
        oracleWhitelistHash: this.oracleWhitelistHash.getAndRequireEquals(),
        configMerkleRoot: this.configMerkleRoot.getAndRequireEquals(),
        vaultCreationDisabled: protocolData.vaultCreationDisabled,
        vaultDebtCeiling: protocolData.vaultDebtCeiling,
      });
    }

    /**
     * @notice  Builds the blockchain state for the update
     * @returns The blockchain state
     */
    buildBlockchainState(): ZkusdUpdateMinaBlockchainState {
      return {
        currentSlot: this.currentSlot,
        blockchainLength: this.network.blockchainLength.getAndRequireEquals(),
      };
    }

    /**
     * @notice  Ensures the protocol is not stopped
     */
    ensureProtocolNotStopped() {
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );
      protocolData.emergencyStop.assertFalse(ZkUsdEngineErrors.EMERGENCY_HALT);
    }

    /**
     * @notice  Internal helper to validate admin signature
     * @returns The signed account update from the admin
     */
    ensureAdminSignature(): AccountUpdate {
      const protocolData = ProtocolData.unpack(
        this.protocolDataPacked.getAndRequireEquals()
      );
      return AccountUpdate.createSigned(protocolData.admin);
    }

    /**
     * @notice Shared function that checks governance acceptance, verifies the proof,
     *         ensures preconditions, and returns the existing protocol data + operation.
     */
    async runGovUpdateCommon(
      methodCode: Field,
      resolutionSpec: ZkusdProtocolUpdateSpec,
      resolutionWitness: ResolutionTree.Witness
    ): Promise<{
      protocolDataBefore: ProtocolData;
      operation: ZkusdProtocolUpdateOperation; // or whatever your update operation class is
    }> {
      // Verify governance acceptance
      const gov = new args.GovernmentClass(args.zkUsdGovernmentAddress);
      const govAcceptance = await gov.canExecuteGovResolution(
        methodCode,
        resolutionSpec,
        resolutionWitness
      );
      govAcceptance.assertTrue(
        'ZkUSD government contract disallowed the update proof.'
      );

      // Check blockchain-level preconditions (time, block length, etc.)
      const blockchainState = this.buildBlockchainState();

      requireBlockchainPreconditions({
        preconditions: resolutionSpec.blockchainPreconditions,
        blockchainState,
      });

      // Check protocol-level preconditions
      const protocolState = this.buildProtocolState();
      protocolState
        .isValidForPreconditions(resolutionSpec.protocolUpdatePreconditions)
        .assertTrue();

      // Fetch the current on-chain protocol data
      const packedData = this.protocolDataPacked.getAndRequireEquals();
      const protocolDataBefore = ProtocolData.unpack(packedData);

      // Extract the update operation from the proof
      const operation = resolutionSpec.protocolUpdateOperation;

      // Return all we need for the actual update
      return { protocolDataBefore, operation };
    }

    /**
     *
     * ZKUSD TOKEN STANDARD ADMIN METHODS
     * We need to use the admin signature for the token standard management, this will be a multisig.
     *
     */

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
      this.ensureAdminSignature();
      return Bool(true);
    }

    /**
     * @notice  Returns true if the admin can pause the token
     * @returns True if the admin can pause the token
     */
    @method.returns(Bool)
    public async canPause(): Promise<Bool> {
      this.ensureAdminSignature();
      return Bool(true);
    }

    /**
     * @notice  Returns true if the admin can resume the token
     * @returns True if the admin can resume the token
     */
    @method.returns(Bool)
    public async canResume(): Promise<Bool> {
      this.ensureAdminSignature();
      return Bool(true);
    }

    /**
     * @notice  Returns true if the admin can change the verification key
     * @returns True if the admin can change the verification key
     */
    @method.returns(Bool)
    public async canChangeVerificationKey(_vk: VerificationKey): Promise<Bool> {
      this.ensureAdminSignature();
      return Bool(true);
    }
  }

  return ZkUsdEngine;
}
