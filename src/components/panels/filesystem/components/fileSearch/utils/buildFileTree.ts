import { FsSearchResult } from "@/lib/generated";
import { TreeDirectoryNode } from "../models/viewMode.model";



function createDirectory(name: string, path: string): TreeDirectoryNode {
    return { type: "directory", name, path, children: [] };
}

export function buildFileTree(results: FsSearchResult[]): TreeDirectoryNode {
    const root = createDirectory("", "");

    for (const result of results) {
        const filePath = result.file.path;
        const parts = filePath.split("/").filter(Boolean);
        if (parts.length === 0) continue;

        let current = root;

        parts.forEach((part, index) => {
            const isFile = index === parts.length - 1;
            const path = parts.slice(0, index + 1).join("/");

            if (isFile) {
                current.children.push({ type: "file", name: part, path, result });
                return;
            }

            let directory = current.children.find(
                (child): child is TreeDirectoryNode =>
                    child.type === "directory" && child.name === part,
            );

            if (!directory) {
                directory = createDirectory(part, path);
                current.children.push(directory);
            }

            current = directory;
        });
    }

    return root;
}