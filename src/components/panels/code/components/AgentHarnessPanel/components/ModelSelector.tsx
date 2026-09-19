import { useAgentModels } from "../hooks/use-agent-models.hook";
import { useAgentHarnessStore } from "../store/agent-harness.store";

function modelOptionValue(provider: string, id: string) {
  return JSON.stringify([provider, id]);
}

export function ModelSelector() {
  const activeConversationId = useAgentHarnessStore((state) => state.activeConversationId);
  const conversation = useAgentHarnessStore((state) =>
    state.conversations.find((item) => item.id === activeConversationId),
  );
  const setModel = useAgentHarnessStore((state) => state.setModel);
  const modelsQuery = useAgentModels();
  const models = modelsQuery.data?.models ?? [];

  if (!conversation) return null;

  return (
    <select
      value={conversation.model ? modelOptionValue(conversation.model.provider, conversation.model.id) : ""}
      onChange={(event) => {
        const model = models.find((item) => modelOptionValue(item.provider, item.id) === event.target.value);
        setModel(conversation.id, model ?? null);
      }}
      disabled={modelsQuery.isLoading || !modelsQuery.data?.configured || !models.length}
      className="h-7 max-w-36 truncate rounded-md bg-transparent px-2 text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
      aria-label="Model">
      <option value="">
        {modelsQuery.isLoading
          ? "Loading models…"
          : !modelsQuery.data?.configured
            ? "No model backend"
            : modelsQuery.isError
              ? "Models unavailable"
              : "Choose a model"}
      </option>
      {models.map((model) => (
        <option key={modelOptionValue(model.provider, model.id)} value={modelOptionValue(model.provider, model.id)}>
          {model.label}
        </option>
      ))}
    </select>
  );
}
