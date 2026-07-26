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
| `npm test` | Finans çekirdeği testleri (357 test) |
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

Ücretsiz bir Oracle Cloud sunucusuna adım adım kurulum:
**[DAGITIM.md](DAGITIM.md)**

`Caddyfile` otomatik HTTPS alır; panel kendi portunu dışarıya açmaz,
yalnızca ters vekil üzerinden erişilir.

> **Vercel gibi sunucusuz platformlar uygun değildir** — dosya sistemi
> geçici olduğu için SQLite veritabanı her dağıtımda silinir.

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

## Proje yapısı

```
app/           Sayfalar, API uçları, Server Actions
  (panel)/     Oturum gerektiren sayfalar
lib/
  money.ts     Para aritmetiğinin tek kaynağı
  finance/     Faiz, maliyet, amortisman, kredi, sinyal motorları
  market/      Fiyat sağlayıcıları, cache, hız sınırlayıcı
  engine/      Fırsat kuralları, Monte Carlo, dağılım önerisi
  services/    Yazma katmanı (finansman, satış, denetim)
  valuation.ts Net servet — tek doğruluk kaynağı
components/    Arayüz; form/ ve pickers/ alt klasörleri
db/            Şema, göçler, demo senaryo, referans veriler
```

Testler kaynak dosyaların yanında (`*.test.ts`): para çekirdeği, finans
formülleri ve doğrulama şemaları kapsanır. Arayüz testi yoktur.

---

Panel hesaplamaya dayalı bilgilendirme üretir. **Yatırım tavsiyesi değildir.**
