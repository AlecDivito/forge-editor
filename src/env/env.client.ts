import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod/v4";

export const env = createEnv({
    client: {
        NEXT_PUBLIC_API_HOST: z.url().optional(),
    },
    runtimeEnv: {
        NEXT_PUBLIC_API_HOST: process.env.NEXT_PUBLIC_API_HOST,
    },
});
