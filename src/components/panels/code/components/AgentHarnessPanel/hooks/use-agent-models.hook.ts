import { useQuery } from "@tanstack/react-query";
import { listModelsOptions } from "@/lib/generated/@tanstack/react-query.gen";

/** Loads the model catalog without exposing provider credentials to the browser. */
export function useAgentModels() {
  return useQuery({
    ...listModelsOptions(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
