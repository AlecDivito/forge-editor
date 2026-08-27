import { FsSearchLine } from "@/lib/generated";
import { useWatch } from "react-hook-form";

interface Props {
    match: FsSearchLine;
    onClick?: () => void;
}

export default function SearchViewLineMatch({ match, onClick }: Props) {
    const replace = useWatch({ name: 'replace' })
    const preserveCase = useWatch({ name: 'preserve_case' })

    const text = match.text;
    const start = Math.max(0, Math.min(match.start, text.length));
    const end = Math.max(start, Math.min(match.end, text.length));

    return (
        <div onClick={onClick} className="flex gap-2 min-w-0 truncate whitespace-nowrap text-muted-foreground hover:bg-muted cursor-pointer px-1 rounded-sm">
            <span className="text-muted-foreground shrink-0 select-none">{match.line}</span>
            <span className="truncate">
                {text.slice(0, start)}
                {(replace || '').length === 0 ? (
                    <mark className="bg-primary/40 text-foreground rounded-sm">
                        {text.slice(start, end)}
                    </mark>
                ) : (
                    <>
                        <s className="bg-destructive/40 text-foreground rounded-sm">
                            {text.slice(start, end)}
                        </s>
                        <mark className="bg-primary/40 text-foreground rounded-sm">
                            {preserveCase ? applyCasePattern(text.slice(start, end), replace) :  replace}
                        </mark>
                    </>
                )}
                {text.slice(end)}
            </span>
        </div>
    );
}

function applyCasePattern(matched: string, replacement: string): string {
    const chars = [...matched];

    if (chars.every(c => !/\p{L}/u.test(c) || /\p{Lu}/u.test(c))) {
        return replacement.toUpperCase();
    }

    if (chars.every(c => !/\p{L}/u.test(c) || /\p{Ll}/u.test(c))) {
        return replacement.toLowerCase();
    }

    if (
        chars.length > 0 &&
        /\p{Lu}/u.test(chars[0]) &&
        chars.slice(1).every(c => !/\p{L}/u.test(c) || /\p{Ll}/u.test(c))
    ) {
        // Title case: capitalize first char, lowercase the rest
        const replacementChars = [...replacement];

        if (replacementChars.length === 0) {
            return "";
        }

        return (
            replacementChars[0].toUpperCase() +
            replacementChars.slice(1).join("").toLowerCase()
        );
    }

    // Mixed case, e.g. "camelCase" or "SCREAMING_SNAKE" partials — leave as-is
    return replacement;
}