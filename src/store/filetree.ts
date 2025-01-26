"use client";

import { Folder } from "@/service/fs";
import {
  ClientLspRequest,
  ServerLspNotification,
  ServerLspResponse,
} from "@/service/lsp";
import { FileExtension } from "@/service/lsp/proxy";
import { TreeNode } from "@/service/tree";
import {
  InitializeResult,
  TextDocumentItem,
} from "vscode-languageserver-protocol";
import { create } from "zustand";

export interface FileTreeState {
  capabilities: Partial<Record<FileExtension, InitializeResult>>;
  base: string;
  tree: TreeNode[]; // The file tree structure
  activeFiles: Record<string, TextDocumentItem | undefined>; // Tracks currently open files
  initialize: (base: string, folder: Folder) => void; // Initializes the file tree
  handleResponse: (
    request: ClientLspRequest,
    message: ServerLspResponse,
  ) => void;
  handleNotification: (message: ServerLspNotification) => void;
  openFile: (file: string) => void;
}

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
    return;
  },

  handleResponse: (request, response) => {
    if ("error" in response) {
      console.error(response);
      return;
    }

    // Some responses will be in "result" form. We should handle these.
    if ("result" in response) {
      if (response.method === "initialize") {
        set((state) => ({
          capabilities: {
            ...state.capabilities,
            [response.language]: response.result,
          },
        }));
      }

      return;
    }

    // Otherwise, we expect this message to be similar to the type of message we normally dealt with
    if (!("message" in response)) {
      throw new Error(
        "The response from the server was not an error or successful message. " +
          JSON.stringify(response),
      );
    }

    const { message } = response;

    if (message.method === "textDocument/didOpen") {
      const doc = message.params.textDocument;
      set((state) => ({
        activeFiles: { ...state.activeFiles, [doc.uri]: doc },
      }));
    } else if (message.method === "textDocument/didClose") {
      const path = message.params.textDocument.uri.replace("file:///", "");
      set((state) => {
        const updatedFiles = { ...state.activeFiles };
        delete updatedFiles[path];
        return { activeFiles: updatedFiles };
      });
    } else if (message.method === "workspace/didChangeWatchedFiles") {
      set((state) => {
        const { tree, base } = state;
        const updatedTree = [...tree]; // Create a copy of the current tree

        const addFileToTree = (path: string, fileName: string) => {
          const parts = path.split("/");
          let currentLevel = updatedTree;

          for (const part of parts.slice(0, -1)) {
            let dirNode = currentLevel.find(
              (node) => node.type === "directory" && node.name === part,
            ) as TreeNode;

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

        const deleteFileFromTree = (path: string) => {
          const parts = path.split("/");
          let currentLevel = updatedTree;
          const dirs = parts.slice(0, -1);
          const fileName = parts.at(-1);

          for (const part of dirs) {
            const dirNode = currentLevel.find(
              (node) => node.type === "directory" && node.name === part,
            ) as TreeNode;

            if (!dirNode || !dirNode.children) {
              return; // Directory not found, nothing to delete
            }

            currentLevel = dirNode.children;
          }

          // Remove the file from the directory
          const fileIndex = currentLevel.findIndex(
            (node) => node.type === "file" && node.name === fileName,
          );

          if (fileIndex !== -1) {
            currentLevel.splice(fileIndex, 1);
          }
        };

        // Process each change in the message
        for (const change of message.params.changes) {
          let filePath = change.uri.replace("file:///", "");
          const fileParts = filePath.split("/");
          fileParts.shift();
          filePath = fileParts.join("/");
          const fileName = fileParts.pop() || "";

          if (change.type === 1) {
            // Add file
            console.log(`Adding file: ${filePath}`);
            addFileToTree(filePath, fileName);
          } else if (change.type === 3) {
            // Delete file
            console.log(`Deleting file: ${filePath}`);
            deleteFileFromTree(filePath);
          }
        }

        return { tree: updatedTree };
      });
    } else {
      console.log("Logic does not exist to handle " + message.method);
    }
  },

  openFile: (path) => {
    set((state) => ({
      activeFiles: { ...state.activeFiles, [path]: undefined },
    }));
  },
}));
