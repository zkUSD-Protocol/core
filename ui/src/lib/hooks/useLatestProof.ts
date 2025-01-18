import { useQuery } from "@tanstack/react-query";
import { JsonProof } from "o1js";
import { AggregateOraclePricesProof } from "zkusd";

export function useLatestProof() {
  return useQuery({
    queryKey: ["latestProof"],
    queryFn: async () => {
      const rawResponse = await fetch("/api/mina-price-proof");

      if (!rawResponse.ok) {
        throw new Error("Failed to fetch latest proof");
      }

      const response = await rawResponse.json();

      const proof: AggregateOraclePricesProof =
        await AggregateOraclePricesProof.fromJSON(
          response.data.proof as JsonProof
        );

      return proof;
    },
    // Refresh every 30 seconds
    refetchInterval: 20000,
    refetchOnMount: true,
  });
}
