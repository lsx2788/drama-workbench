import type { NextConfig } from "next";
const config: NextConfig = {
  outputFileTracingIncludes: {
    "/api/studio/**/*": [
      "./src/server/ai/rules/*.md",
      "./src/server/ai/skills/**/*.md",
    ],
    "/api/studio": [
      "./src/server/ai/rules/*.md",
      "./src/server/ai/skills/**/*.md",
    ],
  },
};
export default config;
