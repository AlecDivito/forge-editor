import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: 'http://localhost:8080/api.json',
  output: 'src/lib/generated',
  plugins: [
    {
        enums: 'typescript',
        name: '@hey-api/typescript',
    },
    '@tanstack/react-query',
    'zod',
    {
      name: '@hey-api/client-axios',
      runtimeConfigPath: './openapi-axios.config'
    },
  ],
});
