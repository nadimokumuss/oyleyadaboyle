import type { Config } from "drizzle-kit";

export default {
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.SERVET_DB_PATH ?? "./data/servet.db",
  },
} satisfies Config;
