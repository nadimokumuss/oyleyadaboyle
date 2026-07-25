import type { NextConfig } from "next";

const config: NextConfig = {
  // better-sqlite3 native binding'i bundle edilmemeli
  serverExternalPackages: ["better-sqlite3"],
};

export default config;
