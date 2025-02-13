import { Field, PublicKey, fetchAccount } from "o1js";

/**
 * Taken from zkcloudworker-lib @ 0.22.3,
 * Fetches the Mina account for a given public key with error handling
 * @param params the parameters for fetching the account
 * @param params.publicKey the public key of the account
 * @param params.tokenId the token id of the account
 * @param params.force whether to force the fetch - use it only if you are sure the account exists
 * @returns the account object
 */
export async function fetchMinaAccount(params:
    {
        publicKey: PublicKey;
        tokenId?: Field;
        force?: boolean;
    }
                                      ) {
    const { publicKey, tokenId, force = false } = params;
    const timeout = 1000 * 60 * 3; // 3 minutes
    let attempt = 0;
    const startTime = Date.now();
    let result = { account: undefined };
    while (Date.now() - startTime < timeout) {
        try {
            const result = await fetchAccount({
                publicKey,
                tokenId,
            }, undefined, { timeout: 5 * 1000 });
            return result;
        }
        catch (error) {
            if (force === true)
                console.log("Error in fetchMinaAccount:", {
                    error,
                    publicKey: typeof publicKey === "string" ? publicKey : publicKey.toBase58(),
                    tokenId: tokenId?.toString(),
                    force,
                });
            else {
                console.log("fetchMinaAccount error", {
                    error,
                    publicKey: typeof publicKey === "string" ? publicKey : publicKey.toBase58(),
                    tokenId: tokenId?.toString(),
                    force,
                });
                return result;
            }
        }
        attempt++;
        await sleep(1000 * 6 * attempt); // to handle rate limit we increase the interval
    }
    if (force === true)
        throw new Error(`fetchMinaAccount timeout
      ${{
            publicKey: typeof publicKey === "string" ? publicKey : publicKey.toBase58(),
            tokenId: tokenId?.toString(),
            force,
        }}`);
    else
        console.log("fetchMinaAccount timeout", typeof publicKey === "string" ? publicKey : publicKey.toBase58(), tokenId?.toString(), force);
    return result;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
