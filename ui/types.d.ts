declare global {
  interface SendPaymentArgs {
    readonly to: string;
    readonly amount: number;
    readonly fee?: number;
    readonly memo?: string;
  }

  interface SendStakeDelegationArgs {
    readonly to: string;
    readonly fee?: number;
    readonly memo?: string;
  }

  interface SendTransactionArgs {
    readonly onlySign?: boolean;
    readonly nonce?: number;
    readonly transaction: string | object;
    readonly feePayer?: {
      readonly fee?: number;
      readonly memo?: string;
    };
  }

  interface SendTransactionHash {
    hash: string;
  }

  interface SignedZkappCommand {
    signedData: string;
  }

  interface ProviderError extends Error {
    message: string;
    code: number;
    data?: unknown;
  }

  interface ChainInfoArgs {
    networkID: string;
  }

  interface AddChainArgs {
    readonly url: string;
    readonly name: string;
  }

  interface SwitchChainArgs {
    readonly networkID: string;
  }

  interface Group {
    x: bigint;
    y: bigint;
  }

  interface Nullifier {
    publicKey: Group;
    public: {
      nullifier: Group;
      s: bigint;
    };
    private: {
      c: bigint;
      g_r: Group;
      h_m_pk_r: Group;
    };
  }

  interface CreateNullifierArgs {
    readonly message: (string | number)[];
  }

  interface SignMessageArgs {
    readonly message: string;
  }

  interface JsonMessageData {
    label: string;
    value: string;
  }

  interface SignJsonMessageArgs {
    readonly message: Array<JsonMessageData>;
  }

  interface SignedData {
    publicKey: string;
    data: string;
    signature: {
      field: string;
      scalar: string;
    };
  }

  interface VerifyMessageArgs {
    publicKey: string;
    data: string;
    signature: {
      field: string;
      scalar: string;
    };
  }

  interface SignFieldsArguments {
    readonly message: (string | number)[];
  }

  interface SignedFieldsData {
    data: (string | number)[];
    signature: string;
    publicKey: string;
  }

  interface VerifyFieldsArguments {
    publicKey: string;
    data: (string | number)[];
    signature: string;
  }

  type SendZkTransactionResult = SendTransactionHash | SignedZkappCommand;

  interface MinaWindow {
    // Existing methods...
    addChain(args: AddChainArgs): Promise<ChainInfoArgs | ProviderError>;
    switchChain(args: SwitchChainArgs): Promise<ChainInfoArgs | ProviderError>;
    createNullifier(
      args: CreateNullifierArgs
    ): Promise<Nullifier | ProviderError>;
    signMessage(args: SignMessageArgs): Promise<SignedData | ProviderError>;
    signJsonMessage(
      args: SignJsonMessageArgs
    ): Promise<SignedData | ProviderError>;
    verifyMessage(args: VerifyMessageArgs): Promise<boolean | ProviderError>;
    signFields(
      args: SignFieldsArguments
    ): Promise<SignedFieldsData | ProviderError>;
    verifyFields(args: VerifyFieldsArguments): Promise<boolean | ProviderError>;
    requestAccounts(): Promise<string[] | ProviderError>;
    getAccounts(): Promise<string[]>;
    requestNetwork(): Promise<ChainInfoArgs>;
    sendPayment(
      args: SendPaymentArgs
    ): Promise<SendTransactionHash | ProviderError>;
    sendStakeDelegation(
      args: SendStakeDelegationArgs
    ): Promise<SendTransactionHash | ProviderError>;
    sendTransaction(
      args: SendTransactionArgs
    ): Promise<SendZkTransactionResult | ProviderError>;
  }

  interface Window {
    mina?: MinaWindow;
  }
}

export {};
