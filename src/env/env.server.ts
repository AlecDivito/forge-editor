import 'server-only';

import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod/v4";

export const env = createEnv({
    server: {
        NODE_ENV: z.enum(['development', 'production']),
        UPSTREAM_API_URL: z.string().optional(),
    },
    experimental__runtimeEnv: process.env
});