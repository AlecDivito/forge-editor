import { searchAndReplaceFilesMutation } from "@/lib/generated/@tanstack/react-query.gen"
import { useMutation } from "@tanstack/react-query"

export default function useSearchReplaceFiles() {
    return useMutation({
        ...searchAndReplaceFilesMutation({
        }),
    })
}
