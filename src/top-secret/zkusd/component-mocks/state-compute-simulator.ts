// import { ZkUsdState } from "../data/state.js";
// import { VaultMap } from "./data/vault-map.js";
// import { ZkUsdMap } from "./data/zkusd-map.js";
// import { MockStateEventQueue, StateEventQueue } from "./rollup-state-event-queue.js";
// import { RollupDataProvider } from "./rollup-data-provider.js";
// import { RollupDataProviderImpl } from "./rollup-data-provider.js";
// import { InMemoryZkusdStateManager, OptimisticStateComputer, OptimisticStateProcessor } from "./optimistic.js";
// import { MockStatePublisher } from "./rollup-state-publisher.js";
// import { StateProcessorLog } from "./optimistic-types.js";
// import { KeyPair } from "../../../types/utility.js";
// import { PrivateKey, Signature, UInt64, UInt8 } from "o1js";
// import { CreateVaultIntent, CreateVaultIntentInput, CreateVaultIntentKey, CreateVaultIntentProof, CreateVaultPrivateInput } from "../programs/intents/create-vault.js";
// import { Field } from "o1js";
// import { IntentProof } from "../types/intent-proof.js";
// import { Proof } from "o1js/dist/node/lib/proof-system/circuit.js";
// import { DepositIntent, DepositIntentInput, DepositIntentKey, DepositIntentProof, DepositPrivateInput } from "../programs/intents/deposit.js";
// import { MintIntent, MintIntentInput, MintIntentPrivateInput, MintIntentProof } from "../programs/intents/mint.js";
// import { InputNotes, Note, OutputNotes } from "../data/note.js";
// import { AggregateOraclePricesProof } from "../../../proofs/oracle-price-aggregation/prove.js";
// import { TransferIntent, TransferIntentInput, TransferIntentPrivateInput, TransferIntentProof } from "../programs/intents/transfer.js";
// import { RedeemIntent, RedeemIntentInput, RedeemIntentPrivateInput, RedeemIntentProof } from "../programs/intents/redeem.js";

// interface MapProvider{
//     vaultMap(): Promise<VaultMap>;
//     zkUsdMap(): Promise<ZkUsdMap>;
// }

// export class MapProviderImpl implements MapProvider {

//     constructor(
//      private readonly _getVaultMap: () => Promise<VaultMap>,
//      private readonly _getZkUsdMap: () => Promise<ZkUsdMap>){}

//     vaultMap(): Promise<VaultMap> {
//         return this._getVaultMap();
//     }
//     zkUsdMap(): Promise<ZkUsdMap> {
//         return this._getZkUsdMap();
//     }
// }

// export class Scenario {

//     private readonly _items: string[] = [];

//     public get items(): string[] {
//         return [...this._items];
//     }

//     private readonly _events: MockStateEventQueue;
//     private readonly _data: RollupDataProvider;
//     private readonly _mapProvider: MapProvider;
//     private readonly _zkusdState: ZkUsdState;

//     private readonly _users: KeyPair[] = [];

//     public user(index: number): KeyPair {
//         // if user underflows, create a new one
//         if (index >= this._users.length) {
//             this._users.push(PrivateKey.randomKeypair());
//         }
//         return this._users[index];
//     }

//     constructor(mapProvider: MapProvider, zkusdState: ZkUsdState) {
//         this._events = new MockStateEventQueue();
//         this._data = RollupDataProviderImpl.create();
//         this._mapProvider = mapProvider;
//         this._zkusdState = zkusdState;
// }

//     get events(): StateEventQueue {
//         return this._events;
//     }

//     get data(): RollupDataProvider {
//         return this._data;
//     }

//     async addBlockEnd(): Promise<void> {
//         this._events.pushBlockEnd();
//         this._items.push('block-end');
//     }

//     public toString(): string {
//         return "Scenario with:\n" + this._items.join('\n');
//     }

//     async addDepositCollateralIntent(userIndex: number, amount: UInt64): Promise<void> {

//         const vaultMap = await this._mapProvider.vaultMap();

//         const type = UInt8.from(0);
//         const message: Field[] = [
//           vaultMap.root,
//           type.value,
//           DepositIntentKey,
//         ];

//         const signature = Signature.create(this.user(userIndex).privateKey, message);

//         const publicInput = new DepositIntentInput({
//             vaultMapRoot: vaultMap.root,
//             collateralRatio: this._zkusdState.collateralRatio,
//             liquidationBonusRatio: this._zkusdState.liquidationBonusRatio,
//         });

