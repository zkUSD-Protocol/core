#[allow(unused_field, unused_const)]
module zkusd::sequence;

use std::string::String;
use sui::bcs;
use sui::clock::{Self, Clock};
use sui::event;
use sui::hash;
use sui::table::{Self, Table};

const EPOCH_DURATION_MS: u64 = 100000; // 100 seconds in milliseconds

// Error codes
const E_EPOCH_NOT_ACTIVE: u64 = 1;
const E_EPOCH_NOT_ENDED: u64 = 2;
const E_NOT_VALIDATOR: u64 = 3;
const E_INVALID_STATE_ROOT: u64 = 4;
const E_EPOCH_ALREADY_ENDED: u64 = 5;
const E_EPOCH_STILL_ACTIVE: u64 = 6;

/// Epoch states
const EPOCH_STATE_ACTIVE: u8 = 0;
const EPOCH_STATE_ENDED: u8 = 1;
const EPOCH_STATE_WAITING_CONSENSUS: u8 = 2;

/// Intent submitted by users
public struct Intent has key {
  id: UID,
  intent_type: u8,
  intent_blob_id: String,
  state_root: String,
  created_at: u64,
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
  current_epoch_state: u8, // EPOCH_STATE_*
  accepting_intents: bool, // Whether to accept new intents
}

/// Epoch structure to track intent ranges
public struct Epoch has key {
  id: UID,
  epoch_number: u64,
  start_sequence: u64,
  end_sequence: Option<u64>,
  start_state_root: String, //hash of the vault map and zkusd map at the moment of the epoch start
  end_state_root: Option<String>, //hash of the vault map and zkusd map at the moment of the epoch end
  intents_hash: Option<vector<u8>>,
  created_at: u64,
  ended_at: Option<u64>,
  epoch_state: u8, // EPOCH_STATE_*
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
  intent_blob_id: String,
  state_root: String,
  sequence: u64,
  created_at: u64,
}

public struct EpochEndedEvent has copy, drop {
  epoch_id: ID,
  epoch_number: u64,
  start_sequence: u64,
  end_sequence: u64,
  intents_hash: vector<u8>,
  ended_at: u64,
}

public struct EpochStartedEvent has copy, drop {
  epoch_id: ID,
  epoch_number: u64,
  start_sequence: u64,
  start_state_root: String,
  created_at: u64,
}

public struct EpochFinalizedEvent has copy, drop {
  epoch_id: ID,
  epoch_number: u64,
  end_state_root: String,
  validator: address,
  finalized_at: u64,
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

  // Create sequencer - starts without an active epoch
  let sequencer = IntentSequencer {
    id: object::new(ctx),
    sequenced_intents: vector[],
    current_sequence: 0,
    last_epoch_time: 0,
    last_epoch_end_sequence: 0,
    current_epoch_number: 0,
    epochs: table::new(ctx),
    epoch_ids: vector[],
    current_epoch_state: EPOCH_STATE_ENDED, // Start in ended state
    accepting_intents: false, // Don't accept intents until first epoch is started
  };

  // Share both objects
  transfer::share_object(registry);
  transfer::share_object(sequencer);
}

/// Create a new intent and add to queue
public fun create_intent(
  sequencer: &mut IntentSequencer,
  intent_type: u8,
  intent_blob_id: String,
  state_root: String,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // Check if we're accepting intents
  assert!(sequencer.accepting_intents, E_EPOCH_NOT_ACTIVE);
  assert!(sequencer.current_epoch_state == EPOCH_STATE_ACTIVE, E_EPOCH_NOT_ACTIVE);

  let intent_id = object::new(ctx);
  let intent_id_copy = object::uid_to_inner(&intent_id);
  let current_time = clock::timestamp_ms(clock);

  let intent = Intent {
    id: intent_id,
    intent_type,
    intent_blob_id,
    state_root,
    created_at: current_time,
  };

  // Add intent to sequencer
  vector::push_back(&mut sequencer.sequenced_intents, intent_id_copy);
  sequencer.current_sequence = sequencer.current_sequence + 1;

  // Check if we need to end the epoch (duration has passed)
  let should_end_epoch = current_time >= sequencer.last_epoch_time + EPOCH_DURATION_MS;

  if (should_end_epoch) {
    end_epoch_internal(sequencer, current_time);
  };

  // Emit event for validators
  event::emit(IntentCreatedEvent {
    intent_id: intent_id_copy,
    intent_type,
    state_root,
    intent_blob_id,
    sequence: sequencer.current_sequence,
    created_at: current_time,
  });

  // Store the intent in global storage
  transfer::share_object(intent);
}

