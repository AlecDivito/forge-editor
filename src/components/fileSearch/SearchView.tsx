"use client";

import { useCallback, useMemo, useState } from "react";
import {
    RotateCcw,
    FilePlus,
    List,
    ListTree,
    ListX,
    CopyMinus,
    CopyPlus,
} from "lucide-react";
import { HoverCardContent, HoverCardTrigger, HoverCard } from "../ui/hover-card";
import SearchViewForm from "./components/SearchViewForm";
import useSearchFiles from "./hooks/use-search-files.hook";
import SearchViewResults from "./components/SearchViewResults";
import { ViewMode } from "./models/viewMode.model";
import { Button } from "../ui/button";
import { useFileTree } from "../fileTree/providers/FileTreeProvider";
import { FsSearchQuery } from "@/lib/generated";
import SearchViewSummary from "./components/SearchViewSummary";
import useSearchReplaceFiles from "./hooks/use-search-replace-files.hook";

export default function FileSearchView() {
    const { open, setOpen } = useFileTree();
    const { setSearchState, clearData, refetch, data, query } = useSearchFiles();
    const { mutateAsync: searchAndReplace } = useSearchReplaceFiles();
    const [view, setView] = useState<ViewMode>('list')

    const toggleView = useCallback(() => setView(view === 'list' ? 'tree' : 'list'), [view])
    const isRefreshDisabled = useMemo(() => query === undefined, [query])

    const search = useCallback((query: FsSearchQuery) => {
        setSearchState(query)
        setOpen(true)
    }, [setOpen, setSearchState])

    const replace = useCallback(async (query: FsSearchQuery) => {
        await searchAndReplace({ body: query })
        setSearchState(query)
        setOpen(true)
    }, [])

    const options = useMemo(() => [
        {
            Icon: RotateCcw,
            title: 'Refresh',
            onClick: () => refetch(),
            disabled: isRefreshDisabled
        },
        {
            Icon: ListX,
            title: 'Clear Search Results',
            onClick: clearData,
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
            Icon: open ? CopyMinus : CopyPlus,
            title: open ? 'Collapse All' : 'Expand All',
            onClick: () => setOpen(!open),
        },

    ], [view, isRefreshDisabled, open, setOpen, refetch, clearData])

    return (
        <div className="w-full h-full text-[13px] font-sans select-none overflow-auto relative bg-background">
            <div className="sticky top-0 bg-background">
                <div className="flex items-center justify-between px-4 pt-3 pb-2 ">
                    <span className="text-sm font-semibold tracking-wide">
                        SEARCH
                    </span>
                    <div className="flex items-center gap-2">
                        {options.map(({ Icon, title, disabled, onClick }) =>
                            <HoverCard key={title}>
                                <HoverCardTrigger asChild>
                                    <Button size="sm" variant='ghost' className="p-2" onClick={onClick} disabled={disabled}>
                                        <Icon className="h-4 w-4" />
                                    </Button>
                                </HoverCardTrigger>
                                <HoverCardContent className="p-2 w-fit z-50 bg-white">
                                    {title}
                                </HoverCardContent>
                            </HoverCard>
                        )}
                    </div>
                </div>
            </div>

            <SearchViewForm onSubmit={search} onReplace={replace} results={data}>
                {data?.results && <SearchViewSummary
                    response={data}
                    viewMode={view}
                    onOpenInEditor={console.log}
                    onChangeViewMode={setView}
                />}
                {data?.results && <SearchViewResults response={data} view={view} />}
            </SearchViewForm>
        </div>
    );
}