//         const privateInput = new DepositPrivateInput({
//             vaultMap,
//             type,
//             ownerSignature: signature,
//             ownerPublicKey: this.user(userIndex).publicKey,
//             amount,
//         });

//         const output = await DepositIntent.rawMethods.deposit(publicInput, privateInput);

//         const dummyProof = await DepositIntentProof.dummy(
//             publicInput,
//             output.publicOutput,
//             0,
//         );

//         const intentProof: IntentProof = {
//             kind: 'deposit',
//             proof: dummyProof,
//         };

//         // extract input commitment and store the proof
//         this._events.pushIntentViaProof(intentProof);
//         this.data.storeIntentProof(intentProof);
//         this._items.push('deposit');
//     }

//     async addMintIntent(userIndex: number, amount: UInt64): Promise<void> {

//         const vaultMap = await this._mapProvider.vaultMap();
//         const zkusdMap = await this._mapProvider.zkUsdMap();

//         const publicInput = new MintIntentInput({
//             intentVaultMapRoot: vaultMap.root,
//             intentZkUsdMapRoot: zkusdMap.root,
//             collateralRatio: this._zkusdState.collateralRatio,
//             liquidationBonusRatio: this._zkusdState.liquidationBonusRatio,
//         });

//         // get it from a price proof service
//         const priceProof = undefined as unknown as AggregateOraclePricesProof;

//         // get it from a note manager
//         const note = undefined as unknown as Note;

//         const privateInput = new MintIntentPrivateInput({
//             intentZkUsdMap: zkusdMap,
//             intentVaultMap: vaultMap,
//             note,
//             priceProof,
//             type: UInt8.from(0),
//             ownerSignature: Signature.create(this.user(userIndex).privateKey, []),
//             ownerPublicKey: this.user(userIndex).publicKey,
//             amount,
//         });

//         const output = await MintIntent.rawMethods.mint(publicInput, privateInput);

//         const proof = await MintIntentProof.dummy(publicInput, output.publicOutput, -1);

//         const intentProof: IntentProof = {
//             kind: 'mint',
//             proof,
//         };

//         this._events.pushIntentViaProof(intentProof);
//         this.data.storeIntentProof(intentProof);
//         this._items.push('mint');
//     }

//     async addTransferIntent(userIndex: number, amount: UInt64): Promise<void> {

//         const zkusdMap = await this._mapProvider.zkUsdMap();

//         const publicInput = new TransferIntentInput({
//             intentZkUsdMapRoot: zkusdMap.root,
//         });
// const inputNotes: InputNotes = new InputNotes({notes:[]})
// const outputNotes: OutputNotes = new OutputNotes({notes:[]})

// const signature: Signature = Signature.create(this.user(userIndex).privateKey, inputNotes.toFields());

// // todo compute
// const nullifierKey = Field.random();

// const privateInput = new TransferIntentPrivateInput({
//     intentZkUsdMap: zkusdMap,
//     inputNotes,
//     outputNotes,
//     spendingSignature: signature,
//     spendingPublicKey: this.user(userIndex).publicKey,
//     nullifierKey,
// });

//         const output = await TransferIntent.rawMethods.transfer(publicInput, privateInput);
//         const proof = await TransferIntentProof.dummy(publicInput, output.publicOutput, 0);

//         const intentProof: IntentProof = {
//             kind: 'transfer',
//             proof,
//         };

//         this._events.pushIntentViaProof(intentProof);
//         this.data.storeIntentProof(intentProof);
//         this._items.push('transfer');
//     }

//     async addRedeemIntent(userIndex: number, amount: UInt64): Promise<void> {

//         const vaultMap = await this._mapProvider.vaultMap();

//         const publicInput = new RedeemIntentInput({
//             intentVaultMapRoot: vaultMap.root,
//             collateralRatio: this._zkusdState.collateralRatio,
//             liquidationBonusRatio: this._zkusdState.liquidationBonusRatio,
//         });

//         const privateInput = new RedeemIntentPrivateInput({
//             intentVaultMap: vaultMap,
//             type: UInt8.from(0),
//             priceProof: undefined as unknown as AggregateOraclePricesProof,
//             ownerSignature: Signature.create(this.user(userIndex).privateKey, []),
//             ownerPublicKey: this.user(userIndex).publicKey,
//             amount,
//         });

