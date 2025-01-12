"use client";

import { Message } from "@/interfaces/socket";
import { buildFileTree, TreeNode } from "@/service/tree";
import { create } from "zustand";

interface FileTreeState {
  files: { [key: string]: string };
  tree: TreeNode[]; // Cached tree structure
  initializeTree: (tree: string[]) => void;
  handleMessage: (message: Message) => void;
  addFile: (name: string) => void;
}

export const useFileStore = create<FileTreeState>((set, get) => ({
  files: {},
  tree: [],

  // Initialize the flat file store with paths and empty contents
  initializeTree: (paths: string[]) => {
    const initialFiles = paths.reduce(
      (acc, path) => ({ ...acc, [path]: "" }),
      {}
    );
    set({ files: initialFiles, tree: buildFileTree(paths) });
  },

  handleMessage: (message: Message) => {
    console.log(message);

    const { event, body } = message;
    const { files } = get();

    if (event === "file:created") {
      set({
        files: { ...files, [body.path]: "" },
        tree: buildFileTree(Object.keys({ ...files, [body.path]: "" })),
      });
    }

    if (event === "file:updated") {
      set({
        files: { ...files, [body.path]: body.content },
        tree: buildFileTree(Object.keys(files)),
      });
    }

    if (event === "file:deleted") {
      const newFiles = { ...files };
      delete newFiles[body.path];
      set({ files: newFiles, tree: buildFileTree(Object.keys(newFiles)) });
    }

    if (event === "file:moved") {
      const newFiles = { ...files };
      const content = newFiles[body.path];
      delete newFiles[body.path];
      newFiles[body.newPath] = content;
      set({ files: newFiles, tree: buildFileTree(Object.keys(newFiles)) });
    }
  },

  addFile: (name) => {
    const obj = {
      ...get().files,
      [name]: "",
    };
    set({
      files: obj,
      tree: buildFileTree(Object.keys(obj)),
    });
  },
}));
