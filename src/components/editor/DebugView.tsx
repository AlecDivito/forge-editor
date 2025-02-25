import { useEditorStore } from "@/store/editor";
import { useFileStore } from "@/store/filetree";
import { useLspStore } from "@/store/lsp";
import { useNotification } from "@/store/notification";

const DebugView = () => {
  const { activeFiles } = useEditorStore();
  const { fileTree, base } = useFileStore();
  const { capabilities } = useLspStore();
  const { notifications } = useNotification();

  return (
    <div style={{ overflow: "scroll", height: "100%", width: "100%" }}>
      <h2>Active Files</h2>
      <pre>{JSON.stringify(activeFiles, null, 2)}</pre>
      <h2>File Tree - {base}</h2>
      <pre>{JSON.stringify(fileTree, null, 2)}</pre>
      <h2>Capabilities</h2>
      <pre>{JSON.stringify(capabilities, null, 2)}</pre>
      <h2>Notifications</h2>
      <pre>{JSON.stringify(notifications, null, 2)}</pre>
    </div>
  );
};

export default DebugView;
