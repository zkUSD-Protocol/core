

/*

the interface should be one that allows to provide minimal data inputs
the rest is random or mocked.

the proofs should not be built if they can be provided from hash


*/

import { RollupDataProvider, RollupDataProviderImpl } from "./rollup-data-provider.js";
import { MockStateEventQueue, StateEventQueue } from "./rollup-state-event-queue.js";

export class MockDataSource {
    private _stateEventQueue: StateEventQueue;
    private _rollupDataProvider: RollupDataProvider;


    
    get stateEventQueue(): StateEventQueue {
        return this._stateEventQueue;
    }

    
    private constructor() {
        this._stateEventQueue = new MockStateEventQueue();
        this._rollupDataProvider = RollupDataProviderImpl.create();
    }

    static create(): MockDataSource {
        return new MockDataSource();
    }

}

export { MockStateEventQueue };

