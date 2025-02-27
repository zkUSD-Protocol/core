// /**
//  * 1) Declare your transaction phases.
//  */
// export enum TransactionPhase {
//   INITIAL = 'INITIAL',
//   AWAITING_FOR_OTHER_TXS = 'AWAITING_FOR_OTHER_TXS',
//   BUILDING = 'BUILDING',
//   SIGNING = 'SIGNING',
//   SENDING = 'SENDING',
//   PENDING_INCLUSION = 'PENDING_INCLUSION',
//   INCLUDED = 'INCLUDED',
// }

// /**
//  * 2) Status categories for each phase.
//  */
// export type TransactionPhaseStatus =
//   | 'IN_PROGRESS'
//   | 'SUCCESS'
//   | 'FAILED'
//   | 'EXCEPTION';

// /**
//  * 3) Artifacts & error types, each phase with its own definitions.
//  *    Customize these interfaces as needed.
//  */
// export interface InitialArtifacts {
//   initializedPayload: string;
// }
// export interface InitialError {
//   reason: string; // e.g. "Invalid setup"
// }

// export interface AwaitingArtifacts {
//   waitingForTxCount: number;
// }
// export interface AwaitingError {
//   reason: string; // e.g. "Timed out"
// }

// export interface BuildingArtifacts {
//   buildInfo: string;
// }
// export interface BuildingError {
//   reason: string; // e.g. "Parse failure"
// }

// export interface SigningArtifacts {
//   signatureRequestId: string;
// }
// export interface SigningError {
//   reason: string; // e.g. "User canceled"
// }

// export interface SendingArtifacts {
//   txHash?: string;
// }
// export interface SendingError {
//   reason: string; // e.g. "Network error"
// }

// export interface PendingInclusionArtifacts {
//   blockHeight?: number;
// }
// export interface PendingInclusionError {
//   reason: string; // e.g. "Tx not found in block"
// }

// export interface IncludedArtifacts {
//   finalReceipt: any; // replace `any` with your real receipt type
// }
// export interface IncludedError {
//   reason: string; // typically wouldn't fail if included, but placeholder
// }

// /**
//  * 4) A mapping from phase -> (Artifacts, Error).
//  */
// interface PhaseArtifactsAndErrorMap {
//   [TransactionPhase.INITIAL]: {
//     artifacts: InitialArtifacts;
//     error: InitialError;
//   };
//   [TransactionPhase.AWAITING_FOR_OTHER_TXS]: {
//     artifacts: AwaitingArtifacts;
//     error: AwaitingError;
//   };
//   [TransactionPhase.BUILDING]: {
//     artifacts: BuildingArtifacts;
//     error: BuildingError;
//   };
//   [TransactionPhase.SIGNING]: {
//     artifacts: SigningArtifacts;
//     error: SigningError;
//   };
//   [TransactionPhase.SENDING]: {
//     artifacts: SendingArtifacts;
//     error: SendingError;
//   };
//   [TransactionPhase.PENDING_INCLUSION]: {
//     artifacts: PendingInclusionArtifacts;
//     error: PendingInclusionError;
//   };
//   [TransactionPhase.INCLUDED]: {
//     artifacts: IncludedArtifacts;
//     error: IncludedError;
//   };
// }

// /**
//  * 5) Union type describing a single phase's shape for each status.
//  */
// type PhaseStatus<P extends TransactionPhase> =
//   | {
//       phase: P;
//       status: 'IN_PROGRESS';
//       artifacts: Partial<PhaseArtifactsAndErrorMap[P]['artifacts']>;
//     }
//   | {
//       phase: P;
//       status: 'SUCCESS';
//       artifacts: PhaseArtifactsAndErrorMap[P]['artifacts'];
//     }
//   | {
//       phase: P;
//       status: 'FAILED';
//       artifacts: Partial<PhaseArtifactsAndErrorMap[P]['artifacts']>;
//       typedError?: PhaseArtifactsAndErrorMap[P]['error'];
//       rawErrors?: any[];
//     }
//   | {
//       phase: P;
//       status: 'EXCEPTION';
//       artifacts: Partial<PhaseArtifactsAndErrorMap[P]['artifacts']>;
//       rawErrors?: any[];
//     };

