"use client";

import { buildFileTree, TreeNode } from "@/service/tree";
import { create } from "zustand";

interface FileTreeState {
  files: { [key: string]: string };
  tree: TreeNode[]; // Cached tree structure
  initializeTree: (tree: string[]) => void;
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
