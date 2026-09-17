import { ReactNode } from "react";
import { GitChange } from "@/lib/generated";
import { GitChangeView } from "./models/git-view.model";
import GitChangeRow from "./GitChangeRow";

interface TreeNode {
  directories: Map<string, TreeNode>;
  files: GitChange[];
}
interface Props {
  changes: GitChange[];
  view: GitChangeView;
}

export default function GitChangeTree(props: Props) {
  const root: TreeNode = { directories: new Map(), files: [] };
  for (const change of props.changes) {
    const parts = change.path.replace(/^\//, "").split("/");
    let node = root;
    for (const directory of parts.slice(0, -1)) {
      if (!node.directories.has(directory)) node.directories.set(directory, { directories: new Map(), files: [] });
      node = node.directories.get(directory)!;
    }
    node.files.push(change);
  }
  const render = (node: TreeNode, depth: number): ReactNode => (
    <>
      {[...node.directories.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, child]) => (
          <details open key={`${depth}:${name}`} style={{ paddingLeft: depth * 10 }}>
            <summary className="cursor-pointer py-0.5 text-[11px] text-muted-foreground">{name}</summary>
            {render(child, depth + 1)}
          </details>
        ))}
      {node.files
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((change) => (
          <div key={`${props.view}:${change.path}`} style={{ paddingLeft: depth * 10 }}>
            <GitChangeRow change={change} view={props.view} />
          </div>
        ))}
    </>
  );
  return render(root, 0);
}
