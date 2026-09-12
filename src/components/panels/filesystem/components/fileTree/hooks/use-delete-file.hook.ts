import { FsFile } from "@/lib/generated"
import { deleteFileMutation, listFilesQueryKey } from "@/lib/generated/@tanstack/react-query.gen"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { DEFAULT_LIST_FILE_PAGINATION } from "./use-list-files.hook"
import { WorkspaceId } from "@/lib/ws/messages"

export default function useDeleteFile(workspaceId: WorkspaceId, file: FsFile) {
    const queryClient = useQueryClient()

    return useMutation({
        ...deleteFileMutation(),
        onSuccess: async () => {
            queryClient.invalidateQueries({
                queryKey: listFilesQueryKey({
                    query: {
                        workspace_id: workspaceId,
                        path: file.parent,
                        ...DEFAULT_LIST_FILE_PAGINATION
                    }
                })
            })
        }
    })
}
