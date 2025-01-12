export interface TreeNode {
  id: string;
  name: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

export const buildFileTree = (filePaths: string[]): TreeNode[] => {
  const root: Record<string, TreeNode> = {};

  filePaths.forEach((filePath) => {
    const parts = filePath.split("/");
    let currentLevel = root;

    parts.forEach((part, index) => {
      const currentPath = parts.slice(0, index + 1).join("/");

      if (!currentLevel[part]) {
        currentLevel[part] = {
          id: currentPath,
          name: part,
          type: index === parts.length - 1 ? "file" : "directory",
          children: index === parts.length - 1 ? undefined : {},
        };
      }

      if (
        currentLevel[part].type === "directory" &&
        currentLevel[part].children
      ) {
        currentLevel = currentLevel[part].children;
      }
    });
  });

  // Convert the object-based structure to an array-based structure
  const convertToArray = (node: Record<string, TreeNode>): TreeNode[] =>
    Object.values(node).map(({ id, name, type, children }) => ({
      id,
      name,
      type,
      children: children ? convertToArray(children) : undefined,
    }));

  const output = convertToArray(root);

  if (
    output.length === 1 &&
    output[0].type === "directory" &&
    output[0].id === ""
  ) {
    return output[0].children || [];
  } else {
    return output;
  }
};
