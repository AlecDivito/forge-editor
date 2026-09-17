import { FsSearchResponse } from "@/lib/generated";
import { ViewMode } from "../models/viewMode.model";
import { List, ListTree } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface Props {
    response: FsSearchResponse;
    viewMode: ViewMode;
    onOpenInEditor?: () => void;
    onChangeViewMode: (mode: ViewMode) => void;
}

export default function SearchViewSummary({ response, viewMode, onOpenInEditor, onChangeViewMode }: Props) {
    const resultCount = response.results.reduce(
        (count, result) => count + result.matches.length,
        0,
    );
    const fileCount = response.results.length;

    return (
        <div className="px-3 mt-3 flex items-center justify-between gap-1 text-[14px]">
            <div>
                <span>
                    {resultCount} {resultCount === 1 ? "result" : "results"} in{" "}
                    {fileCount} {fileCount === 1 ? "file" : "files"}
                </span>
                {" "}
                <span>–</span>
                {" "}
                <button type="button" onClick={onOpenInEditor} className="hover:underline">
                    Open in editor
                </button>
            </div>

            <Tabs value={viewMode} onValueChange={s => onChangeViewMode(s as ViewMode)}>
                <TabsList>
                    <TabsTrigger value="list">
                        <List className="h-4 w-4" />
                    </TabsTrigger>
                    <TabsTrigger value="tree">
                        <ListTree className="h-4 w-4" />
                    </TabsTrigger>
                </TabsList>
            </Tabs>
        </div>
    );
}