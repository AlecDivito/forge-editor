import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getConfigurationsOptions } from "@/lib/generated/@tanstack/react-query.gen";
import { WorkspaceId } from "@/lib/ws/messages";

export default function useDebugConfigurations(workspaceId: WorkspaceId) {
  const [selectedConfigurationId, setSelectedConfigurationId] = useState("");
  const query = useQuery({ ...getConfigurationsOptions({ path: { workspace_id: workspaceId } }), retry: false });
  const configurations = query.data?.configurations;

  useEffect(() => setSelectedConfigurationId(""), [workspaceId]);
  useEffect(() => {
    if (!configurations) return;
    setSelectedConfigurationId((current) =>
      configurations.some(({ id, valid }) => id === current && valid)
        ? current
        : configurations.find(({ valid }) => valid)?.id ?? "",
    );
  }, [configurations]);

  const selectedConfiguration = useMemo(
    () => configurations?.find(({ id }) => id === selectedConfigurationId),
    [configurations, selectedConfigurationId],
  );
  return { query, selectedConfiguration, selectedConfigurationId, setSelectedConfigurationId };
}
