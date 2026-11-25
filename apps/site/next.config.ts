import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // The workspace packages ship TypeScript source (no build step), so Next must compile them.
  transpilePackages: ["@ai-finops/interceptor", "@ai-finops/router"],
  // Monorepo: trace dependencies from the repository root, not from apps/dashboard.
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
};

export default config;