/// Finalize current epoch and start new epoch (validator only)
public fun finalize_and_start_epoch(
  sequencer: &mut IntentSequencer,
  current_epoch: &mut Epoch,
  registry: &ValidatorRegistry,
  consensus_state_root: String,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let sender = tx_context::sender(ctx);
  assert!(vector::contains(&registry.validators, &sender), E_NOT_VALIDATOR);
  assert!(current_epoch.epoch_state == EPOCH_STATE_ACTIVE, E_EPOCH_NOT_ENDED);
  assert!(sequencer.current_epoch_state == EPOCH_STATE_ENDED, E_EPOCH_STILL_ACTIVE);

  let current_time = clock::timestamp_ms(clock);
  let start_sequence = current_epoch.start_sequence;
  let end_sequence = sequencer.current_sequence - 1;
  let intents_hash = compute_epoch_intents_hash(sequencer, start_sequence, end_sequence);

  // Finalize current epoch
  current_epoch.end_sequence = option::some(end_sequence);
  current_epoch.intents_hash = option::some(intents_hash);
  current_epoch.end_state_root = option::some(consensus_state_root);
  current_epoch.ended_at = option::some(current_time);
  current_epoch.epoch_state = EPOCH_STATE_WAITING_CONSENSUS;

  // Emit finalization event
  event::emit(EpochFinalizedEvent {
    epoch_id: object::id(current_epoch),
    epoch_number: current_epoch.epoch_number,
    end_state_root: consensus_state_root,
    validator: sender,
    finalized_at: current_time,
  });

  // Start new epoch immediately
  sequencer.current_epoch_number = sequencer.current_epoch_number + 1;

  let new_epoch_id = object::new(ctx);
  let new_epoch_id_copy = object::uid_to_inner(&new_epoch_id);

  let new_epoch = Epoch {
    id: new_epoch_id,
    epoch_number: sequencer.current_epoch_number,
    start_sequence: sequencer.current_sequence,
    end_sequence: option::none(),
    start_state_root: consensus_state_root, // Previous epoch's end state becomes new start state
    end_state_root: option::none(),
    intents_hash: option::none(),
    created_at: current_time,
    ended_at: option::none(),
    epoch_state: EPOCH_STATE_ACTIVE,
  };

  // Store new epoch
  table::add(&mut sequencer.epochs, sequencer.current_epoch_number, new_epoch_id_copy);
  vector::push_back(&mut sequencer.epoch_ids, new_epoch_id_copy);

  // Update sequencer state for new epoch
  sequencer.current_epoch_state = EPOCH_STATE_ACTIVE;
  sequencer.accepting_intents = true;
  sequencer.last_epoch_time = current_time;

  // Emit new epoch started event
  event::emit(EpochStartedEvent {
    epoch_id: new_epoch_id_copy,
    epoch_number: sequencer.current_epoch_number,
    start_sequence: sequencer.current_sequence,
    start_state_root: consensus_state_root,
    created_at: current_time,
  });

  // Store new epoch as shared object
  transfer::share_object(new_epoch);
}

/// Internal function to end the current epoch
fun end_epoch_internal(sequencer: &mut IntentSequencer, current_time: u64) {
  assert!(sequencer.current_epoch_state == EPOCH_STATE_ACTIVE, E_EPOCH_ALREADY_ENDED);

  // Get current epoch
  let epoch_id = *table::borrow(&sequencer.epochs, sequencer.current_epoch_number);

  // We need to get the epoch object to update it, but since it's shared we can't do that here
  // Instead, we'll update the sequencer state and emit an event
  // The epoch will be updated in the finalize_epoch function

  let start_sequence = sequencer.last_epoch_end_sequence;
  let end_sequence = sequencer.current_sequence - 1;

  let intents_hash = compute_epoch_intents_hash(sequencer, start_sequence, end_sequence);

  // Update sequencer state
  sequencer.current_epoch_state = EPOCH_STATE_ENDED;
  sequencer.accepting_intents = false; // Stop accepting intents
  sequencer.last_epoch_end_sequence = sequencer.current_sequence;

  // Emit epoch ended event
  event::emit(EpochEndedEvent {
    epoch_id,
    epoch_number: sequencer.current_epoch_number,
    start_sequence,
    end_sequence,
    intents_hash,
    ended_at: current_time,
  });
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
  if (option::is_none(&epoch.end_sequence) || option::is_none(&epoch.intents_hash)) {
    return false
  };

  let end_sequence = *option::borrow(&epoch.end_sequence);
  let expected_hash = *option::borrow(&epoch.intents_hash);

  let mut data_to_hash = vector::empty<u8>();

  // Add epoch boundaries
  let start_bytes = bcs::to_bytes(&epoch.start_sequence);
  let end_bytes = bcs::to_bytes(&end_sequence);
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
  computed_hash == expected_hash
}

/// Add validator to registry (admin only)
public fun add_validator(registry: &mut ValidatorRegistry, validator: address, ctx: &TxContext) {
  assert!(registry.admin == tx_context::sender(ctx), 0);
  vector::push_back(&mut registry.validators, validator);
}

/// Remove validator from registry (admin only)
public fun remove_validator(registry: &mut ValidatorRegistry, validator: address, ctx: &TxContext) {
  assert!(registry.admin == tx_context::sender(ctx), 0);
  let (found, index) = vector::index_of(&registry.validators, &validator);
  if (found) {
    vector::remove(&mut registry.validators, index);
  };
}

/// Get current epoch state
public fun get_epoch_state(sequencer: &IntentSequencer): u8 {
  sequencer.current_epoch_state
}

/// Check if sequencer is accepting intents
public fun is_accepting_intents(sequencer: &IntentSequencer): bool {
  sequencer.accepting_intents
}

/// Get current epoch number
public fun get_current_epoch_number(sequencer: &IntentSequencer): u64 {
  sequencer.current_epoch_number
}

/// Get current sequence number
public fun get_current_sequence(sequencer: &IntentSequencer): u64 {
  sequencer.current_sequence
}
