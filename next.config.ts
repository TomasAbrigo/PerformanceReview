import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Native DuckDB bindings must be required at runtime, never bundled.
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
  experimental: {
    // Uploads (src/modules/lake/upload.ts) go through a Server Action and the
    // locale proxy: both cap the request body (1 MB / 10 MB by default).
    serverActions: { bodySizeLimit: "52mb" },
    proxyClientMaxBodySize: "52mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
