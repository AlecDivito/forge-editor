import { FsSearchLine, FsSearchResult } from "@/lib/generated";
import { useState } from "react";
import FileDropdownToggle from "./FileDropdownToggle";
import { Badge } from "@/components/ui/badge";
import SearchViewLineMatch from "./SeachViewLineMatch";

interface Props {
  results: FsSearchResult[];
  onLineClick?: (result: FsSearchResult, match: FsSearchLine) => void;
}

export default function SearchViewListFileView({ results, onLineClick }: Props) {
  return (
    <div className="mt-2">
      {results.map((result) => (
        <ListFileResult
          key={result.file.path}
          result={result}
          onLineClick={onLineClick}
        />
      ))}
    </div>
  );
}

function ListFileResult({
  result,
  onLineClick,
}: {
  result: FsSearchResult;
  onLineClick?: (result: FsSearchResult, match: FsSearchLine) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const path = result.file.path;
  const name = path.slice(path.lastIndexOf("/") + 1);

  return (
    <div>
      <div onClick={() => setExpanded((v) => !v)} className="flex items-center gap-1 px-2 py-0.5 hover:bg-muted cursor-pointer">
        <FileDropdownToggle expanded={expanded} />
        <span className="truncate">{name}</span>
        <span className="text-muted-foreground ml-1 truncate">
          {result.file.parent}
        </span>
        <Badge className="ml-auto px-2 rounded-full flex items-center justify-center">
          {result.matches.length}
        </Badge>
      </div>

      {expanded && (
        <div className="pl-6 pr-2 py-0.5 border-l border-border ml-4">
          {result.matches.map((match) => (
            <SearchViewLineMatch
              key={`${path}:${match.line}`}
              match={match}
              onClick={() => onLineClick?.(result, match)}
            />
          ))}
        </div>
      )}
    </div>
  );
}