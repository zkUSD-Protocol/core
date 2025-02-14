import { PublicKey } from 'o1js';
import { SignerZkappCommandInput } from '../o1js-compat/zkappcommand.js';

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
 */
interface GqlQuery<_TData, _TVariables> {
  query: string;
  operationName: string;
}

interface GqlQueryCall<TData, TVariables> {
  query: GqlQuery<TData, TVariables>;
  variables: TVariables;
}

type GqlData<T> = T extends GqlQuery<infer TData, any> ? TData : never;
type GqlVars<T> = T extends GqlQuery<any, infer TVariables>
  ? TVariables
  : never;

/**
 * A generic GraphQL fetch function that works in both Node.js (18+) and Web.
 */
async function queryGraphQL<T extends GqlQuery<any, any>>(
  queryCall: GqlQueryCall<GqlData<T>, GqlVars<T>>,
  url: string
): Promise<GqlData<T>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: queryCall.query.query,
      operationName: queryCall.query.operationName,
      variables: queryCall.variables,
    }),
  });

  const responseText = await response.text();

  let json: GraphQLResponse<GqlData<T>>;
  try {
    json = JSON.parse(responseText);
  } catch (err) {
    console.error('Failed to parse JSON response:', err);
    throw new Error(`Invalid JSON response: ${responseText}`);
  }

  if (json.errors && json.errors.length > 0) {
    console.error('GraphQL errors:', JSON.stringify(json.errors, null, 2));
    throw new Error(JSON.stringify(json.errors, null, 2));
  }

  return json.data!;
}

// -------------------- Typed Queries -----------------------------------------

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

function mkSendZkappMutation(variables: {
  zkappCommandInput: SignerZkappCommandInput;
}): GqlQueryCall<
  SendZkAppMutationResponse,
  { zkappCommandInput: SignerZkappCommandInput }
> {
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
  return { query, variables };
}

// -------------------- Exports -----------------------------------------

export {
  // Types
  GqlData,
  GqlVars,
  GraphQLError,
  GraphQLResponse,
  GqlQuery,
  GqlQueryCall,

  // Function
  queryGraphQL,

  // Queries & Mutations
  mkPooledNoncesQuery,
  mkTransactionStatusesQuery,
  mkSendZkappMutation,

  // Types for query responses
  PooledNoncesQueryResponse,
  TransactionStatusesQueryResponse,
  SendZkAppMutationResponse,
};
