import React, { useState, ReactNode } from "react";
import Tab from "./tab";

interface TabContent {
  id: string;
  label: string;
  content: ReactNode;
}

interface TabsContainerProps {
  tabs: TabContent[];
  onTabChange?: (activeTabId: string) => void;
  onTabClose?: (closedTabId: string) => void;
}

const TabsContainer: React.FC<TabsContainerProps> = ({
  tabs,
  onTabChange,
  onTabClose,
}) => {
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0]?.id || "");

  const handleTabClick = (id: string) => {
    setActiveTabId(id);
    if (onTabChange) onTabChange(id);
  };

  const handleTabClose = (id: string) => {
    if (onTabClose) onTabClose(id);
    if (id === activeTabId && tabs.length > 1) {
      const nextTab = tabs.find((tab) => tab.id !== id);
      if (nextTab) setActiveTabId(nextTab.id);
    }
  };

  return (
    <div className="w-full">
      <div className="flex border-b">
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            label={tab.label}
            isActive={tab.id === activeTabId}
            onClick={() => handleTabClick(tab.id)}
            onClose={() => handleTabClose(tab.id)}
          />
        ))}
      </div>
    </div>
  );
};

export default TabsContainer;
