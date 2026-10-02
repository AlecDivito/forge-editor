import { useEffect } from "react";
import { useAgentModels } from "../hooks/use-agent-models.hook";
import { AgentModelSelection } from "../types/agent-harness.types";

function modelOptionValue(provider: string, id: string) {
  return JSON.stringify([provider, id]);
}

type ModelSelectorProps = {
  model: AgentModelSelection | null;
  onModelChange: (model: AgentModelSelection | null) => void;
};

export function ModelSelector({ model, onModelChange }: ModelSelectorProps) {
  const modelsQuery = useAgentModels();
  const models = modelsQuery.data?.models ?? [];

  useEffect(() => {
    if (!model && models[0]) onModelChange(models[0]);
  }, [model, models, onModelChange]);

  return (
    <select
      value={model ? modelOptionValue(model.provider, model.id) : ""}
      onChange={(event) => {
        const model = models.find((item) => modelOptionValue(item.provider, item.id) === event.target.value);
        onModelChange(model ?? null);
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
