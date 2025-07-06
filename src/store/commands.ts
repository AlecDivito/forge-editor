import { create } from "zustand";

export type CommandEvent =
  | {
      type: "file.new";
      parent: string;
    }
  | {
      type: "file.create";
      path: string;
    }
  | {
      type: "file.new.hide";
      path: string;
    }
  | {
      type: "folder.new";
      parent: string;
    }
  | {
      type: "folder.create";
      path: string;
    }
  | {
      type: "folder.new.hide";
      path: string;
    }
  | {
      type: "rename.prepare";
      path: string;
    }
  | {
      type: "rename.execute";
      from: string;
      to: string;
    }
  | {
      type: "delete";
      path: string;
    }
  | {
      type: "copy.abs.path";
    }
  | {
      type: "copy.rel.path";
    };

export interface CommandQueue {
  commands: CommandEvent[];
  subscribers: Array<null | ((cmd: CommandEvent) => void)>;

  subscribe: (listener: (cmd: CommandEvent) => void) => number;
  unsubscribe: (id: number) => void;
  push: (cmd: CommandEvent) => void;
}

export const useCommandQueue = create<CommandQueue>((set, get) => ({
  commands: [],
  subscribers: [],

  subscribe(listener) {
    const id = get().subscribers.length;
    console.log(id);
    set((state) => ({
      subscribers: [listener, ...state.subscribers],
    }));
    return id + 1;
  },

  unsubscribe(num) {
    set((state) => ({
      subscribers: state.subscribers.map((value, i) => (i === num ? null : value)),
    }));
  },

  push(cmd) {
    console.log(cmd);
    set((state) => ({ commands: [cmd, ...state.commands] }));
    console.log(get().subscribers);
    get().subscribers.forEach((value) => {
      if (value) {
        value(cmd);
      }
    });
  },
}));
