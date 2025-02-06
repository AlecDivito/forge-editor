import { ViewUpdate } from "@uiw/react-codemirror";

export abstract class ForgePlugin {
  private lastCommandId: number = 0;

  isEnabled(): boolean {
    return false;
  }

  abstract update(update: ViewUpdate): void;

  destory() {}
}

export class Deferred<T> {
  promise: Promise<T>;
  resolve?: (t: T) => void;
  reject?: (err: Error) => void;

  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.reject = reject;
      this.resolve = resolve;
    });
  }
}
