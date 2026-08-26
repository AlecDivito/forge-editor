import { FsSearchLine } from "@/lib/generated";

interface Props {
    match: FsSearchLine;
    onClick?: () => void;
}

export default function SearchViewLineMatch({ match, onClick }: Props) {
    const text = match.text;
    const start = Math.max(0, Math.min(match.start, text.length));
    const end = Math.max(start, Math.min(match.end, text.length));

    return (
        <div onClick={onClick} className="flex gap-2 min-w-0 truncate whitespace-nowrap text-muted-foreground hover:bg-muted cursor-pointer px-1 rounded-sm">
            <span className="text-muted-foreground shrink-0 select-none">{match.line}</span>
            <span className="truncate">
                {text.slice(0, start)}
                <mark className="bg-primary/40 text-foreground rounded-sm">
                    {text.slice(start, end)}
                </mark>
                {text.slice(end)}
            </span>
        </div>
    );
}