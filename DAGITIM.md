# Dağıtım rehberi — Oracle Cloud (ücretsiz)

Panel kalıcı diske ihtiyaç duyar. Oracle Cloud'un **Always Free** katmanı
süresiz ücretsiz bir sunucu veriyor ve Docker olduğu gibi çalışıyor —
uygulamada tek satır değişiklik gerekmez.

> **Neden Vercel değil:** Sunucusuz platformlarda dosya sistemi geçicidir;
> SQLite veritabanı her dağıtımda silinir. Vercel kullanmak isterseniz
> veritabanı katmanının Turso'ya taşınması gerekir — bu, uygulamadaki her
> veritabanı çağrısının asenkrona çevrilmesi demektir.

---

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
