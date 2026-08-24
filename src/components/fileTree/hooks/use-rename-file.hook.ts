import { FsFile } from "@/lib/generated"
import { listFilesQueryKey, renameFileMutation } from "@/lib/generated/@tanstack/react-query.gen"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { DEFAULT_LIST_FILE_PAGINATION } from "./use-list-files.hook"

export default function useRenameFile(file: FsFile) {
    const queryClient = useQueryClient()

    return useMutation({
        ...renameFileMutation(),
        onSuccess: async (data) => {
            queryClient.invalidateQueries({
                queryKey: listFilesQueryKey({
                    query: {
                        path: data.from.parent,
                        ...DEFAULT_LIST_FILE_PAGINATION
                    }
                })
            })
            queryClient.invalidateQueries({
                queryKey: listFilesQueryKey({
                    query: {
                        path: data.to.parent,
                        ...DEFAULT_LIST_FILE_PAGINATION
                    }
                }),
            })
        }
    })
}