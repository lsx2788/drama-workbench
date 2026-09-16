import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["node:sqlite", "pdfjs-dist", "mammoth"],
};
export default config;