//         const output = await RedeemIntent.rawMethods.redeem(publicInput, privateInput);
//         const proof = await RedeemIntentProof.dummy(publicInput, output.publicOutput, 0);

//         const intentProof: IntentProof = {
//             kind: 'redeem',
//             proof,
//         };

//         this._events.pushIntentViaProof(intentProof);
//         this.data.storeIntentProof(intentProof);
//         this._items.push('redeem');
//     }

//     async addCreateVaultIntent(userIndex: number): Promise<void> {

//         const vaultMap = await this._mapProvider.vaultMap();

//         const type = UInt8.from(0);
//         const message: Field[] = [
//           vaultMap.root,
//           type.value,
//           CreateVaultIntentKey,
//         ];

//         const signature = Signature.create(this.user(userIndex).privateKey, message);

//         const publicInput = new CreateVaultIntentInput({
//             vaultMapRoot: vaultMap.root,
//         });

//         const privateInput = new CreateVaultPrivateInput({
//             vaultMap,
//             type,
//             ownerSignature: signature,
//             ownerPublicKey: this.user(userIndex).publicKey,
//         });

//         const output = await CreateVaultIntent.rawMethods.createVault(publicInput, privateInput);

//         const dummyProof = await CreateVaultIntentProof.dummy(
//             publicInput,
//             output.publicOutput,
//             0,
//         );

//         const intentProof: IntentProof = {
//             kind: 'create-vault',
//             proof: dummyProof,
//         };

//         // extract input commitment and store the proof
//         this._events.pushIntentViaProof(intentProof);
//         this.data.storeIntentProof(intentProof);
//         this._items.push('create-vault');
//     }

// }

// export class InitialState {

//     constructor(public readonly vaultMap: VaultMap, public readonly zkUsdMap: ZkUsdMap) {
//     }

//     public get state(): ZkUsdState {
//         return ZkUsdState.new({
//             vaultMap: this.vaultMap,
//             zkUsdMap: this.zkUsdMap,
//         });
//     }

//     static empty(): InitialState {
//         return new InitialState(new VaultMap(), new ZkUsdMap());
//     }

// }

// export class LogProcessor implements StateProcessorLog {
//     private readonly _items: string[] = [];
//     public get items(): string[] { return this._items; }
//     public push(item: string): void { this._items.push(item); }
//     public toString(tail: number=0): string {
//         return this._items.slice(-tail).join('\n');
//     }
// }

// export class StateComputeSimulator {
//     private _stateComputer: OptimisticStateComputer;
//     // TODO get rid of this
//     private _tempMapProvider: MapProvider;
//     private _zkusdState: ZkUsdState;

//     public intentVaultMap(): Promise<VaultMap> {
//         if(!this.currentStateComputer){
//             return this._tempMapProvider.vaultMap();
//        }
//         else{
//             return Promise.resolve(this.currentStateComputer.intentVaultMap);
//         }
//     }

//     public intentZkUsdMap(): Promise<ZkUsdMap> {
//         if(!this.currentStateComputer){
//             return this._tempMapProvider.zkUsdMap();
//         }
//         else{
//             return Promise.resolve(this.currentStateComputer.intentZkUsdMap);
//        }
//     }

//     public get currentStateComputer(): OptimisticStateComputer {
//         return this._stateComputer;
//     }

//     public get zkusdState(): Promise<ZkUsdState> {
//         if(!this.currentStateComputer){
//             return Promise.resolve(this._zkusdState);
//         }
//         return this._stateComputer.zkusdState;
//     }

//     constructor(initialState: InitialState) {
//         this._tempMapProvider = new MapProviderImpl(
//             async () => initialState.vaultMap,
//             async () => initialState.zkUsdMap
//         );
//         this._zkusdState = initialState.state;
//     }

//     public async simulateScenario(initialState: InitialState, scenario: Scenario, steps: number=1): Promise<void> {

//         const log = new LogProcessor();

//         const stateProcessor = new OptimisticStateProcessor(
//             log,
//             scenario.data,
//             new InMemoryZkusdStateManager(initialState.state),
//             initialState.vaultMap,
//             initialState.zkUsdMap
//         );

//         this._stateComputer = new OptimisticStateComputer(
//             scenario.events,
//             stateProcessor,
//             new MockStatePublisher()
//         );

//         console.log('Simulating scenario:');
//         console.log(scenario.toString());

//         await this._stateComputer.step(steps);
//     }

// }
