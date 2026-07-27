import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Duman testi için ayrı yapılandırma.
 *
 * `vitest.config.ts` yalnızca `lib/**` altındaki hızlı birim testlerini
 * çalıştırır ve öyle kalmalı — `npm test` 1,5 saniye sürüyor, sık
 * çalıştırılıyor. Duman testi bir Next sunucusu açtığı için dakikalar
 * sürebilir; ikisini karıştırmak hızlı testleri çalıştırma alışkanlığını
 * bozardı.
 */
export default defineConfig({
  resolve: {
    alias: { "@": resolve(import.meta.dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["smoke/**/*.smoke.test.ts"],
    // Sunucu açılışı + Next'in her rotayı ilk istekte derlemesi uzun sürer.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Tek dosya, tek sunucu — paralellik yok.
    fileParallelism: false,
  },
});
