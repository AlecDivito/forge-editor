import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async redirects() {
    return [
      {
        source: "/app/page",
        destination: "/demo",
        permanent: true, // Set to true for a 301 redirect
      },
    ];
  },
};

export default nextConfig;
