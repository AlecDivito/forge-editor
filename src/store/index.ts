"use client";

import { applyChanges, Message } from "@/interfaces/socket";
import { Change } from "@/service/fs";
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
  // Incremental updates for a given file
  edits: { [key: string]: Change[] };
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
  // Apply edits immediately if created locally.
  applyEdit: (path: string, edit: Change[]) => void;
}

export const useFileStore = create<FileTreeState>((set, get) => ({
  activeGroup: null,
  openFiles: {},
  files: {},
  edits: {},
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
    const { files, edits } = get();

    if (event === "file:created") {
      set({
        files: { ...files, [body.path]: "" },
        tree: buildFileTree(Object.keys({ ...files, [body.path]: "" })),
      });
    }

    if (event === "file:updated") {
      set({
        files: { ...files, [body.path]: body.content },
        edits: { ...edits, [body.path]: [] }, // Clear edits after sync
      });
    }

    if (event === "file:edit") {
      const { path, changes } = body;
      // Avoid applying duplicate edits
      const uniqueChanges = changes.filter(
        (change) => !edits[path]?.some((e) => e.id === change.id)
      );

      const updatedContent = applyChanges(files[path], uniqueChanges);

      set({
        files: { ...files, [path]: updatedContent },
        edits: { ...edits, [path]: [...(edits[path] || []), ...uniqueChanges] },
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

  applyEdit: (path: string, edits: Change[]) => {
    set((state) => {
      const newContent = applyChanges(state.files[path], edits);
      return {
        files: {
          ...state.files,
          [path]: newContent,
        },
        edits: {
          ...state.edits,
          [path]: [...(state.edits[path] || []), ...edits],
        },
      };
    });
  },
}));
