import fetch, { Response } from "node-fetch";
import { PublicKey } from "o1js";

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
type GqlVars<T> = T extends GqlQuery<any, infer TVariables> ? TVariables : never;

/**
 * A generic GraphQL fetch function that knows how to handle typed queries.
 * Uses type inference to make the API cleaner and more concise.
 */
async function queryGraphQL<T extends GqlQuery<any, any>>(
  queryCall: GqlQueryCall<GqlData<T>, GqlVars<T>>,
  url: string
): Promise<GqlData<T>> {
  const response: Response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: queryCall.query.query,
      operationName: queryCall.query.operationName,
      variables: queryCall.variables,
    }),
  });

  const json = (await response.json()) as GraphQLResponse<GqlData<T>>;

  if (json.errors && json.errors.length > 0) {
    throw new Error(JSON.stringify(json.errors, null, 2));
  }

  return json.data!;
}

// -------------------------------------------------------------------------- */

/**
 * The shape of data we expect back for "PooledNoncesQuery".
 */
interface PooledNoncesQuery {
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
 * Constructs a typed query definition for fetching pooled nonces.
 *
 * @param publicKey - The public key to use in the query
 */
function mkPooledNoncesQuery(variables: { pubkey: PublicKey }): GqlQueryCall<PooledNoncesQuery, { pubkey: PublicKey }> {
  const pk = variables.pubkey.toBase58();
  const pk_desc = `${pk.slice(0, 4)}...${pk.slice(-4)}`;
  const query = {
    operationName: `PooledNoncesQuery_${pk_desc}`,
    query: `
query MyQuery($pubkey: PublicKey) {
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
  }`
  };
  return { query, variables }
};


export {
  GqlData,
  GqlVars,
  GraphQLError,
  GraphQLResponse,
  GqlQuery,
  GqlQueryCall,
  queryGraphQL,
  mkPooledNoncesQuery,
  PooledNoncesQuery
};
