import { FsFile } from "@/lib/generated"
import { listFilesQueryKey, createFileMutation } from "@/lib/generated/@tanstack/react-query.gen"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { DEFAULT_LIST_FILE_PAGINATION } from "./use-list-files.hook"

export default function useCreateFile(file?: FsFile, usePath: boolean = false) {
    const queryClient = useQueryClient()

    return useMutation({
        ...createFileMutation(),
        onSuccess: async () => {
            queryClient.invalidateQueries({
                queryKey: listFilesQueryKey({
                    query: {
                        path: (usePath ? file?.path : file?.parent) || '/',
                        ...DEFAULT_LIST_FILE_PAGINATION
                    }
                })
            })
        }
    })
}