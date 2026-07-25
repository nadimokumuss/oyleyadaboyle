# Servet Terminali

Çok para birimli, çok ülkeli, canlı çalışan kişisel varlık yönetim paneli.
Tüm veri kendi bilgisayarınızda kalır; dışarı yalnızca "BTC fiyatı nedir"
tipi anonim fiyat sorguları gider.

## Kurulum

```bash
npm install
npm run db:migrate     # veritabanını oluşturur
npm run dev            # http://localhost:3000
```

İlk açılışta bir kurulum sihirbazı çıkar: PIN belirlersiniz, ana para
biriminizi ve yaşam giderinizi girersiniz. **Panel boş başlar** —
varlıklarınızı formlardan siz eklersiniz.

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm run dev` | Paneli geliştirme modunda çalıştırır |
| `npm run build` / `npm start` | Üretim derlemesi ve çalıştırma |
| `npm run typecheck` | TypeScript denetimi |
| `npm test` | Finans çekirdeği testleri |
| `npm run db:migrate` | Şema değişikliklerini uygular |
| `npm run db:seed` | Demo senaryoyu yükler (**mevcut veriyi siler**) |

## Modüller

| Sayfa | İçerik |
|---|---|
| Komuta Ekranı | Canlı net servet, dağılımlar, likidite merdiveni, servet eğrisi |
| Keşfet | Enstrüman arama, 1 yıllık grafik, teknik göstergeler, izleme listesi |
| Plan | Almayı düşündükleriniz — nakit yetiyor mu, alım sonrası ne olur |
| Karşılaştır | Dağılım önerisi ve "bu mu şu mu" yatırım simülasyonu |
| Portföy | Hisse/kripto pozisyonları, WAC+FIFO maliyet, XIRR, yoğunlaşma riski |
| Mevduat | Saniyelik canlı faiz tahakkuku, stopaj, reel getiri, karşı-olgusal karşılaştırma |
| Gayrimenkul | Endeks değerleme, net kira verimi, kur kârı / fiyat kârı ayrıştırması |
| Araç | Amortisman eğrisi, toplam sahip olma maliyeti |
| Girişim | Burn rate, runway, MOIC, başabaş ilerlemesi |
| Nakit Akışı | Gelir-gider dengesi, pasif gelir kapsama oranı |
| Borçlar | Kredi/ipotek, ödeme planı, toplam faiz maliyeti, erken kapatma |
| İşlemler | Tüm para hareketleri, her biri geri alınabilir |
| Fırsatlar | 10 kurallı gelir üretim motoru |
| Senaryo | Monte Carlo projeksiyonu ve kriz stres testleri |
| Ayarlar | Tercihler, hedef dağılım, stopaj oranları, PIN, veri yönetimi |

## Veri girişi

Her varlık türü için ekle/düzenle/sil formu var (`/ekle`).

- **Sembol araması** — "THY" yazınca Yahoo ve CoinGecko'dan gerçek sonuçlar gelir
- **Harita** — gayrimenkul konumunu tıklayarak veya pini sürükleyerek seçersiniz;
  koordinat ve uygun konut endeksi otomatik dolar
- **Canlı önizleme** — mevduatta vade sonu kazancınızı, gayrimenkulde kira
  verimini, araçta değer kaybını form doldururken görürsünüz
- **Planlanan varlıklar** — "henüz almadım" kutusunu işaretlerseniz net servete
  dahil edilmez; `/plan` sayfasında nakdinizin yetip yetmediği hesaplanır

## Verinin nereden geldiği

Panel her değerin kaynağını rozetle gösterir — hepsi aynı güvenilirlikte değildir.

| Rozet | Anlamı | Kaynak |
|---|---|---|
| **canlı** | Gerçek piyasa fiyatı | CoinGecko (kripto), Yahoo Finance (hisse, BIST, emtia) |
| **bayat** | Sağlayıcıya ulaşılamadı, son bilinen fiyat | cache |
| **tahakkuk** | Faiz formülüyle hesaplandı | `lib/finance/deposit.ts` |
| **model** | Endeks/amortisman ile **tahmin edildi** | `db/seeds/*.json` |
| **defter** | Elle girilen değer veya maliyet | kullanıcı girdisi |

> **Önemli sınır 1:** Gayrimenkul ve araç için ücretsiz canlı fiyat beslemesi
> **yoktur**. Bu iki sınıfın değerleri modellenir ve arayüzde kesikli çerçeveyle
> ayrılır. Gerçek bir ekspertiz girerseniz model devre dışı kalır.
>
> **Önemli sınır 2:** Hisseler için temel analiz verisi (F/K, temettü verimi)
> ücretsiz-anahtarsız erişilemiyor — Yahoo'nun ilgili ucu yetkilendirme
> istiyor. Bu yüzden `/kesfet` sayfasındaki göstergeler **yalnızca fiyat
> geçmişinden hesaplanan teknik göstergelerdir** ve sayfada böyle etiketlenir.

Döviz kurları Frankfurter (ECB referans) üzerinden günlük alınır. İnternet
kesilirse panel çökmez: son bilinen değerlerle çalışmaya devam eder ve verinin
bayat olduğunu açıkça belirtir.

## Tasarım kararları

**Para aritmetiği float değil.** Tüm tutarlar `decimal.js` ile taşınır ve
veritabanına ondalık string olarak yazılır. `0.1 + 0.2` tam olarak `0.3` eder.

**Bakiye saklanmaz.** Hiçbir yerde "güncel bakiye" tutulmaz; her şey
`transactions` tablosundan, canlı fiyattan ve `f(t)` formüllerinden türetilir.
Böylece veri kendisiyle çelişemez.

**Faiz tik tik yazılmaz.** Mevduat kazancı veritabanına yazılmaz, `A(t)`
formülüyle anlık hesaplanır. Panel kapalıyken de doğru kalır, açıkken saniyede
birkaç kez tazelenebilir.

**Reel getiri gizlenmez.** %42 faiz kulağa iyi gelir; %33 enflasyonla gerçek
kazanç %2'dir. Panel bunu her yerde açıkça gösterir.

**Kur kârı ile fiyat kârı ayrılır.** TL'de değerlenen bir ev USD'de
kaybettiriyor olabilir — panel bu iki etkiyi ve çapraz terimi ayrı gösterir.
Alım kaydederken o günün kuru Frankfurter'dan çekilip saklanır, böylece
ayrıştırma gerçek tarihsel kurla yapılır.

**Para kapalı devrede.** Bir varlık edinmek ya nakit eksiltir ya borç doğurur.
Her alım formunda ödeme kaynağı seçilir: nakit hesabından öde, kredi ile al,
veya "zaten sahibim" (eski varlıkları kaydetmek için). Bu olmadan panel yoktan
servet üretirdi — 14M nakde 3M ev ekleyip 17M göstermek gibi.

**Net servet = varlıklar − borçlar.** 1M peşinat + 2M kredi ile 3M&apos;lik ev
almak net servetinizi değiştirmez; değiştirdiği şey likidite ve aylık nakit
akışıdır.

**Satılan varlık silinmez.** `sold`/`closed` işaretlenir, net servetten çıkar
ama kayıtta kalır ve gerçekleşen kâr-zararınız hesaplanır. Sattığınız evi
silmek, o evi hiç almamış gibi yapmak olurdu.

**Her işlem geri alınabilir.** İşlemler sayfasından bir kaydı silmek etkilerini
de geri alır; satışı geri almak varlığı geri getirir ve kapatılan krediyi
yeniden açar.

**Panel kendini denetler.** Nakit eksiye düşerse, bir varlık ödemesiz eklenirse
veya satılan varlığın kredisi açık kalırsa komuta ekranında uyarı çıkar.

**Planlanan varlık servete sayılmaz.** Sahip olmadığınız bir evi servetinize
eklemek, kendinizi olduğunuzdan zengin sanmanıza yol açar. Planlananlar ayrı
tutulur; "satın aldım" dediğinizde gerçek varlığa döner ve nakit düşülür.

## Yedekleme

Veritabanı tek dosyadır: `data/servet.db`. Yedeklemek için kopyalamak yeterli.

```bash
cp data/servet.db "yedek-$(date +%F).db"
```

CSV dışa aktarım komuta ekranındaki düğmelerden veya doğrudan:
`/api/export?type=positions|transactions|snapshots`

## Ayarlar

`/ayarlar` sayfasından: ana para birimi, aylık yaşam gideri, risk profili,
yatırım vadesi, atıl nakit eşiği, yoğunlaşma eşiği, hedef dağılım, PIN
değiştirme, CSV içe/dışa aktarım ve tüm veriyi silme.

Stopaj oranları da orada listelenir — mevzuat değiştiğinde koda dokunmadan
güncellenebilir.

Enflasyon ve konut endeksi varsayımları `db/seeds/indices.json`, araç
amortisman eğrileri `db/seeds/depreciation.json` dosyalarındadır. Bu değerler
**temsilîdir**; resmî kaynaklardan (TÜİK, FHFA, Eurostat) güncellenmelidir.

---

Panel hesaplamaya dayalı bilgilendirme üretir. **Yatırım tavsiyesi değildir.**
