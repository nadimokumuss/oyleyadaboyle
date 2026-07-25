#!/bin/sh
set -e

# Her açılışta şema göçlerini uygula.
#
# Drizzle göçleri idempotent: zaten uygulanmışlar atlanır. Bunu
# elle yapmak yerine otomatikleştirmek, yeni sürüm dağıtıldığında
# "veritabanı şeması eski" hatasını tamamen ortadan kaldırır.
echo "→ Veritabanı göçleri uygulanıyor (${SERVET_DB_PATH:-/data/servet.db})"
node -e "
const { migrate } = require('drizzle-orm/better-sqlite3/migrator');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.SERVET_DB_PATH || '/data/servet.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

migrate(drizzle(sqlite), { migrationsFolder: './db/migrations' });
sqlite.close();
console.log('  ✓ Şema güncel');
"

echo "→ Sunucu başlatılıyor"
exec node server.js
