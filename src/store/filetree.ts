"use client";

import { DirectoryEntry } from "@/lib/storage";
import { ServerLspNotification } from "@/service/lsp";
import { addFileToTree, buildFileTree, FileNode } from "@/utils/filetree";
import { create } from "zustand";

export interface FileTreeState {
  user: string;
  project: string;
  base: string;
  fileTree?: FileNode;

  initialize: (user: string, project: string, folder: DirectoryEntry[]) => void; // Initializes the file tree
  handleNotification: (message: ServerLspNotification) => void;
}

export const useFileStore = create<FileTreeState>((set, get) => ({
  base: "",
  user: "",
  project: "",
  fileTree: undefined,

  // Initializes the tree structure based on the folder data
  initialize: (user: string, project: string, files: DirectoryEntry[]) => {
    set({ user, project, base: `${user}/${project}`, fileTree: buildFileTree(files) });
  },

  handleNotification: (message: ServerLspNotification) => {
    const { fileTree } = get();
    if (!fileTree) {
      throw new Error("File Tree must exist when events are recieved.");
    }

    if (message.method === "proxy/filesystem/created") {
      const path = message.params.uri.replace("file:///", "");
      const file: DirectoryEntry = { path, name: path.split("/")!.pop()!, ty: "f" };
      addFileToTree(fileTree, file);
      return set({ fileTree });
    } else if (message.method === "proxy/filesystem/changed") {
      // let updatedTree = { ...fileTree }; // Create a copy of the current tree
      // for (const change of message.params.changes) {
      //   if (change.type === 1) {
      //     updatedTree = addFileToTree(change.uri, updatedTree, base);
      //   } else if (change.type === 3) {
      //     updatedTree = removeFileFromTree(change.uri, updatedTree);
      //   }
      // }
      set({ fileTree: fileTree });
    }
  },
}));
