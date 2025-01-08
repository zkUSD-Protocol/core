declare global {
  interface Window {
    mina?: {
      requestAccounts(): Promise<string[]>;
    };
  }
}

export {};
