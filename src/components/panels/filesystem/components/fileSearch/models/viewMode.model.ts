import { FsSearchResult } from "@/lib/generated";


export type ViewMode = 'list' | 'tree'

export type TreeFileNode = {
    type: "file";
    name: string;
    path: string;
    result: FsSearchResult;
};

export type TreeDirectoryNode = {
    type: "directory";
    name: string;
    path: string;
    children: TreeNode[];
};

type TreeNode = TreeFileNode | TreeDirectoryNode;
