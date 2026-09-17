import type {
  FsSearchResponse,
  FsSearchResult,
  FsSearchLine,
} from "@/lib/generated";
import SearchViewListFileView from "./SearchViewListFileView";
import SearchViewTreeFileView from "./SearchViewTreeFileView";
import { ViewMode } from "../models/viewMode.model";

interface Props {
  view: ViewMode;
  response: FsSearchResponse;
  onLineClick?: (result: FsSearchResult, match: FsSearchLine) => void;
}

export default function SearchViewResults({
  view = "list",
  response,
  onLineClick,
}: Props) {
  return (
    <div className="text-[13px] bg-background">
      {view === "tree" ? (
        <SearchViewTreeFileView results={response.results} onLineClick={onLineClick} />
      ) : (
        <SearchViewListFileView results={response.results} onLineClick={onLineClick} />
      )}
    </div>
  );
}