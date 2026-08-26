import type {
  FsSearchResponse,
  FsSearchResult,
  FsSearchLine,
} from "@/lib/generated";
import SearchViewSummary from "./SearchViewSummary";
import SearchViewListFileView from "./SearchViewListFileView";
import SearchViewTreeFileView from "./SearchViewTreeFileView";
import { ViewMode } from "../models/viewMode.model";

interface Props {
  view: ViewMode;
  response: FsSearchResponse;
  onOpenInEditor?: () => void;
  onLineClick?: (result: FsSearchResult, match: FsSearchLine) => void;
  setViewMode: (view: ViewMode) => void;
}

export default function SearchViewResults({
  view = "list",
  response,
  onOpenInEditor,
  onLineClick,
  setViewMode,
}: Props) {
  return (
    <div className="text-[13px]">
      <SearchViewSummary
        response={response}
        viewMode={view}
        onOpenInEditor={onOpenInEditor}
        onChangeViewMode={setViewMode}
      />

      {view === "tree" ? (
        <SearchViewTreeFileView results={response.results} onLineClick={onLineClick} />
      ) : (
        <SearchViewListFileView results={response.results} onLineClick={onLineClick} />
      )}
    </div>
  );
}