

export interface StateProcessorLogReader {
  get items(): string[];
  toString(tail?: number): string;
}
export interface StateProcessorLog extends StateProcessorLogReader {
  push(item: string): void;
}
