# Dağıtım rehberi

Panel kalıcı diske ihtiyaç duyar. İki yol var; ikisinde de uygulamada
**tek satır değişiklik gerekmez**, ikisi de aynı `Dockerfile`'ı kullanır.

| | [Railway](#railway--en-kolay-yol) | [Oracle Cloud](#oracle-cloud--süresiz-ücretsiz) |
|---|---|---|
| Kurulum süresi | ~10 dakika | ~1 saat |
| Sunucu yönetimi | Yok | Size ait (SSH, güncelleme, güvenlik duvarı) |
| HTTPS | Otomatik | Caddy ile otomatik |
| Maliyet | ~5 $/ay (5 $ deneme kredisi ile başlar) | Süresiz ücretsiz |
| Uygun olduğu durum | Uğraşmadan yayına almak | Sıfır maliyet, tam kontrol |

> **Neden Vercel değil:** Sunucusuz platformlarda dosya sistemi geçicidir;
> SQLite veritabanı her dağıtımda silinir. Ayrıca `app/api/stream/route.ts`
> içindeki SSE akışı süresiz açık kalır — sunucusuz fonksiyonların ömrü
> sınırlıdır, akış kesilir ve her yeniden bağlanma ayrı fatura üretir.
> Vercel'de çalıştırmak için veritabanının Turso'ya taşınması (uygulamadaki
> ~174 senkron veritabanı çağrısının asenkrona çevrilmesi) ve SSE'nin
> yoklamaya (polling) dönüştürülmesi gerekir.

---

# Railway — en kolay yol

Railway `Dockerfile`'ı olduğu gibi alır, kalıcı disk verir ve HTTPS'li bir
alan adını kendisi ayarlar. Caddy'ye gerek yoktur — ters vekil ve sertifika
işini platform üstlenir.

## 1. Depoyu bağla

1. [railway.app](https://railway.app) → GitHub hesabınızla girin
2. **New Project → Deploy from GitHub repo** → bu depoyu seçin
3. Railway `railway.json`'ı okur ve `Dockerfile` ile derlemeye başlar.
   **İlk derleme başarısız olursa panik yapmayın** — 2. adımdaki diski
   eklemeden önce uygulama `/data`ya yazamaz.

## 2. Kalıcı diski ekle — en önemli adım

Servise tıklayın → **Variables** sekmesinin yanındaki **Volumes** →
**+ New Volume**:

- **Mount path:** `/data`

Bu adım atlanırsa veritabanı konteynerin geçici diskine yazılır ve
**her dağıtımda tüm varlıklarınız silinir.** `SERVET_DB_PATH` zaten
`Dockerfile` içinde `/data/servet.db` olarak ayarlı; bağlama yolunun
buna denk gelmesi gerekir.

## 3. Ortam değişkenleri

Zorunlu bir değişken yok — `SERVET_PUBLIC=1` ve `SERVET_DB_PATH`
`Dockerfile` içinde ayarlı, `PORT`'u Railway kendisi atar. Parolanız
ortam değişkeninde değil, ilk açılıştaki kurulum sihirbazında belirlenir
ve veritabanında saklanır.

## 4. Alan adını al

**Settings → Networking → Generate Domain** → `...up.railway.app` biçiminde
HTTPS'li bir adres verir. Kendi alan adınız varsa **Custom Domain** ile
ekleyip DNS'te bir `CNAME` kaydı gösterirsiniz.

## 5. Aç ve kurulumu tamamla

Adrese girin → kurulum sihirbazı çıkar → parolanızı belirleyin, ana para
biriminizi ve yaşam giderinizi girin. Panel boş başlar.

## Bilinmesi gerekenler

- **Kopya sayısı 1 kalmalı.** `railway.json` içinde `numReplicas: 1` bunun
  için sabitlendi. SQLite tek dosyadır; birden fazla kopya aynı diske
  yazarsa veri bozulur.
- **Göçler kendiliğinden çalışır.** `docker-entrypoint.sh` her açılışta
  şemayı günceller; elle bir şey yapmanız gerekmez.
- **Güncelleme:** `git push` yeterli — Railway yeni sürümü kendi derler.
- **Yedekleme:** Panel içindeki dışa aktarma (`/api/export`) en pratik yol.
  Railway diskleri için ayrıca **Settings → Volume → Backups** açılabilir.
- **Uyku yok:** Railway servisleri hareketsizlikte uyutmaz; SSE akışı
  kesintisiz çalışır. Karşılığında kullanım kadar ücretlenirsiniz.

Yayına aldıktan sonra aşağıdaki [güvenlik kontrol listesini](#güvenlik-kontrol-listesi)
gözden geçirin — SSH maddesi dışındaki her şey Railway için de geçerli.

---

# Oracle Cloud — süresiz ücretsiz

Oracle Cloud'un **Always Free** katmanı süresiz ücretsiz bir sunucu
veriyor ve Docker olduğu gibi çalışıyor. Karşılığında sunucuyu siz
yönetirsiniz.

## Ne alacaksınız (ücretsiz)

| Kaynak | Miktar |
|---|---|
| İşlemci | 2 çekirdek ARM (Ampere A1) |
| Bellek | 12 GB |
| Disk | 200 GB'a kadar |
| Trafik | Aylık 10 TB |
| Süre | **Süresiz** — hesap aktif kaldığı sürece |

Doğrulama için kredi kartı istenir ama **ücret çekilmez**. Hesap "Always
Free" sınırları içinde kaldığı sürece faturalandırma başlamaz.

> Haziran 2026'da ücretsiz ARM sınırı 4 çekirdek/24 GB'dan 2 çekirdek/12 GB'a
> düşürüldü. Bu panel için fazlasıyla yeterli.

---

## 1. Sunucuyu oluştur

1. [cloud.oracle.com](https://cloud.oracle.com) → hesap açın
   (Türkiye'yi ve size en yakın bölgeyi seçin — Frankfurt önerilir)
2. **Compute → Instances → Create Instance**
3. Ayarlar:
   - **Image:** Canonical Ubuntu 24.04
   - **Shape:** `VM.Standard.A1.Flex` → **2 OCPU, 12 GB** (Always Free etiketli)
   - **SSH keys:** "Generate a key pair for me" → **özel anahtarı indirin**
   - **Boot volume:** 50 GB yeterli
4. **Create**

Birkaç dakika içinde bir **genel IP adresi** alırsınız.

> ARM sunucu bulamıyorsanız ("out of capacity" hatası): bu bölgede geçici
> olarak stok yok demektir. Başka bir bölge deneyin veya birkaç saat sonra
> tekrar deneyin — sık karşılaşılan bir durum.

## 2. Portları aç

Oracle varsayılan olarak her şeyi kapalı tutar. İki yerde açmak gerekir:

**a) Sanal ağ kuralları:** Instance → Subnet → Security List → **Add Ingress Rules**

| Kaynak | Port |
|---|---|
| `0.0.0.0/0` | 80 |
| `0.0.0.0/0` | 443 |

**b) Sunucunun kendi güvenlik duvarı** — sunucuya bağlandıktan sonra
(3. adımdaki komutlar bunu hallediyor).

## 3. Sunucuya bağlan ve hazırla

```bash
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@SUNUCU_IP
```

Bağlandıktan sonra tek seferde:

```bash
# Docker kur
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu

# Ubuntu'nun güvenlik duvarında portları aç
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save

# Oturumu yenile (docker grubu için)
exit
```

Tekrar bağlanın.

## 4. Kodu sunucuya al

```bash
# GitHub deposu özelse önce sunucuda kimlik doğrulaması gerekir:
sudo apt install -y gh && gh auth login

git clone https://github.com/KULLANICI_ADINIZ/servet-terminali.git
cd servet-terminali
```

## 5. Alan adını ayarla

`Caddyfile` dosyasını açıp ilk satırdaki `ALAN_ADINIZ` yerine kendi alan
adınızı yazın:

```bash
nano Caddyfile
```

**Alan adınız yoksa:** ücretsiz bir alt alan adı alabilirsiniz
([DuckDNS](https://duckdns.org) gibi) veya IP adresini yazıp `tls internal`
satırını etkinleştirin — o durumda tarayıcı sertifika uyarısı verir.

Alan adı aldıysanız DNS'te bir **A kaydı** oluşturup sunucunuzun IP'sine
yönlendirin. Yayılması birkaç dakika sürebilir.

## 6. Çalıştır

```bash
docker compose up -d --build
```

İlk derleme ARM üzerinde 5–10 dakika sürer (`better-sqlite3` kaynaktan
derlenir). Sonraki güncellemeler çok daha hızlıdır.

Durumu izlemek için:

```bash
docker compose logs -f
```

`✓ Şema güncel` ve `Ready` satırlarını görünce hazırdır.

## 7. Aç ve kurulumu tamamla

`https://ALAN_ADINIZ` adresine gidin. Kurulum sihirbazı çıkar.

- **Uzun bir parola seçin** — panel internete açık olduğu için asgari
  12 karakter zorunlu. Bir cümle en kolayı: `kirmizi kedi merdivende uyudu`
- Kurulumdan hemen sonra **Ayarlar → İki faktörlü doğrulama**'yı açın
- **Kurtarma kodlarını** parola yöneticinize kaydedin — bir daha gösterilmez

---

## Verilerinizi taşımak

Bilgisayarınızdaki panelde veriniz varsa iki yol var:

**a) CSV ile (temiz yol)**
Yerel panelde **Ayarlar → Veri → Varlıklar CSV** indirin, canlı panelde
**Ayarlar → İçe aktarım** ile yükleyin. Mevduat, gayrimenkul ve girişim
CSV'de tam taşınmaz; onları formdan girersiniz.

**b) Veritabanını kopyalayarak (her şey taşınır)**
```bash
# Yerelde
scp -i ~/Downloads/ssh-key-*.key data/servet.db ubuntu@SUNUCU_IP:~/

# Sunucuda
docker compose stop servet
docker cp ~/servet.db $(docker compose ps -q servet):/data/servet.db
docker compose start servet
```
Bu yöntem PIN'inizi de taşır — canlı panele yerel parolanızla girersiniz.

---

## Yedekleme

Veritabanı tek dosya. Düzenli yedek alın:

```bash
# Sunucudan bilgisayarınıza indir
ssh -i ~/Downloads/ssh-key-*.key ubuntu@SUNUCU_IP \
  "docker compose -f ~/servet-terminali/docker-compose.yml exec -T servet cat /data/servet.db" \
  > yedek-$(date +%F).db
```

Bunu haftalık bir görev olarak takviminize koymanızı öneririm.

---

## Güncelleme

```bash
ssh -i ~/Downloads/ssh-key-*.key ubuntu@SUNUCU_IP
cd servet-terminali
git pull
docker compose up -d --build
```

Şema göçleri açılışta otomatik uygulanır; veriniz korunur.

---

## Sorun giderme

| Belirti | Sebep ve çözüm |
|---|---|
| Sayfa açılmıyor | Oracle güvenlik listesinde 80/443 açık mı? `iptables` kuralları kaydedildi mi? |
| Sertifika hatası | DNS A kaydı sunucunun IP'sine yayılmış mı? `dig ALAN_ADINIZ` ile kontrol edin |
| `out of capacity` | ARM stoğu geçici olarak yok; başka bölge veya birkaç saat sonra deneyin |
| Derleme çok uzun | Normal — ARM'de `better-sqlite3` kaynaktan derleniyor, ilk seferde 5–10 dk |
| Kendinizi IP kısıtlamasıyla kilitlediniz | `docker compose exec servet node -e "..."` yerine: sunucuda `sqlite3` ile `UPDATE settings SET allowed_ips = NULL;` |

---

## Güvenlik kontrol listesi

- [ ] Parola en az 12 karakter, tercihen bir cümle
- [ ] İki faktörlü doğrulama açık
- [ ] Kurtarma kodları güvenli bir yerde
- [ ] HTTPS çalışıyor (adres çubuğunda kilit simgesi)
- [ ] SSH'a yalnızca anahtarla girilebiliyor (Oracle varsayılanı böyle)
- [ ] Yedekleme alışkanlığı kuruldu

Panel giriş denemelerini kaydeder; **Ayarlar → Giriş kayıtları**'nda
görürsünüz. Tanımadığınız bir IP'den denemeler varsa parolanızı değiştirin
ve IP kısıtlamasını açın.

---

## Maliyet

**Sıfır.** Always Free sınırları içinde kaldığınız sürece ücret çıkmaz.
Tek olası masraf alan adı (isteğe bağlı, yılda birkaç dolar).

Hesabınızı "Pay As You Go"a yükseltmeyin — Always Free kaynakları yine
ücretsiz kalır ama yanlışlıkla ücretli bir kaynak açma riski doğar.
