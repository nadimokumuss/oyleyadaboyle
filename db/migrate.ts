import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db, DB_PATH } from "./client";

migrate(db, { migrationsFolder: "./db/migrations" });
console.log(`✓ Migration tamamlandı → ${DB_PATH}`);
