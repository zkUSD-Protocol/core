import { ZkUsdState } from "./data/state.js";
import { VaultMap } from "./data/vault-map.js";
import { ZkUsdMap } from "./data/zkusd-map.js";
import { MockStateEventQueue, StateEventQueue } from "./rollup-state-event-queue.js";
import { RollupDataProvider } from "./rollup-data-provider.js";
import { RollupDataProviderImpl } from "./rollup-data-provider.js";
import { InMemoryZkusdStateManager, OptimisticStateComputer, OptimisticStateProcessor } from "./optimistic.js";
import { MockStatePublisher } from "./rollup-state-publisher.js";
import { StateProcessorLog } from "./optimistic-types.js";
import { KeyPair } from "../../types/utility.js";
import { PrivateKey, Signature, UInt8 } from "o1js";
import { CreateVaultIntent, CreateVaultIntentInput, CreateVaultIntentKey, CreateVaultIntentProof, CreateVaultPrivateInput } from "./programs/intents/create-vault.js";
import { Field } from "o1js";
import { AnyIntentProof } from "./types/intent-proof.js";
import { Proof } from "o1js/dist/node/lib/proof-system/circuit.js";


interface MapProvider{
    vaultMap(): Promise<VaultMap>;
    zkUsdMap(): Promise<ZkUsdMap>;
}

export class MapProviderImpl implements MapProvider {
    
    constructor(
     private readonly _getVaultMap: () => Promise<VaultMap>,
     private readonly _getZkUsdMap: () => Promise<ZkUsdMap>){}
    
    vaultMap(): Promise<VaultMap> {
        return this._getVaultMap();
    }
    zkUsdMap(): Promise<ZkUsdMap> {
        return this._getZkUsdMap();
    }
}

export class Scenario {
    
    private readonly _items: string[] = [];

    public get items(): string[] {
        return [...this._items];
    }

    private readonly _events: MockStateEventQueue;
    private readonly _data: RollupDataProvider;
    private readonly _mapProvider: MapProvider;

    private readonly _users: KeyPair[] = [];

    public user(index: number): KeyPair {
        // if user underflows, create a new one
        if (index >= this._users.length) {
            this._users.push(PrivateKey.randomKeypair());
        }
        return this._users[index];
    }

    constructor(mapProvider: MapProvider) {
        this._events = new MockStateEventQueue();
        this._data = RollupDataProviderImpl.create();
        this._mapProvider = mapProvider;
}

    get events(): StateEventQueue {
        return this._events;
    }

    get data(): RollupDataProvider {
        return this._data;
    }

    async addEpochEnd(): Promise<void> {
        this._events.pushEpochEnd();
        this._items.push('epoch-end');
    }

    public toString(): string {
        return "Scenario with:\n" + this._items.join('\n');
    }

    async addCreateVaultIntent(userIndex: number): Promise<void> {
        
        const vaultMap = await this._mapProvider.vaultMap();
        
        const type = UInt8.from(0);
        const message: Field[] = [
          vaultMap.root,
          type.value,
          CreateVaultIntentKey,
        ];

        const signature = Signature.create(this.user(userIndex).privateKey, message);
        
        const publicInput = new CreateVaultIntentInput({
            vaultMapRoot: vaultMap.root,
        });

        const privateInput = new CreateVaultPrivateInput({
            vaultMap,
            type,
            ownerSignature: signature,
            ownerPublicKey: this.user(userIndex).publicKey,
        });

        const output = await CreateVaultIntent.rawMethods.createVault(publicInput, privateInput);
        
        const dummyProof = await CreateVaultIntentProof.dummy(
            publicInput,
            output.publicOutput,
            0,
        );

        const intentProof: AnyIntentProof = {
            kind: 'create-vault',
            proof: dummyProof,
        };
        
        // extract input commitment and store the proof
        this._events.pushIntentViaProof(intentProof);
        this.data.storeIntentProof(intentProof);
        this._items.push('create-vault');
    }
    
}

export class InitialState {

    constructor(public readonly vaultMap: VaultMap, public readonly zkUsdMap: ZkUsdMap) {
    }

    public get state(): ZkUsdState {
        return ZkUsdState.new({
            vaultMap: this.vaultMap,
            zkUsdMap: this.zkUsdMap,
        });
    }

    static empty(): InitialState {
        return new InitialState(new VaultMap(), new ZkUsdMap());
    }

}

export class LogProcessor implements StateProcessorLog {
    private readonly _items: string[] = [];
    public get items(): string[] { return this._items; }
    public push(item: string): void { this._items.push(item); }
    public toString(tail: number=0): string {
        return this._items.slice(-tail).join('\n');
    }
}

export class StateComputeSimulator {
    private _stateComputer: OptimisticStateComputer;
    // TODO get rid of this
    private _tempMapProvider: MapProvider;

    public intentVaultMap(): Promise<VaultMap> {
        if(!this.currentStateComputer){
            return this._tempMapProvider.vaultMap();
       }
        else{
            return Promise.resolve(this.currentStateComputer.intentVaultMap);
        }
    }   
    
    public intentZkUsdMap(): Promise<ZkUsdMap> {
        if(!this.currentStateComputer){
            return this._tempMapProvider.zkUsdMap();
        }
        else{
            return Promise.resolve(this.currentStateComputer.intentZkUsdMap);
       }
    }   
    
    public get currentStateComputer(): OptimisticStateComputer {
        return this._stateComputer;
    }

    constructor(initialState: InitialState) {
        this._tempMapProvider = new MapProviderImpl(
            async () => initialState.vaultMap,
            async () => initialState.zkUsdMap
        );
    }

    public async simulateScenario(initialState: InitialState, scenario: Scenario, steps: number=1): Promise<void> {

        const log = new LogProcessor();

        const stateProcessor = new OptimisticStateProcessor(
            log,
            scenario.data,
            new InMemoryZkusdStateManager(initialState.state),
            initialState.vaultMap,
            initialState.zkUsdMap
        );

        this._stateComputer = new OptimisticStateComputer(
            scenario.events,
            stateProcessor,
            new MockStatePublisher()
        );

        console.log('Simulating scenario:');
        console.log(scenario.toString());

        await this._stateComputer.step(steps);
    }
    
}

