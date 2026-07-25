# Servet Terminali — üretim imajı
#
# Çok aşamalı derleme: son imaj yalnızca çalışmak için gerekenleri
# içerir, kaynak kod ve derleme araçları taşınmaz.
#
# better-sqlite3 yerel bir C++ eklentisi olduğu için derleme aşamasında
# build-essential gerekir; çalışma aşamasına yalnızca derlenmiş .node
# dosyası geçer.

# ---------- 1. Bağımlılıklar ----------
FROM node:22-slim AS deps
WORKDIR /app

# better-sqlite3'ü kaynaktan derlemek için gerekli araçlar
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

# ---------- 2. Derleme ----------
FROM node:22-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Derleme sırasında veritabanına dokunulmaz; sadece tipler ve paketleme
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- 3. Çalışma ----------
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    SERVET_PUBLIC=1 \
    SERVET_DB_PATH=/data/servet.db

# Kök olmayan kullanıcı — bir güvenlik açığı çıkarsa etkisi sınırlı kalsın
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# Yalnızca çalışmak için gerekenler
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migration için gerekli dosyalar
COPY --from=builder --chown=nextjs:nodejs /app/db ./db
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Veritabanının yaşayacağı yer — kalıcı disk buraya bağlanır
RUN mkdir -p /data && chown nextjs:nodejs /data
VOLUME /data

USER nextjs
EXPOSE 3000

# Sağlık kontrolü: uygulama ayakta mı?
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