// /**
//  * 6) The complete TransactionStatus union for all phases.
//  */
// export type TransactionStatus =
//   | PhaseStatus<TransactionPhase.INITIAL>
//   | PhaseStatus<TransactionPhase.AWAITING_FOR_OTHER_TXS>
//   | PhaseStatus<TransactionPhase.BUILDING>
//   | PhaseStatus<TransactionPhase.SIGNING>
//   | PhaseStatus<TransactionPhase.SENDING>
//   | PhaseStatus<TransactionPhase.PENDING_INCLUSION>
//   | PhaseStatus<TransactionPhase.INCLUDED>;

// /**
//  * Helper: narrow the current status to the same phase if it matches,
//  * otherwise return undefined.
//  */
// function narrowToPhase<P extends TransactionPhase>(
//   status: TransactionStatus,
//   phase: P
// ): PhaseStatus<P> | undefined {
//   return status.phase === phase
//     ? (status as PhaseStatus<P>)
//     : undefined;
// }

// /**
//  * 7) Define the interface for each "phase sub-API" with the
//  *    user-friendly methods you described.
//  */
// export interface IPhaseLifecycleApi<P extends TransactionPhase> {
//   /**
//    * Move into IN_PROGRESS with empty or minimal artifacts.
//    */
//   start(): void;

//   /**
//    * Accumulate raw errors in a "FAILED" state. If the transaction is
//    * already in "FAILED" or "EXCEPTION" (same phase), it merges them in.
//    * Otherwise, forcibly sets it to "FAILED" with partial artifacts.
//    */
//   addRawErrors(...rawErrors: any[]): void;

//   /**
//    * Add a typed error in a "FAILED" state.
//    */
//   addError(typedError: PhaseArtifactsAndErrorMap[P]['error']): void;

//   /**
//    * Update (merge) the partial artifacts in whatever the current status is
//    * (if the phase is different, it re-phases to P in an IN_PROGRESS state).
//    *
//    * The caller provides a function that receives the current partial artifacts
//    * and returns new partial artifacts.
//    */
//   artifacts(
//     updater: (
//       current: Partial<PhaseArtifactsAndErrorMap[P]['artifacts']>
//     ) => Partial<PhaseArtifactsAndErrorMap[P]['artifacts']>
//   ): void;

//   /**
//    * Move into EXCEPTION with raw errors. If already in EXCEPTION in this phase,
//    * merges them. Otherwise forcibly sets EXCEPTION with partial artifacts.
//    */
//   exception(...rawErrors: any[]): void;

//   /**
//    * Move into SUCCESS with final artifacts. The caller can produce
//    * the final artifacts from the existing partial.
//    */
//   success(
//     finalizer: (
//       current: Partial<PhaseArtifactsAndErrorMap[P]['artifacts']>
//     ) => PhaseArtifactsAndErrorMap[P]['artifacts']
//   ): void;
// }

// /**
//  * 8) Implementation of the phase sub-API.
//  *    We read from getStatus() & write with setStatus() each time.
//  */
// class PhaseLifecycleApi<P extends TransactionPhase>
//   implements IPhaseLifecycleApi<P>
// {
//   constructor(
//     private phase: P,
//     private getStatus: () => TransactionStatus,
//     private setStatus: (newStatus: TransactionStatus) => void
//   ) {}

//   public start(): void {
//     // Force an IN_PROGRESS with empty artifacts
//     this.setStatus({
//       phase: this.phase,
//       status: 'IN_PROGRESS',
//       artifacts: {},
//     });
//   }

//   public addRawErrors(...rawErrors: any[]): void {
//     const current = this.getOrRephaseToInProgress();
//     if (current.status === 'FAILED' || current.status === 'EXCEPTION') {
//       // Merge new rawErrors
//       const mergedRaw = [...(current.rawErrors ?? []), ...rawErrors];
//       this.setStatus({
//         ...current,
//         rawErrors: mergedRaw,
//       });
//     } else {
//       // Move to FAILED
//       this.setStatus({
//         phase: this.phase,
//         status: 'FAILED',
//         artifacts: current.artifacts,
//         rawErrors: rawErrors,
//       });
//     }
//   }

