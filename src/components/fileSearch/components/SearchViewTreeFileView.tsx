import { FsSearchLine, FsSearchResult } from "@/lib/generated";
import { buildFileTree } from "../utils/buildFileTree";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TreeDirectoryNode, TreeFileNode } from "../models/viewMode.model";
import FileDropdownToggle from "./FileDropdownToggle";
import { Badge } from "@/components/ui/badge";
import SearchViewLineMatch from "./SeachViewLineMatch";
import { useFileTree } from "@/components/fileTree/providers/FileTreeProvider";

interface Props {
    results: FsSearchResult[];
    onLineClick?: (result: FsSearchResult, match: FsSearchLine) => void;
}

interface ChildProps {
    onLineClick?: (result: FsSearchResult, match: FsSearchLine) => void;
}

export default function SearchViewTreeFileView({ results, onLineClick }: Props) {
    const tree = useMemo(() => buildFileTree(results), [results]);

    return (
        <div className="mt-2">
            {tree.children.map((child) =>
                child.type === 'directory' ? (
                    <TreeDirectoryResult
                        key={child.path}
                        node={child}
                        onLineClick={onLineClick}
                    />
                ) : (
                    <TreeFileResult
                        key={child.path}
                        node={child}
                        onLineClick={onLineClick}
                    />
                ),
            )}
        </div>
    );
}

function TreeDirectoryResult({ node, onLineClick }: ChildProps & { node: TreeDirectoryNode; }) {
    const { open, setOpen } = useFileTree();
    const [expanded, setExpanded] = useState(true);

    useEffect(() => {
        setExpanded(open)
    }, [open])

    return (
        <div>
            <div onClick={() => setExpanded((v) => !v)} className="flex items-center gap-1 px-2 py-0.5 hover:bg-muted cursor-pointer">
                <FileDropdownToggle expanded={expanded} />
                <span className="truncate">{node.name}</span>
            </div>

            {expanded && (
                <div className="ml-4 border-l border-border">
                    {node.children.map((child) =>
                        child.type === "directory" ? (
                            <TreeDirectoryResult
                                key={child.path}
                                node={child}
                                onLineClick={onLineClick}
                            />
                        ) : (
                            <TreeFileResult
                                key={child.path}
                                node={child}
                                onLineClick={onLineClick}
                            />
                        ),
                    )}
                </div>
            )}
        </div>
    );
}

function TreeFileResult({ node, onLineClick }: ChildProps & { node: TreeFileNode }) {
    const [expanded, setExpanded] = useState(true);
    const matches = node.result.matches;

    return (
        <div>
            <div onClick={() => setExpanded((v) => !v)} className="flex items-center gap-1 px-2 py-0.5 hover:bg-muted cursor-pointer">
                <FileDropdownToggle expanded={expanded} />
                <span className="truncate">{node.name}</span>
                <Badge  className="ml-auto px-2 rounded-full flex items-center justify-center">
                    {matches.length}
                </Badge>
            </div>

            {expanded && (
                <div className="pl-6 pr-2 py-0.5 border-l border-border ml-4">
                    {matches.map((match) => (
                        <SearchViewLineMatch
                            key={`${node.path}:${match.line}`}
                            match={match}
                            onClick={() => onLineClick?.(node.result, match)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
