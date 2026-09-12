import { searchAndReplaceFilesMutation } from "@/lib/generated/@tanstack/react-query.gen"
import { useMutation } from "@tanstack/react-query"
import { WorkspaceId } from "@/lib/ws/messages"

export default function useSearchReplaceFiles(_workspaceId: WorkspaceId) {
    return useMutation({
        ...searchAndReplaceFilesMutation({
        }),
    })
}
