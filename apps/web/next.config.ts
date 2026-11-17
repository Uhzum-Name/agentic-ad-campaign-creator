import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";

const config: NextConfig = {
  transpilePackages: ["@adengine/core"],
  // The browser only ever talks to the web origin; /api/* is proxied to the API server.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/v1/:path*` }];
  },
};

export default config;
