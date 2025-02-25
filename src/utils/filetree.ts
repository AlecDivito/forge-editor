import { DirectoryEntry } from "@/lib/storage";

export type FileNode = {
  path: string; // Full path of the file/directory
  name: string;
  type: "f" | "d";
  children?: FileNode[];
};

/**
 * Converts a flat list of FileItems into a hierarchical tree structure.
 */
export function buildFileTree(fileList: DirectoryEntry[]): FileNode {
  const root: FileNode = { path: "/", name: "/", type: "d", children: [] };
  const nodeMap = new Map<string, FileNode>([["", root]]);

  const directories = fileList.filter((f) => f.ty === "d");
  const files = fileList.filter((f) => f.ty === "f");
  directories.sort((a, b) => a.path.localeCompare(b.path));
  files.sort((a, b) => a.path.localeCompare(b.path));
  const children = directories.concat(files);

  for (const file of children) {
    const parentPath = file.path.substring(0, file.path.lastIndexOf("/")) || "";
    const parent = nodeMap.get(parentPath);

    if (!parent) {
      console.warn(`Parent not found for: ${file.path}`);
      continue;
    }

    const newNode: FileNode = { path: file.path, name: file.name, type: file.ty };
    if (file.ty === "d") newNode.children = [];

    parent.children = parent.children || [];
    parent.children.push(newNode);

    if (file.ty === "d") {
      nodeMap.set(file.path, newNode);
    }
  }

  return root;
}

/**
 * Adds a new file or directory to the tree.
 */
export function addFileToTree(root: FileNode, newFile: DirectoryEntry | DirectoryEntry[]): void {
  if (Array.isArray(newFile)) {
    for (const file of newFile) {
      addFileToTree(root, file);
    }
    return;
  }

  const parentPath = newFile.path.substring(0, newFile.path.lastIndexOf("/")) || "";
  const parentNode = findNodeByPath(root, parentPath);

  if (!parentNode) {
    console.warn(`Parent directory not found: ${parentPath}`);
    return;
  }

  if (!parentNode.children) parentNode.children = [];

  // Check if the file already exists
  if (parentNode.children.some((child) => child.name === newFile.name)) {
    console.warn(`File or directory already exists: ${newFile.path}`);
    return;
  }

  const newNode: FileNode = { path: newFile.path, name: newFile.name, type: newFile.ty };
  if (newFile.ty === "d") newNode.children = [];

  parentNode.children.push(newNode);
}

/**
 * Removes a file or directory from the tree.
 */
export function removeFileFromTree(root: FileNode, filePath: string): boolean {
  const parentPath = filePath.substring(0, filePath.lastIndexOf("/")) || "";
  const parentNode = findNodeByPath(root, parentPath);

  if (!parentNode || !parentNode.children) {
    console.warn(`Parent directory not found: ${parentPath}`);
    return false;
  }

  const index = parentNode.children.findIndex((child) => child.id === filePath);
  if (index === -1) {
    console.warn(`File or directory not found: ${filePath}`);
    return false;
  }

  parentNode.children.splice(index, 1);
  return true;
}

/**
 * Finds a node in the tree based on its path.
 */
function findNodeByPath(root: FileNode, path: string): FileNode | null {
  if (path === "") return root;
  const parts = path.split("/");
  let currentNode: FileNode | undefined = root;

  for (const part of parts) {
    if (!currentNode.children) return null;
    currentNode = currentNode.children.find((child) => child.name === part);
    if (!currentNode) return null;
  }

  return currentNode;
}
