#[allow(unused_field, unused_const)]
module zkusd::intents;

use std::string::String;
use sui::bcs;
use sui::clock::{Self, Clock};
use sui::event;
use sui::hash;
use sui::table::{Self, Table};

const CREATE_VAULT: u8 = 0;
const DEPOSIT_COLLATERAL: u8 = 1;
const MINT_ZKUSD: u8 = 2;
const REDEEM_COLLATERAL: u8 = 3;
const BURN_ZKUSD: u8 = 4;
const LIQUIDATE_VAULT: u8 = 5;
const TRANSFER_ZKUSD: u8 = 6;

const PENDING: u8 = 0;
const VERIFIED: u8 = 1;
const SEQUENCED: u8 = 2;

const EPOCH_DURATION_MS: u64 = 100000; // 100 seconds in milliseconds

public struct CreateVaultIntentOutput has store {
  vault_update: String,
}

public struct CreateVaultIntentInput has store {
  vault_map_root: String,
}

public struct DepositCollateralIntentOutput has store {
  vault_update: String,
}

public struct DepositCollateralIntentInput has store {
  vault_map_root: String,
  collateral_ratio: u8,
  liquidation_bonus_ratio: u8,
}

public struct MintZkusdIntentOutput has store {
  vault_update: String,
  output_note_commitment: String,
}

public struct MintZkusdIntentInput has store {
  zkusd_map_root: String,
  vault_map_root: String,
  collateral_ratio: u8,
  liquidation_bonus_ratio: u8,
}

public struct RedeemCollateralIntentOutput has store {
  vault_update: String,
}

public struct RedeemCollateralIntentInput has store {
  vault_map_root: String,
  collateral_ratio: u8,
  liquidation_bonus_ratio: u8,
}

public struct BurnZkusdIntentOutput has store {
  nullifiers: vector<String>,
  output_note_commitment: String,
  vault_update: String,
}

public struct BurnZkusdIntentInput has store {
  zkusd_map_root: String,
  vault_map_root: String,
  collateral_ratio: u8,
  liquidation_bonus_ratio: u8,
}

public struct LiquidateVaultIntentOutput has store {
  nullifiers: vector<String>,
  output_note_commitment: String,
  vault_update: String,
}

public struct LiquidateVaultIntentInput has store {
  zkusd_map_root: String,
  vault_map_root: String,
  collateral_ratio: u8,
  liquidation_bonus_ratio: u8,
}

public struct TransferZkusdIntentOutput has store {
  nullifiers: vector<String>,
  output_note_commitments: vector<String>,
  vault_update: String,
}

public struct TransferZkusdIntentInput has store {
  zkusd_map_root: String,
}

public struct IntentOutput has store {
  burn_output: Option<BurnZkusdIntentOutput>,
  create_vault_output: Option<CreateVaultIntentOutput>,
  deposit_collateral_output: Option<DepositCollateralIntentOutput>,
  mint_zkusd_output: Option<MintZkusdIntentOutput>,
  redeem_collateral_output: Option<RedeemCollateralIntentOutput>,
  liquidate_vault_output: Option<LiquidateVaultIntentOutput>,
  transfer_zkusd_output: Option<TransferZkusdIntentOutput>,
}

public struct IntentInput has store {
  create_vault_input: Option<CreateVaultIntentInput>,
  deposit_collateral_input: Option<DepositCollateralIntentInput>,
  mint_zkusd_input: Option<MintZkusdIntentInput>,
  redeem_collateral_input: Option<RedeemCollateralIntentInput>,
  burn_zkusd_input: Option<BurnZkusdIntentInput>,
  liquidate_vault_input: Option<LiquidateVaultIntentInput>,
  transfer_zkusd_input: Option<TransferZkusdIntentInput>,
}

/// Intent submitted by users
public struct Intent has key {
  id: UID,
  intent_type: u8,
  proof_da_hash: String,
  created_at: u64,
  user: address,
  output: IntentOutput,
  input: IntentInput,
}

/// Main sequencer for ordered intent processing
public struct IntentSequencer has key {
  id: UID,
  sequenced_intents: vector<ID>,
  current_sequence: u64,
  last_epoch_time: u64,
  last_epoch_end_sequence: u64,
  current_epoch_number: u64,
  epochs: Table<u64, ID>, // epoch_number -> Epoch object ID
  epoch_ids: vector<ID>, // All epoch IDs in order
  admin: address,
}

/// Epoch structure to track intent ranges
public struct Epoch has key {
  id: UID,
  epoch_number: u64,
  start_sequence: u64,
  end_sequence: u64,
  intents_hash: vector<u8>,
  created_at: u64,
}

/// Registry of authorized validators
public struct ValidatorRegistry has key {
  id: UID,
  validators: vector<address>,
  admin: address,
}

/// Event emitted when new intent is created
public struct IntentCreatedEvent has copy, drop {
  intent_id: ID,
  intent_type: u8,
  proof_da_hash: String,
  user: address,
  sequence: u64,
  created_at: u64,
}

public struct EpochCreatedEvent has copy, drop {
  epoch_id: ID,
  epoch_number: u64,
  start_sequence: u64,
  end_sequence: u64,
  intents_hash: vector<u8>,
  created_at: u64,
}

/// Initialize the intent queue system and validator registry (called once)
fun init(ctx: &mut TxContext) {
  let sender = tx_context::sender(ctx);

  // Create validator registry with admin as first validator
  let registry = ValidatorRegistry {
    id: object::new(ctx),
    validators: vector[sender], // Admin is the first validator
    admin: sender,
  };

  // Create sequencer
  let sequencer = IntentSequencer {
    id: object::new(ctx),
    sequenced_intents: vector[],
    current_sequence: 0,
    last_epoch_time: 0,
    last_epoch_end_sequence: 0,
    current_epoch_number: 0,
    epochs: table::new(ctx),
    epoch_ids: vector[],
    admin: sender,
  };

  // Share both objects
  transfer::share_object(registry);
  transfer::share_object(sequencer);
}