//   public addError(typedError: PhaseArtifactsAndErrorMap[P]['error']): void {
//     const current = this.getOrRephaseToInProgress();
//     if (current.status === 'FAILED') {
//       // Merge typed error
//       this.setStatus({
//         ...current,
//         typedError,
//       });
//     } else if (current.status === 'EXCEPTION') {
//       // If we are in EXCEPTION, let's unify it with a "FAILED" concept or remain EXCEPTION
//       // Depending on your design. Let's do forcibly FAILED for typedError:
//       this.setStatus({
//         phase: this.phase,
//         status: 'FAILED',
//         artifacts: current.artifacts,
//         typedError,
//         rawErrors: current.rawErrors,
//       });
//     } else {
//       // Move to FAILED with typed error
//       this.setStatus({
//         phase: this.phase,
//         status: 'FAILED',
//         artifacts: current.artifacts,
//         typedError,
//       });
//     }
//   }

//   public artifacts(
//     updater: (
//       current: Partial<PhaseArtifactsAndErrorMap[P]['artifacts']>
//     ) => Partial<PhaseArtifactsAndErrorMap[P]['artifacts']>
//   ): void {
//     const current = this.getOrRephaseToInProgress();
//     const newArtifacts = updater(current.artifacts);
//     this.setStatus({
//       ...current,
//       artifacts: newArtifacts,
//     });
//   }

//   public exception(...rawErrors: any[]): void {
//     const current = this.getOrRephaseToInProgress();
//     if (current.status === 'EXCEPTION') {
//       // Merge
//       const mergedRaw = [...(current.rawErrors ?? []), ...rawErrors];
//       this.setStatus({
//         ...current,
//         rawErrors: mergedRaw,
//       });
//     } else {
//       this.setStatus({
//         phase: this.phase,
//         status: 'EXCEPTION',
//         artifacts: current.artifacts,
//         rawErrors,
//       });
//     }
//   }

//   public success(
//     finalizer: (
//       current: Partial<PhaseArtifactsAndErrorMap[P]['artifacts']>
//     ) => PhaseArtifactsAndErrorMap[P]['artifacts']
//   ): void {
//     const current = this.getOrRephaseToInProgress();
//     this.setStatus({
//       phase: this.phase,
//       status: 'SUCCESS',
//       artifacts: finalizer(current.artifacts),
//     });
//   }

//   /**
//    * Utility: If the current status is *already* this phase, return it.
//    * Otherwise, re-phase to this phase in an IN_PROGRESS state with empty artifacts.
//    *
//    * That means we do *not* enforce transitions; we "snap" to the new phase if different.
//    */
//   private getOrRephaseToInProgress(): PhaseStatus<P> {
//     const s = this.getStatus();
//     const narrowed = narrowToPhase(s, this.phase);
//     if (!narrowed) {
//       // Different phase, so let's forcibly set to IN_PROGRESS with empty artifacts
//       const newStatus: PhaseStatus<P> = {
//         phase: this.phase,
//         status: 'IN_PROGRESS',
//         artifacts: {},
//       };
//       this.setStatus(newStatus);
//       return newStatus;
//     }
//     return narrowed;
//   }
// }

// /**
//  * 9) A single class that exposes sub-APIs for each fixed phase.
//  *    They all share the same `getStatus` / `setStatus`.
//  */
// export class TransactionLifecycleApi {
//   public readonly INITIAL: IPhaseLifecycleApi<TransactionPhase.INITIAL>;
//   public readonly AWAITING_FOR_OTHER_TXS: IPhaseLifecycleApi<TransactionPhase.AWAITING_FOR_OTHER_TXS>;
//   public readonly BUILDING: IPhaseLifecycleApi<TransactionPhase.BUILDING>;
//   public readonly SIGNING: IPhaseLifecycleApi<TransactionPhase.SIGNING>;
//   public readonly SENDING: IPhaseLifecycleApi<TransactionPhase.SENDING>;
//   public readonly PENDING_INCLUSION: IPhaseLifecycleApi<TransactionPhase.PENDING_INCLUSION>;
//   public readonly INCLUDED: IPhaseLifecycleApi<TransactionPhase.INCLUDED>;

//   constructor(
//     private getStatus: () => TransactionStatus,
//     private setStatus: (status: TransactionStatus) => void
//   ) {
//     // Create each sub-API with the relevant phase
//     this.INITIAL = new PhaseLifecycleApi(TransactionPhase.INITIAL, getStatus, setStatus);
//     this.AWAITING_FOR_OTHER_TXS = new PhaseLifecycleApi(
//       TransactionPhase.AWAITING_FOR_OTHER_TXS,
//       getStatus,
//       setStatus
//     );
//     this.BUILDING = new PhaseLifecycleApi(
//       TransactionPhase.BUILDING,
//       getStatus,
//       setStatus
//     );
//     this.SIGNING = new PhaseLifecycleApi(
//       TransactionPhase.SIGNING,
//       getStatus,
//       setStatus
//     );
//     this.SENDING = new PhaseLifecycleApi(
//       TransactionPhase.SENDING,
//       getStatus,
//       setStatus
//     );
//     this.PENDING_INCLUSION = new PhaseLifecycleApi(
//       TransactionPhase.PENDING_INCLUSION,
//       getStatus,
//       setStatus
//     );
//     this.INCLUDED = new PhaseLifecycleApi(
//       TransactionPhase.INCLUDED,
//       getStatus,
//       setStatus
//     );
//   }
// }


