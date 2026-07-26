# Servet Terminali

Çok para birimli, çok ülkeli kişisel varlık yönetim paneli. Nakit, hisse,
kripto, mevduat, gayrimenkul, araç ve girişimleri tek ekranda canlı
fiyatlarla takip eder; kredileri düşer, satışları kaydeder ve gelir
fırsatları önerir.

Tüm veri kendi bilgisayarınızda (veya kendi sunucunuzda) kalır. Dışarı
yalnızca "BTC fiyatı nedir" tipi anonim sorgular gider.

---

## Kurulum

```bash
npm install
npm run db:migrate
npm run dev            # http://localhost:3000
```

İlk açılışta kurulum sihirbazı çıkar: parola belirlersiniz, ana para
biriminizi ve yaşam giderinizi girersiniz. **Panel boş başlar** —
varlıklarınızı formlardan siz eklersiniz.

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm run dev` | Geliştirme modunda çalıştırır |
| `npm run build` / `npm start` | Üretim derlemesi ve çalıştırma |
| `npm run typecheck` | TypeScript denetimi |
| `npm test` | Finans çekirdeği testleri (358 test) |
| `npm run db:generate` | Şema değişikliğinden yeni göç dosyası üretir |
| `npm run db:migrate` | Şema değişikliklerini uygular |
| `npm run db:seed` | Örnek senaryo yükler — **veritabanı doluysa reddeder** |
| `npm run db:seed -- --force` | Mevcut veriyi silip demo yükler |

> `db:seed` dolu bir veritabanını kazara silmesin diye kapı koyuldu.
> `--force` vermeden önce yedek alın.

---

## Temel kural: para kapalı devrede

Panelin en önemli davranışı bu. Bir varlık edinmek **ya nakit eksiltir ya
borç doğurur**. Her alım formunda ödeme kaynağı seçilir:

| Seçenek | Etki |
|---|---|
| **Nakit hesabımdan öde** | Seçilen hesaptan düşülür |
| **Kredi ile al** | Peşinat düşer, kalan için borç kaydı açılır |
| **Zaten sahibim** | Nakit düşmez — eski varlıkları kaydetmek için |

Sonuçları:

- 14M $ nakde 3M $'lık ev eklerseniz net servet **14M kalır** (nakit 11M, ev 3M)
- 1M peşinat + 2M kredi ile 3M'lik ev almak net serveti **değiştirmez** —
  değiştirdiği şey likidite ve aylık nakit akışıdır
- **Net servet = varlıklar − borçlar**

Bu kural olmadan panel yoktan servet üretirdi.

## Satış, kapatma, geri alma

- **Hisse/kripto:** kısmi veya tam satış, gerçekleşen K/Z hesaplanır
- **Ev/araç:** satışta **önce bağlı kredi kapanır**, kalan tutar nakde geçer
- **Mevduat:** vade sonu veya erken kapatma (faiz kaybı uyarısıyla)
- **Girişim:** çıkış tutarı veya tamamen değersizleşme

Satılan varlık **silinmez** — `sold` işaretlenir, net servetten çıkar ama
kayıtta kalır ve geçmiş performansınıza yansır.

**İşlemler** sayfasından her kaydı geri alabilirsiniz. Satışı geri almak
varlığı geri getirir, hasılatı hesabınızdan düşer ve kapatılmış krediyi
yeniden açar.

---

## Modüller

| Sayfa | İçerik |
|---|---|
| Komuta Ekranı | Canlı net servet, dağılımlar, likidite merdiveni, servet eğrisi, tutarlılık uyarıları |
| Portföy | Hisse/kripto pozisyonları, WAC+FIFO maliyet, XIRR, yoğunlaşma riski |
| Mevduat | Saniyelik canlı faiz tahakkuku, stopaj, reel getiri, karşı-olgusal karşılaştırma |
| Gayrimenkul | Endeks değerleme, net kira verimi, kur kârı / fiyat kârı ayrıştırması |
| Araç | Amortisman eğrisi, toplam sahip olma maliyeti |
| Girişim | Burn rate, runway, MOIC, başabaş ilerlemesi |
| Nakit Akışı | Gelir-gider dengesi, pasif gelir kapsama oranı |
| Borçlar | Kredi/ipotek, ödeme planı, toplam faiz maliyeti, kaldıraç, erken kapatma |
| İşlemler | Tüm para hareketleri, her biri geri alınabilir |
| Keşfet | Enstrüman arama, 1 yıllık grafik, teknik göstergeler, izleme listesi |
| Plan | Almayı düşündükleriniz — nakit yetiyor mu, alım sonrası dağılım ne olur |
| Karşılaştır | Dağılım önerisi ve "bu mu şu mu" yatırım simülasyonu |
| Fırsatlar | 10 kurallı gelir üretim motoru |
| Senaryo | Monte Carlo projeksiyonu ve kriz stres testleri |
| Ayarlar | Tercihler, hedefler, stopaj, 2FA, erişim kısıtlama, veri yönetimi |

## Veri girişi

Her varlık türü için ekle/düzenle/sil formu var (`/ekle`).

- **Sembol araması** — "THY" yazınca Yahoo ve CoinGecko'dan gerçek sonuçlar
- **Harita** — gayrimenkul konumunu tıklayarak seçersiniz; koordinat ve
  uygun konut endeksi otomatik dolar
- **Canlı önizleme** — mevduatta vade sonu kazancınızı, gayrimenkulde kira
  verimini, araçta değer kaybını, kredide taksiti form doldururken görürsünüz
- **Planlanan varlıklar** — "henüz almadım" işaretlerseniz net servete dahil
  edilmez; `/plan` sayfasında nakdinizin yetip yetmediği hesaplanır

---

## Verinin nereden geldiği

Panel her değerin kaynağını rozetle gösterir — hepsi aynı güvenilirlikte değildir.

| Rozet | Anlamı | Kaynak |
|---|---|---|
| **canlı** | Gerçek piyasa fiyatı | CoinGecko (kripto), Yahoo Finance (hisse, BIST, emtia) |
| **bayat** | Sağlayıcıya ulaşılamadı, son bilinen fiyat | cache |
| **tahakkuk** | Faiz formülüyle hesaplandı | `lib/finance/deposit.ts` |
| **model** | Endeks/amortisman ile **tahmin edildi** | `db/seeds/*.json` |
| **defter** | Elle girilen değer veya maliyet | kullanıcı girdisi |

> **Sınır 1:** Gayrimenkul ve araç için ücretsiz canlı fiyat beslemesi
> **yoktur**. Bu iki sınıfın değerleri modellenir ve arayüzde kesikli
> çerçeveyle ayrılır. Ekspertiz girerseniz model devre dışı kalır.
>
> **Sınır 2:** Hisseler için temel analiz verisi (F/K, temettü verimi)
> ücretsiz-anahtarsız erişilemiyor. `/kesfet` sayfasındaki göstergeler
> **yalnızca fiyat geçmişinden hesaplanan teknik göstergelerdir**.

Döviz kurları Frankfurter (ECB referans) üzerinden alınır. İnternet
kesilirse panel çökmez: son bilinen değerlerle çalışır ve verinin bayat
olduğunu açıkça belirtir.

---

## Tasarım kararları

**Para aritmetiği float değil.** Tüm tutarlar `decimal.js` ile taşınır ve
veritabanına ondalık string olarak yazılır. `0.1 + 0.2` tam olarak `0.3` eder.

**Bakiye saklanmaz.** Hiçbir yerde "güncel bakiye" tutulmaz; her şey
`transactions` tablosundan, canlı fiyattan ve `f(t)` formüllerinden
türetilir. Böylece veri kendisiyle çelişemez.

**Faiz tik tik yazılmaz.** Mevduat kazancı `A(t)` formülüyle anlık
hesaplanır. Panel kapalıyken de doğru kalır, açıkken saniyede birkaç kez
tazelenebilir.

**Reel getiri gizlenmez.** %42 faiz kulağa iyi gelir; %33 enflasyonla gerçek
kazanç %2'dir. Panel bunu her yerde gösterir.

**Kur kârı ile fiyat kârı ayrılır.** TL'de değerlenen bir ev USD'de
kaybettiriyor olabilir. Alım kaydedilirken o günün kuru saklanır, böylece
ayrıştırma gerçek tarihsel kurla yapılır.

**İki tutar ancak aynı para birimindeyse karşılaştırılır.** `Money` sınıfı
toplama, çıkarma ve oranlamada para birimi eşitliğini zorunlu tutar; farklı
birimler sessizce toplanamaz. Çevrim yalnızca `lib/fx.ts` üzerinden yapılır.
`Money.withCurrency` **yalnızca etiketi** değiştirir, tutarı çevirmez —
hesaplamada asla kullanılmamalıdır. Bu kural bir kez çiğnendiğinde (bir
varlığın kayıtlı para birimi ile kotasyonunun geldiği para birimi farklı
olduğunda) USD maliyet TRY piyasa değerinden çıkarılıp anlamsız bir
kâr/zarar üretilmişti; koruma tam da bunun için var.

**Planlanan varlık servete sayılmaz.** Sahip olmadığınız bir evi servetinize
eklemek, kendinizi olduğunuzdan zengin sanmanıza yol açar.

**Panel kendini denetler.** Nakit eksiye düşerse, bir varlık ödemesiz
eklenirse veya satılan varlığın kredisi açık kalırsa komuta ekranında uyarı
çıkar.

---

## Güvenlik

Yerel kullanımda parola kilidi yeterlidir. **İnternete açarsanız** durum
değişir — panelin tamamı servetinizdir.

`SERVET_PUBLIC=1` ortam değişkeni sıkı modu açar:

- Parola asgari 12 karakter (uzun bir cümle en kolayı)
- Oturum 12 saat yerine 2 saat
- Çerez yalnızca HTTPS üzerinden
- HSTS ve güvenlik başlıkları

Ayrıca **Ayarlar** sayfasından:

- **İki faktörlü doğrulama (TOTP)** — Google Authenticator, 1Password, Authy
  uyumlu. 8 adet tek kullanımlık kurtarma kodu üretilir.
- **IP kısıtlaması** — CIDR destekli. Sabit IP'niz varsa paneli pratikte
  dünyanın geri kalanından gizler.
- **Giriş kayıtları** — tanımadığınız bir IP'den deneme görürseniz fark edersiniz

Giriş denemeleri veritabanında tutulur; sunucu yeniden başlatılınca kilit
sıfırlanmaz.

---

## Yedekleme

**Bunu ihmal etmeyin.** Veritabanı tek dosya:

```bash
cp data/servet.db "yedek-$(date +%F).db"
```

CSV dışa aktarım da var: **Ayarlar → Veri**, veya doğrudan
`/api/export?type=positions|transactions|snapshots`

Aynı yerden CSV içe aktarabilirsiniz (nakit ve piyasa pozisyonları).

---

## Canlıya alma

Panel Docker ile kalıcı diskli herhangi bir sunucuda çalışır.

```bash
docker compose up -d --build
```

Adım adım kurulum — iki seçenek: **[DAGITIM.md](DAGITIM.md)**

| Yol | Özet |
|---|---|
| **Railway** | Depoyu bağla, `/data` diskini ekle, biter. ~10 dk, ~5 $/ay |
| **Oracle Cloud** | Kendi sunucunuz, süresiz ücretsiz. ~1 saat |

Kendi sunucunuzda `Caddyfile` otomatik HTTPS alır; panel kendi portunu
dışarıya açmaz, yalnızca ters vekil üzerinden erişilir. Railway'de bu işi
platform üstlenir.

> **Vercel gibi sunucusuz platformlar uygun değildir** — dosya sistemi
> geçici olduğu için SQLite veritabanı her dağıtımda silinir, ayrıca
> SSE akışı fonksiyon ömrüne takılır.

---

## Ayarlanabilir varsayımlar

Bu değerler **temsilîdir**; resmî kaynaklardan güncellenmelidir:

| Ne | Nerede |
|---|---|
| Konut fiyat endeksleri, enflasyon | `db/seeds/indices.json` |
| Araç amortisman eğrileri | `db/seeds/depreciation.json` |
| Stopaj oranları | Ayarlar sayfası (`withholding_rates` tablosu) |
| Getiri/risk varsayımları | `lib/engine/montecarlo.ts` |

---

## Bilinen sınırlar

**Tek kopya çalışır.** Veritabanı tek bir SQLite dosyasıdır. İkinci bir kopya
aynı diske yazarsa veri bozulur — bu yüzden `railway.json` içinde
`numReplicas: 1` sabitlenmiştir. Yatay ölçekleme istiyorsanız önce veritabanı
katmanı değişmelidir.

**Sunucusuz platformlar uygun değildir.** Vercel gibi ortamlarda dosya sistemi
geçicidir; veritabanı her dağıtımda silinir. Ayrıca `app/api/stream/route.ts`
süresiz açık bir SSE bağlantısı tutar, sunucusuz fonksiyon ömrü buna yetmez.
Ayrıntı: [DAGITIM.md](DAGITIM.md).

**BIST verisi ~15 dakika gecikmelidir.** Yahoo Finance'in anahtarsız ucundan
gelir; arayüz gecikmeyi rozetle belirtir.

**Fiyat sağlayıcıları anahtarsızdır.** Yahoo ve CoinGecko'nun herkese açık
uçları kullanılır. Hız sınırına takılırsa panel son bilinen fiyatı "bayat"
işaretiyle gösterir — uydurma fiyat üretmez.

**Arayüz testi yoktur.** Testler finans çekirdeğini kapsar; sayfalar ve
formlar elle denenir.

---

## Proje yapısı

```
app/
  (panel)/     Oturum gerektiren sayfalar (komuta ekranı, portföy, plan…)
  actions/     Server Actions — yazma işlemlerinin girişi
  api/         SSE akışı, fiyat/kur uçları, arama, dışa aktarma, sağlık
  giris/       Giriş; kurulum/ ilk kurulum sihirbazı
lib/
  money.ts     Para aritmetiğinin tek kaynağı (birim güvenliği burada)
  fx.ts        Kur çevrimi ve getiri ayrıştırması
  finance/     Faiz, maliyet esası, amortisman, kredi, sinyal motorları
  market/      Fiyat sağlayıcıları, önbellek, hız sınırlayıcı
  engine/      Fırsat kuralları, Monte Carlo, dağılım önerisi
  services/    Yazma katmanı (finansman, satış, içe aktarma, denetim)
  valuation.ts Net servet — tek doğruluk kaynağı
  auth.ts      Oturum ve ikinci faktör; security.ts kaba kuvvet koruması
components/    Arayüz; form/ (girdi öğeleri), forms/ (tam formlar), pickers/
db/            Şema, göçler, demo senaryo, referans veriler
```

Testler kaynak dosyaların yanında (`*.test.ts`): para çekirdeği, finans
formülleri ve doğrulama şemaları kapsanır.

**Şema değiştirirken:** `db/schema.ts` düzenlenir → `npm run db:generate`
göç dosyasını üretir → üretilen SQL okunarak doğrulanır → `npm run db:migrate`
uygular. Sunucuda göçler `docker-entrypoint.sh` ile açılışta kendiliğinden
çalışır.

---

Panel hesaplamaya dayalı bilgilendirme üretir. **Yatırım tavsiyesi değildir.**
