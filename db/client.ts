import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";

const DB_PATH = process.env.SERVET_DB_PATH ?? resolve(process.cwd(), "data/servet.db");

/**
 * Next.js dev modunda hot reload her seferinde modülü yeniden çalıştırır.
 * globalThis'te tutmazsak her reload'da yeni bir SQLite bağlantısı açılır
 * ve dosya kilitlenir.
 */
const globalForDb = globalThis as unknown as {
  __servetDb?: ReturnType<typeof createDb>;
};

function createDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);

  // WAL: okuma ve yazma birbirini kilitlemez. SSE akışı sürekli okurken
  // arayüzden yazma yapılabilmesi için gerekli.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  return drizzle(sqlite, { schema });
}

export const db = globalForDb.__servetDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.__servetDb = db;

export { schema, DB_PATH };
