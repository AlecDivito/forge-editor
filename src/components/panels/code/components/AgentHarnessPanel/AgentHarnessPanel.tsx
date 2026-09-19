"use client";

import { IGridviewPanelProps } from "dockview-react";
import { AgentComposer } from "./components/AgentComposer";
import { ConversationTabs } from "./components/ConversationTabs";
import { ConversationTranscript } from "./components/ConversationTranscript";

const AgentHarnessPanel = (_props: IGridviewPanelProps<Record<string, never>>) => {
  return (
    <section className="flex h-full min-h-0 flex-col bg-background text-foreground" aria-label="Forge agent">
      <ConversationTabs />
      <ConversationTranscript />
      <AgentComposer />
    </section>
  );
};

export default AgentHarnessPanel;
