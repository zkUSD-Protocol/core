import fetch, { Response } from 'node-fetch';
import { PublicKey } from 'o1js';
import { ZkappCommand } from 'o1js/dist/node/mina-signer/src/types.js';

/**
 * Represents errors returned by a GraphQL endpoint.
 */
interface GraphQLError {
  message: string;
  locations?: { line: number; column: number }[];
  path?: (string | number)[];
  extensions?: Record<string, unknown>;
}

/**
 * Represents the shape of a full GraphQL response.
 */
interface GraphQLResponse<TData> {
  data?: TData;
  errors?: GraphQLError[];
}

/**
 * Utility type describing a typed GraphQL operation.
 * - TData:    The expected data shape returned by the server
 * - TVariables: The shape of any variables we need to pass
 */
interface GqlQuery<_TData, _TVariables> {
  query: string;
  operationName: string;
}

/**
 * Utility type describing a typed GraphQL operation.
 * - TData:    The expected data shape returned by the server
 * - TVariables: The shape of any variables we need to pass
 */
interface GqlQueryCall<TData, TVariables> {
  query: GqlQuery<TData, TVariables>;
  variables: TVariables;
}

/**
 * Utility to infer the response data type from a GqlQuery.
 */
type GqlData<T> = T extends GqlQuery<infer TData, any> ? TData : never;

/**
 * Utility to infer the variables type from a GqlQuery.
 */
type GqlVars<T> = T extends GqlQuery<any, infer TVariables>
  ? TVariables
  : never;

/**
 * A generic GraphQL fetch function that knows how to handle typed queries.
 * Uses type inference to make the API cleaner and more concise.
 */
async function queryGraphQL<T extends GqlQuery<any, any>>(
  queryCall: GqlQueryCall<GqlData<T>, GqlVars<T>>,
  url: string
): Promise<GqlData<T>> {
  //console.log(
  //   `DEBUG: Starting GraphQL request for operation: ${queryCall.query.operationName}`
  // );
  //console.log("DEBUG: Request payload:", JSON.stringify({
  //   query: queryCall.query.query,
  //   operationName: queryCall.query.operationName,
  //   variables: queryCall.variables,
  // }, null, 2));

  const response: Response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: queryCall.query.query,
      operationName: queryCall.query.operationName,
      variables: queryCall.variables,
    }),
  });

  //console.log("DEBUG: HTTP response status:", response.status);
  // Log response headers (useful for debugging gateway errors)
  //console.log("DEBUG: HTTP response headers:", JSON.stringify(response.headers.raw(), null, 2));

  // Read and log the raw response text so we can see HTML error pages if any.
  const responseText = await response.text();
  //console.log("DEBUG: Raw response text:", responseText);

  let json: GraphQLResponse<GqlData<T>>;
  try {
    json = JSON.parse(responseText);
  } catch (err) {
    console.error("DEBUG: Failed to parse JSON response:", err);
    throw new Error(`Invalid JSON response: ${responseText}`);
  }

  if (json.errors && json.errors.length > 0) {
    console.error("DEBUG: GraphQL errors:", JSON.stringify(json.errors, null, 2));
    throw new Error(JSON.stringify(json.errors, null, 2));
  }

  //console.log("DEBUG: GraphQL response data:", JSON.stringify(json.data, null, 2));
  return json.data!;
}

// --------------------------------------------------------------------------

/**
 * The shape of data we expect back for "PooledNoncesQuery".
 */
interface PooledNoncesQueryResponse {
  version: string;
  pooledZkappCommands: Array<{
    zkappCommand: {
      feePayer: {
        body: {
          nonce: bigint;
        };
      };
    };
  }>;
  pooledUserCommands: Array<{
    feePayer: {
      nonce: bigint;
      tokenId: string;
    };
  }>;
}

/**
 * The shape of data we expect back for "TransactionStatuses".
 */
interface TransactionStatusesQueryResponse {
  version: string;
  bestChain: Array<{
    transactions: {
      zkappCommands: Array<{
        hash: string;
        failureReason: {
          failures: Array<unknown>;
        };
      }>;
      userCommands: Array<{
        hash: string;
        failureReason: unknown;
      }>;
    };
  }>;
}

/**
 * Constructs a typed query definition for fetching pooled nonces.
 *
 * @param variables - The public key to use in the query
 */
function mkPooledNoncesQuery(variables: {
  pubkey: PublicKey;
}): GqlQueryCall<PooledNoncesQueryResponse, { pubkey: PublicKey }> {
  const pk = variables.pubkey.toBase58();
  const operationName = `PooledNoncesQuery_${pk}`;
  const query = {
    operationName,
    query: `
query ${operationName}($pubkey: PublicKey) {
    version
    pooledZkappCommands(publicKey: $pubkey) {
      zkappCommand {
        feePayer {
          body {
            nonce
          }
        }
      }
    }
    pooledUserCommands(publicKey: $pubkey) {
      feePayer {
        nonce
        tokenId
      }
    }
  }`,
  };
  return { query, variables };
}

/**
 * Constructs a typed query definition for fetching transaction statuses.
 *
 * @param variables - The number of blocks to query
 */
function mkTransactionStatusesQuery(variables: {
  lastBlocks: number;
}): GqlQueryCall<TransactionStatusesQueryResponse, { lastBlocks: number }> {
  const operationName = 'TransactionStatusQuery';
  const query = {
    operationName,
    query: `
      query ${operationName}($lastBlocks: Int!) {
        version
        bestChain(maxLength: $lastBlocks) {
          transactions {
            zkappCommands {
              hash
              failureReason {
                failures
                index
              }
            }
          }
        }
      }
    `,
  };
  return { query, variables };
}

/**
 * The expected shape of the response from the sendZkapp mutation.
 */
interface SendZkAppMutationResponse {
  sendZkapp: {
    zkapp: {
      hash: string;
      id: string;
      zkappCommand: {
        memo: string;
      };
    };
  };
}

// Use an indexed access type to extract the type for the zkappCommand field.
type ZkappCommandInput = ZkappCommand["zkappCommand"];

/**
 * Constructs a typed mutation definition for sending a zkApp.
 *
 * @param variables - The variables containing the zkapp command input.
 */
function mkSendZkappMutation(
  variables: { zkappCommandInput: ZkappCommandInput }
): GqlQueryCall<SendZkAppMutationResponse, { zkappCommandInput: ZkappCommandInput }> {
  const operationName = 'SendZkAppMutation';
  const query = {
    operationName,
    query: `
      mutation ${operationName}($zkappCommandInput: ZkappCommandInput!) {
        sendZkapp(input: {
          zkappCommand: $zkappCommandInput
        }) {
          zkapp {
            hash
            id
            zkappCommand {
              memo
            }
          }
        }
      }
    `,
  };

  //console.log("DEBUG: Constructed SendZkAppMutation");
  //console.log("DEBUG: Mutation query string:", query.query);
  //console.log("DEBUG: Mutation variables:", JSON.stringify(variables, null, 2));

  return { query, variables };
}

export {
  GqlData,
  GqlVars,
  GraphQLError,
  GraphQLResponse,
  GqlQuery,
  GqlQueryCall,
  queryGraphQL,
  mkPooledNoncesQuery,
  mkTransactionStatusesQuery,
  PooledNoncesQueryResponse,
  TransactionStatusesQueryResponse,
  mkSendZkappMutation,
  ZkappCommandInput,
  SendZkAppMutationResponse,
};
