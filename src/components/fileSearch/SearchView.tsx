"use client";

import { useCallback, useMemo, useState } from "react";
import {
    RotateCcw,
    ListFilter,
    FilePlus,
    AlignJustify,
    Copy,
    ChevronRight,
    ChevronDown,
    List,
    ListTree,
    ListX,
} from "lucide-react";
import { HoverCardContent, HoverCardTrigger, HoverCard } from "../ui/hover-card";
import SearchViewForm from "./components/SearchViewForm";
import useSearchFiles from "./hooks/use-search-files.hook";
import SearchViewResults from "./components/SearchViewResults";
import { ViewMode } from "./models/viewMode.model";

export default function FileSearchView() {
    const { setSearchState, data, refetch } = useSearchFiles();
    const [view, setView] = useState<ViewMode>('list')

    const toggleView = useCallback(() => setView(view === 'list' ? 'tree' : 'list'), [view])
    const disableSetSearchState = useCallback(() => setSearchState(undefined), [])

    const options = useMemo(() => [
        {
            Icon: RotateCcw,
            title: 'Refresh',
            onClick: refetch,
        },
        {
            Icon: ListX,
            title: 'Clear Search Results',
            onClick: disableSetSearchState,
        },
        {
            Icon: FilePlus,
            title: 'Open New Search Editor',
            // Hmm, this one is interesting, i think we'll be able to
            // do it, but we'll need to open this component in a tab
        },
        {
            Icon: view === 'list' ? List : ListTree,
            title: 'View as Tree',
            onClick: toggleView
        },
        {
            Icon: Copy,
            title: 'Collapse All',
            // TODO: Collapse all
        },

    ], [view])

    return (
        <div className="w-full max-w-sm text-[13px] font-sans select-none">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <span className="text-[11px] font-semibold tracking-wide">
                    SEARCH
                </span>
                <div className="flex items-center gap-3">
                    {options.map(({ Icon, title, onClick }) =>
                        <HoverCard key={title}>
                            <HoverCardTrigger>
                                <Icon onClick={() => onClick?.()} className="h-4 w-4 cursor-pointer hover:bg-gray-300 hover:text-foreground" />
                            </HoverCardTrigger>
                            <HoverCardContent className="p-2 w-fit z-50 bg-white">
                                {title}
                            </HoverCardContent>
                        </HoverCard>
                    )}
                </div>
            </div>

            <SearchViewForm onSubmit={setSearchState} />
            {data?.results && <SearchViewResults response={data} onOpenInEditor={console.log} view={view} setViewMode={setView} />}
        </div>
    );
}