/// Create a new intent and add to queue
public fun create_intent(
  sequencer: &mut IntentSequencer,
  intent_type: u8,
  proof_da_hash: String,
  input: IntentInput,
  output: IntentOutput,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let intent_id = object::new(ctx);
  let intent_id_copy = object::uid_to_inner(&intent_id);
  let current_time = clock::timestamp_ms(clock);

  // Check if we need to create a new epoch (100 seconds have passed)
  let should_create_epoch = if (sequencer.last_epoch_time == 0) {
    // First epoch - create immediately
    true
  } else {
    // Check if 100 seconds have passed
    current_time >= sequencer.last_epoch_time + EPOCH_DURATION_MS
  };

  if (should_create_epoch) {
    create_epoch_internal(
      sequencer,
      current_time,
      ctx,
    );
  };

  let intent = Intent {
    id: intent_id,
    intent_type,
    proof_da_hash,
    output,
    input,
    created_at: current_time,
    user: tx_context::sender(ctx),
  };

  // Add intent to sequencer
  vector::push_back(&mut sequencer.sequenced_intents, intent_id_copy);
  sequencer.current_sequence = sequencer.current_sequence + 1;

  // Emit event for validators
  event::emit(IntentCreatedEvent {
    intent_id: intent_id_copy,
    intent_type,
    proof_da_hash,
    user: tx_context::sender(ctx),
    sequence: sequencer.current_sequence,
    created_at: clock::timestamp_ms(clock),
  });

  // Store the intent in global storage instead of returning it
  transfer::share_object(intent);
}

fun create_epoch_internal(sequencer: &mut IntentSequencer, current_time: u64, ctx: &mut TxContext) {
  let start_sequence = sequencer.last_epoch_end_sequence;
  let end_sequence = if (sequencer.current_sequence == 0) {
    0 // First epoch starts at 0
  } else {
    sequencer.current_sequence - 1 // End at the last sequenced intent
  };

  // Only create epoch if there are intents to include or it's the first epoch
  if (end_sequence >= start_sequence || sequencer.current_epoch_number == 0) {
    let intents_hash = compute_epoch_intents_hash(sequencer, start_sequence, end_sequence);

    let epoch = Epoch {
      id: object::new(ctx),
      epoch_number: sequencer.current_epoch_number,
      start_sequence,
      end_sequence,
      intents_hash,
      created_at: current_time,
    };

    let epoch_id = object::id(&epoch);

    // Store in registry for easy access
    table::add(&mut sequencer.epochs, sequencer.current_epoch_number, epoch_id);
    vector::push_back(&mut sequencer.epoch_ids, epoch_id);

    // Update sequencer state for next epoch
    sequencer.last_epoch_time = current_time;
    sequencer.last_epoch_end_sequence = end_sequence + 1; // Next epoch starts after this one
    sequencer.current_epoch_number = sequencer.current_epoch_number + 1;

    // Emit epoch creation event
    event::emit(EpochCreatedEvent {
      epoch_id,
      epoch_number: epoch.epoch_number,
      start_sequence,
      end_sequence,
      intents_hash,
      created_at: current_time,
    });

    // Store as shared object
    transfer::share_object(epoch);
  };
}

/// Compute deterministic hash of all intent IDs in an epoch
fun compute_epoch_intents_hash(
  sequencer: &IntentSequencer,
  start_sequence: u64,
  end_sequence: u64,
): vector<u8> {
  let mut data_to_hash = vector::empty<u8>();

  // Add epoch boundaries to the hash for additional security
  let start_bytes = bcs::to_bytes(&start_sequence);
  let end_bytes = bcs::to_bytes(&end_sequence);
  vector::append(&mut data_to_hash, start_bytes);
  vector::append(&mut data_to_hash, end_bytes);

  // Add each intent ID in sequence order
  let mut i = start_sequence;
  while (i <= end_sequence && i < vector::length(&sequencer.sequenced_intents)) {
    let intent_id = *vector::borrow(&sequencer.sequenced_intents, i);
    let intent_id_bytes = bcs::to_bytes(&intent_id);
    vector::append(&mut data_to_hash, intent_id_bytes);
    i = i + 1;
  };

  hash::keccak256(&data_to_hash)
}

/// Verify that a given set of intents matches the epoch hash
public fun verify_epoch_intents(epoch: &Epoch, intent_ids: vector<ID>): bool {
  let mut data_to_hash = vector::empty<u8>();

  // Add epoch boundaries
  let start_bytes = bcs::to_bytes(&epoch.start_sequence);
  let end_bytes = bcs::to_bytes(&epoch.end_sequence);
  vector::append(&mut data_to_hash, start_bytes);
  vector::append(&mut data_to_hash, end_bytes);

  // Add intent IDs
  let mut i = 0;
  while (i < vector::length(&intent_ids)) {
    let intent_id = *vector::borrow(&intent_ids, i);
    let intent_id_bytes = bcs::to_bytes(&intent_id);
    vector::append(&mut data_to_hash, intent_id_bytes);
    i = i + 1;
  };

  let computed_hash = hash::keccak256(&data_to_hash);
  computed_hash == epoch.intents_hash
}

/// Add validator to registry (admin only)
public fun add_validator(registry: &mut ValidatorRegistry, validator: address, ctx: &TxContext) {
  assert!(registry.admin == tx_context::sender(ctx), 0);
  registry.validators.push_back(validator);
}
