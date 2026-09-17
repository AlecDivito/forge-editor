import { join } from "path";
import { TextDocument } from "./cache";
import { FileSystemManager } from "./filesystem";
import { TextDocumentContentChangeEvent } from "vscode-languageserver-protocol";

const textExtensions = [".txt", ".py", ".ts", ".js", ".tsx", ".rs", ".json", ".toml", ".xml"];
const imageExtensions = [".png", ".webp", ".jpeg"];
const objectExtensions = [".pdf"];

interface EditableFile {
  version: number;
  text: string;
}

export class VirtualEditorManager {
  private editableFiles: Record<string, EditableFile> = {};
  private staticFiles: Record<string, Buffer<ArrayBufferLike>> = {};

  constructor(private readonly filesystem: FileSystemManager) {}

  async open(path: string): Promise<TextDocument> {
    const absolutePath = this.filesystem.getFilePath(path);
    const buffer = await this.filesystem.readFile(path);
    const document = {
      uri: `file://${join(absolutePath.dir, absolutePath.base)}`,
      version: 0,
      languageId: absolutePath.ext,
      text: "",
    };

    if (textExtensions.includes(absolutePath.ext)) {
      this.editableFiles[path] = { version: 0, text: Buffer.from(buffer).toString() };
      document.text = Buffer.from(buffer).toString();
      return document;
    } else if (imageExtensions.includes(absolutePath.ext)) {
      this.staticFiles[path] = buffer;
      return document;
    } else if (objectExtensions.includes(absolutePath.ext)) {
      this.staticFiles[path] = buffer;
      return document;
    } else {
      this.editableFiles[path] = { version: 0, text: Buffer.from(buffer).toString() };
      document.text = Buffer.from(buffer).toString();
      return document;
    }
  }

  async closeAll() {
    this.staticFiles = {};
    for (const [path, editableFile] of Object.entries(this.editableFiles)) {
      await this.filesystem.saveFile(path, editableFile.text);
    }
  }

  async close(path: string) {
    if (this.staticFiles[path]) {
      delete this.staticFiles[path];
    }

    if (this.editableFiles[path]) {
      this.filesystem.saveFile(path, this.editableFiles[path].text);
      delete this.editableFiles[path];
    }
  }

  async applyChanges(path: string, version: number, changes: TextDocumentContentChangeEvent[]): Promise<void> {
    const file = this.editableFiles[path];
    if (!file) {
      throw new Error(`The file that you tried to apply changes didn't work.`);
    }
    if (version <= file.version) {
      throw new Error(`Incoming version ${version} is older than cached version ${file.version}`);
    }

    for (const change of changes) {
      if ("range" in change) {
        file.text = this.applyIncrementalChange(file.text, change);
      } else {
        file.text = change.text;
      }
    }

    file.version = version;
  }

  private applyIncrementalChange(content: string, change: TextDocumentContentChangeEvent): string {
    if (!("range" in change)) return change.text;
    const { start, end } = change.range;
    const lines = content.split("\n");
    const startIndex = this.getAbsoluteIndex(lines, start.line, start.character);
    const endIndex = this.getAbsoluteIndex(lines, end.line, end.character);
    return content.slice(0, startIndex) + change.text + content.slice(endIndex);
  }

  private getAbsoluteIndex(lines: string[], line: number, character: number): number {
    let index = 0;
    for (let i = 0; i < line; i++) {
      index += lines[i].length + 1;
    }
    return index + character;
  }
}