// const usageExample = () => {
// // Suppose we store the current status in a variable:
// let currentStatus: TransactionStatus = {
//   phase: TransactionPhase.INITIAL,
//   status: 'IN_PROGRESS',
//   artifacts: {},
// };

// // Implementation of getStatus / setStatus:
// function getStatus(): TransactionStatus {
//   return currentStatus;
// }
// function setStatus(newStatus: TransactionStatus): void {
//   currentStatus = newStatus;
//   console.log('New transaction status:', newStatus);
// }

// // Create the LifecycleApi instance:
// const lifecycleApi = new TransactionLifecycleApi(getStatus, setStatus);

// /**
//  * Workflow example:
//  */
// lifecycleApi.INITIAL.start();
// // => sets { phase: 'INITIAL', status: 'IN_PROGRESS', artifacts: {} }

// lifecycleApi.INITIAL.artifacts(current => ({
//   ...current,
//   initializedPayload: 'bootstrap data'
// }));
// /*
//    => sets {
//         phase: 'INITIAL',
//         status: 'IN_PROGRESS',
//         artifacts: { initializedPayload: 'bootstrap data' }
//       }
// */

// lifecycleApi.BUILDING.start();
// /*
//    => forcibly transitions to BUILDING phase,
//       status = 'IN_PROGRESS',
//       artifacts = {}
// */

// lifecycleApi.BUILDING.artifacts(current => ({
//   ...current,
//   buildInfo: 'Drafting the transaction...'
// }));
// /*
//    => updates artifacts in BUILDING phase
// */

// lifecycleApi.BUILDING.addError({ reason: 'Bad formatting' });
// /*
//    => sets {
//         phase: 'BUILDING',
//         status: 'FAILED',
//         artifacts: { buildInfo: 'Drafting the transaction...' },
//         typedError: { reason: 'Bad formatting' }
//       }
// */

// // We can still fix it:
// lifecycleApi.BUILDING.artifacts(current => ({
//   ...current,
//   buildInfo: 'Fixed formatting'
// }));
// /*
//    => updates partial artifacts,
//       still { status: 'FAILED' }
//    (The code here doesn't automatically revert to IN_PROGRESS;
//     you'd have to explicitly do so if desired, or proceed anyway.)
// */

// // Let's forcibly override by calling "start" again:
// lifecycleApi.BUILDING.start();
// /*
//    => now sets {
//         phase: 'BUILDING',
//         status: 'IN_PROGRESS',
//         artifacts: {}
//       }
// */

// lifecycleApi.BUILDING.artifacts(current => ({
//   buildInfo: 'Now correct transaction data!',
// }));

// lifecycleApi.BUILDING.success(current => ({
//   ...current,
//   buildInfo: current.buildInfo + ' [BUILD DONE]',
// }));
// /*
//    => sets {
//         phase: 'BUILDING',
//         status: 'SUCCESS',
//         artifacts: { buildInfo: 'Now correct transaction data! [BUILD DONE]' }
//       }
// */

// // Next phase:
// lifecycleApi.SENDING.start();
// /*
//    => sets {
//         phase: 'SENDING',
//         status: 'IN_PROGRESS',
//         artifacts: {}
//       }
// */

// // If a network error occurs:
// lifecycleApi.SENDING.addRawErrors(new Error('Network glitch'));
// /*
//    => sets {
//         phase: 'SENDING',
//         status: 'FAILED',
//         artifacts: {},
//         rawErrors: [Error('Network glitch')]
//       }
// */

// // Or maybe an exception:
// lifecycleApi.SENDING.exception('Something unexpected');
// /*
//    => sets {
//         phase: 'SENDING',
//         status: 'EXCEPTION',
//         artifacts: {},
//         rawErrors: ['Something unexpected']
//       }
// */

// }
