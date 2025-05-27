import { OptimisticState } from "./optimistic-types.js";


export interface StatePublisher {
  publishComputedState(state: OptimisticState): Promise<void>;
}

export class MockStatePublisher implements StatePublisher {

  public publishedStates: OptimisticState[] = [];
    
  publishComputedState(state: OptimisticState): Promise<void> {
    this.publishedStates.push(state);
    return Promise.resolve();
  }
}
