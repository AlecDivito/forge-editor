"use client";

import { Folder } from "@/service/fs";
import { ServerLspNotification } from "@/service/lsp";
import { FileExtension } from "@/service/lsp/proxy";
import { TreeNode } from "@/service/tree";
import { FileEvent, InitializeResult, TextDocumentItem } from "vscode-languageserver-protocol";
import { create } from "zustand";

export interface FileTreeState {
  capabilities: Partial<Record<FileExtension, InitializeResult>>;
  base: string;
  tree: TreeNode[]; // The file tree structure
  activeFiles: Record<string, TextDocumentItem | null>; // Tracks currently open files

  initialize: (base: string, folder: Folder) => void; // Initializes the file tree
  handleNotification: (message: ServerLspNotification) => void;
  openFile: (file: string) => void;
}

const removeFileFromTree = (uri: string, updatedTree: TreeNode[]): TreeNode[] => {
  const deleteFileFromTree = (path: string) => {
    const parts = path.split("/");
    let currentLevel = updatedTree;
    const dirs = parts.slice(0, -1);
    const fileName = parts.at(-1);

    for (const part of dirs) {
      const dirNode = currentLevel.find((node) => node.type === "directory" && node.name === part) as TreeNode;

      if (!dirNode || !dirNode.children) {
        return; // Directory not found, nothing to delete
      }

      currentLevel = dirNode.children;
    }

    // Remove the file from the directory
    const fileIndex = currentLevel.findIndex((node) => node.type === "file" && node.name === fileName);

    if (fileIndex !== -1) {
      currentLevel.splice(fileIndex, 1);
    }
  };

  // Process each change in the message
  let filePath = uri.replace("file:///", "");
  const fileParts = filePath.split("/");
  fileParts.shift();
  filePath = fileParts.join("/");

  console.log(`Deleting file: ${filePath}`);
  deleteFileFromTree(filePath);

  return updatedTree;
};

const addFileToTree = (uri: string, updatedTree: TreeNode[], base: string): TreeNode[] => {
  const addFileToTree = (path: string, fileName: string) => {
    const parts = path.split("/");
    let currentLevel = updatedTree;

    for (const part of parts.slice(0, -1)) {
      let dirNode = currentLevel.find((node) => node.type === "directory" && node.name === part) as TreeNode;

      if (!dirNode) {
        dirNode = {
          id: `${base}${part}/`,
          name: part,
          type: "directory",
          children: [],
        };
        currentLevel.push(dirNode);
      }

      currentLevel = dirNode.children!;
    }

    // Add the file to the directory
    currentLevel.push({
      id: `${base}${path}`,
      name: fileName,
      type: "file",
    });
  };

  // Process each change in the message
  let filePath = uri.replace("file:///", "");
  const fileParts = filePath.split("/");
  fileParts.shift();
  filePath = fileParts.join("/");
  const fileName = fileParts.pop() || "";

  console.log(`Adding file: ${filePath}`);
  addFileToTree(filePath, fileName);

  return updatedTree;
};

export const useFileStore = create<FileTreeState>((set) => ({
  capabilities: {},
  base: "",
  tree: [],
  activeFiles: {},

  // Initializes the tree structure based on the folder data
  initialize: (base: string, folder: Folder) => {
    const buildTree = (folder: Folder, basePath: string = ""): TreeNode[] => {
      const files: TreeNode[] = folder.files.map((file) => ({
        id: `${basePath}${file}`, // Absolute path for the file
        name: file,
        type: "file",
      }));

      const directories: TreeNode[] = folder.directories.map((dir) => ({
        id: `${basePath}${dir}/`, // Absolute path for the directory
        name: dir,
        type: "directory",
        children: [], // Empty for now since it's top-level only
      }));

      return [...directories, ...files];
    };

    set({ base, tree: buildTree(folder) });
  },

  handleNotification: (message: ServerLspNotification) => {
    if (message.method === "proxy/initialize") {
      set((state) => ({
        capabilities: {
          ...state.capabilities,
          [message.language]: message.params,
        },
      }));
    } else if (message.method === "proxy/textDocument/created") {
      return set((state) => {
        const { tree, base } = state;
        const updatedTree = [...tree]; // Create a copy of the current tree
        const path = message.params.uri.replace("file:///", "");
        return { tree: addFileToTree(path, updatedTree, base) };
      });
    } else if (message.method === "proxy/textDocument/open") {
      const path = message.params.textDocument.uri.replace("file:///", "");
      message.params.textDocument.uri = path;
      set((state) => {
        if (state.activeFiles?.[path] !== null) {
          return { activeFiles: state.activeFiles };
        }
        return {
          activeFiles: { ...state.activeFiles, [path]: message.params.textDocument },
        };
      });
    } else if (message.method === "proxy/textDocument/close") {
      const path = message.params.textDocument.uri.replace("file:///", "");
      set((state) => {
        const updatedFiles = { ...state.activeFiles };
        delete updatedFiles[path];
        return { activeFiles: updatedFiles };
      });
    } else if (message.method === "proxy/textDocument/changed") {
      set((state) => {
        const { tree, base } = state;
        let updatedTree = [...tree]; // Create a copy of the current tree
        for (const change of message.params.changes) {
          if (change.type === 1) {
            updatedTree = addFileToTree(change.uri, updatedTree, base);
          } else if (change.type === 3) {
            updatedTree = removeFileFromTree(change.uri, updatedTree);
          }
        }
        return { tree: updatedTree };
      });
    }
  },

  openFile: (path) =>
    set((state) => {
      // console.log(state.activeFiles);
      return {
        activeFiles: { ...state.activeFiles, [path]: null },
      };
    }),
}));
