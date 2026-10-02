import { useQuery } from "@tanstack/react-query";
import { listModelsOptions } from "@/lib/generated/@tanstack/react-query.gen";
import { useEffect } from "react";
import { useAgentHarnessStore } from "../store/agent-harness.store";

/** Loads the model catalog without exposing provider credentials to the browser. */
export function useAgentModels() {
  const query = useQuery({
    ...listModelsOptions(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const conversations = useAgentHarnessStore((state) => state.conversations);
  const setModel = useAgentHarnessStore((state) => state.setModel);

  useEffect(() => {
    const defaultModel = query.data?.models[0];
    if (!defaultModel) return;
    for (const conversation of conversations) {
      if (!conversation.model) setModel(conversation.id, defaultModel);
    }
  }, [conversations, query.data?.models, setModel]);

  return query;
}
