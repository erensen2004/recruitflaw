import type { QueryClient } from "@tanstack/react-query";
import {
  getGetCandidateQueryKey,
  getListCandidateHistoryQueryKey,
} from "@workspace/api-client-react";

type CandidateLike = {
  id: number;
};

function isCandidateListQueryKey(queryKey: readonly unknown[]) {
  return Array.isArray(queryKey) && queryKey[0] === "/api/candidates";
}

export function syncCandidateAcrossCaches<TCandidate extends CandidateLike>(queryClient: QueryClient, updatedCandidate: TCandidate) {
  queryClient.setQueryData(getGetCandidateQueryKey(updatedCandidate.id), updatedCandidate);
  queryClient.setQueriesData(
    {
      predicate: (query) => isCandidateListQueryKey(query.queryKey),
    },
    (current: unknown) =>
      Array.isArray(current)
        ? current.map((candidate) =>
            candidate && typeof candidate === "object" && (candidate as { id?: number }).id === updatedCandidate.id
              ? { ...(candidate as object), ...updatedCandidate }
              : candidate,
          )
        : current,
  );
}

export async function invalidateCandidateQueries(queryClient: QueryClient, candidateId: number) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["/api/candidates"] }),
    queryClient.invalidateQueries({ queryKey: getGetCandidateQueryKey(candidateId) }),
    queryClient.invalidateQueries({ queryKey: getListCandidateHistoryQueryKey(candidateId) }),
  ]);
}
