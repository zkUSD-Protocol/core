import {
  ITransactionProver,
  TxProvingInput,
  TxProvingOutput,
} from './itransactionprover.js';


type TxProvingRequest = {
  payload: TxProvingInput;
};

type TxProvingResponse = {
  result: TxProvingOutput;
};

/**
 * Provides proving service by requesting proving
 * at given HTTP endpoint.
 */
export class HttpClientProver implements ITransactionProver {
  private readonly endpointUrl: string;

  /**
   * @param endpointUrl - The HTTP endpoint that accepts a TxProvingRequest and returns a TxProvingResponse.
   */
  constructor(endpointUrl: string) {
    this.endpointUrl = endpointUrl;
  }

  public async start() {}

  /**
   * Sends the input to the HTTP endpoint for proving and returns the result.
   *
   * @param input - The transaction proving input.
   * @returns The transaction proving output.
   * @throws Error if the request fails (network error or non-OK HTTP status)
   *        or if the response is invalid JSON.
   */
  public async proveTransaction(
    input: TxProvingInput
  ): Promise<TxProvingOutput> {
    // Prepare request body
    const requestBody: TxProvingRequest = {
      payload: input,
    };

    let response: Response;
    try {
      // Perform the POST request with JSON
      response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        // Stringify the potentially large object; be mindful of memory usage.
        body: JSON.stringify(requestBody),
      });
    } catch (networkError: unknown) {
      // This catch handles low-level network failures (e.g. no connection).
      const message =
        networkError instanceof Error
          ? networkError.message
          : String(networkError);
      throw new Error(
        `Network error while trying to prove transaction: ${message}`
      );
    }

    // Check for non-OK status codes
    if (!response.ok) {
      let errorBody = '';
      try {
        // Attempt to read any error details from the response
        errorBody = await response.text();
      } catch (readError) {
        errorBody = `Unable to read error details: ${
          readError instanceof Error ? readError.message : String(readError)
        }`;
      }

      throw new Error(
        `Server responded with an error:
         HTTP ${response.status} - ${response.statusText}.
         Response body: ${errorBody}`
      );
    }

    // Attempt to parse the response as JSON
    let provingResponse: TxProvingResponse;
    try {
      provingResponse = (await response.json()) as TxProvingResponse;
    } catch (parseError: unknown) {
      const message =
        parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(`Failed to parse server response as JSON: ${message}`);
    }

    // Return the result from the TxProvingResponse
    return provingResponse.result;
  }

  public async shutdown(): Promise<void> {}
}
