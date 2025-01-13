"use client";

import { Message } from "@/interfaces/socket";
import { buildFileTree, TreeNode } from "@/service/tree";
import { nanoid } from "nanoid";
import { create } from "zustand";

interface FileTreeState {
  // Active panel
  activeGroup: string | null;
  // Open keeps a list of files per group that is open
  openFiles: { [group: string]: string[] };
  // Files keeps a flat list of files and it's content (if it has been loaded in.)
  files: { [key: string]: string };
  // Tree keeps a render object tree of all of the files in a list structure
  tree: TreeNode[]; // Cached tree structure
  // Initialize Tree setups the editor, prepares it for use
  initializeTree: (tree: string[]) => void;
  // Handle messages that are sent from the server
  handleMessage: (message: Message) => void;
  // Add a empty group into the editor
  addGroup: () => void;
  // Open a file into a panel
  openFile: (path: string) => void;
  // Close a file in the panel
  closeFile: (group: string, path: string) => void;
  // Update a file
  updateFile: (path: string, content: string) => void;
}

export const useFileStore = create<FileTreeState>((set, get) => ({
  activeGroup: null,
  openFiles: {},
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

  addGroup: () => {
    const activeGroupId = nanoid();
    set((state) => ({
      activeGroup: activeGroupId,
      openFiles: { ...state.openFiles, [activeGroupId]: [] },
    }));
  },

  openFile: (path) => {
    const { activeGroup } = get();

    // If there's no active panel, create a new one
    if (!activeGroup) {
      const activeGroupId = nanoid(); // Generate a unique panel ID
      set((state) => ({
        activeGroup: activeGroupId,
        openFiles: { ...state.openFiles, [activeGroupId]: [path] },
      }));
    } else {
      // If an active panel exists, open the file in that panel
      set((state) => ({
        openFiles: {
          ...state.openFiles,
          [activeGroup]: [...state.openFiles[activeGroup], path],
        },
      }));
    }
  },

  closeFile: (panel, path) => {
    set((state) => ({
      openFiles: {
        ...state.openFiles,
        [panel]: [...(state.openFiles[panel] || []).filter((p) => path !== p)],
      },
    }));
  },

  updateFile: (path, content) =>
    set((state) => ({
      files: {
        ...state.files,
        [path]: content,
      },
    })),
}));
