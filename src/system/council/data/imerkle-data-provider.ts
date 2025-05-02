export interface IMerkleDataProvider<T> {
  /** Returns the current instance of the Merkle structure.
      It is responsible to make sure that the data is matching the
      onchain root.
  */
  get(): Promise<T>;
}
