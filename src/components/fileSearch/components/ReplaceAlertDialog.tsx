import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { FsSearchResponse } from "@/lib/generated"
import { ArrowLeftRight } from "lucide-react"

interface Props {
    results?: FsSearchResponse
    replacement?: string
    onSubmit: () => void
}

export function ReplaceAlertDialog({
    results,
    replacement,
    onSubmit,
}: Props) {
    const fileCount = results?.results?.length ?? 0
    const occurrencesCount = results?.results?.reduce((total, current) => total + current.matches.length, 0) ?? 0
    const isDisabled = fileCount === 0 || (replacement?.length || 0) === 0
    console.log(fileCount, occurrencesCount, replacement)

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <button
                    type="button"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                    aria-label="Replace All"
                    title="Replace all"
                    disabled={isDisabled}
                >
                    <ArrowLeftRight className="h-4 w-4" />
                </button>
            </AlertDialogTrigger>

            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Replace {occurrencesCount}{" "}{occurrencesCount === 1 ? "occurrence" : "occurrences"}{" "}
                        across {fileCount}{" "}
                        {fileCount === 1 ? "file" : "files"}?
                    </AlertDialogTitle>

                    <AlertDialogDescription>
                        This will replace all matching occurrences with{" "}
                        <span className="font-medium">
                            &quot;{replacement}&quot;
                        </span>
                        . This action cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter>
                    <AlertDialogCancel>
                        Cancel
                    </AlertDialogCancel>

                    <AlertDialogAction onClick={onSubmit}>
                        Replace
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
