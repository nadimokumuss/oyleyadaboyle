# Dağıtım rehberi

Panel kalıcı diske ihtiyaç duyar. Bu belge Fly.io üzerinden anlatıyor;
Railway, Render veya kendi sunucunuz da aynı mantıkla çalışır.

> **Vercel'e kurulamaz.** Sunucusuz platformlarda dosya sistemi geçicidir;
> SQLite veritabanı her dağıtımda ve çoğu zaman istekler arasında silinir.
> Vercel'i mutlaka kullanmak isterseniz veritabanı katmanının Turso gibi
> barındırılan bir SQLite servisine taşınması gerekir.

---

## Fly.io ile dağıtım

### 1. Hazırlık

```bash
brew install flyctl      # macOS
fly auth signup          # veya: fly auth login
```

### 2. Uygulamayı oluştur

```bash
cd ~/Desktop/öyleyadaböyle
fly launch --no-deploy --name SIZIN-SECTIGINIZ-AD
```

`fly.toml` dosyasındaki `app` alanını da aynı adla güncelleyin.

### 3. Kalıcı disk oluştur

**En kritik adım.** Bu olmadan verileriniz her dağıtımda silinir.

```bash
fly volumes create servet_data --size 1 --region fra
```

1 GB fazlasıyla yeter — veritabanı yıllar sonra bile birkaç megabayt kalır.

### 4. Dağıt

```bash
fly deploy
```

İlk açılışta şema göçleri otomatik uygulanır (`docker-entrypoint.sh`).

### 5. Aç ve kurulumu yap

```bash
fly open
```

Kurulum sihirbazı çıkar. **Uzun bir parola seçin** — panel internete açık
olduğu için asgari 12 karakter zorunlu tutulur.

### 6. İki faktörlü doğrulamayı aç

Kurulumdan hemen sonra **Ayarlar → İki faktörlü doğrulama**. Bunu atlamayın:
parolanızı ele geçiren biri doğrudan tüm servetinizi görür.

Kurtarma kodlarını bir parola yöneticisine kaydedin — bir daha gösterilmez.

### 7. (İsteğe bağlı) IP kısıtlaması

Ev veya ofis IP'niz sabitse **Ayarlar → Erişim kısıtlama** bölümünden
ekleyin. Bu, paneli pratikte dünyanın geri kalanından tamamen gizler.

> Dikkat: mobil bağlantı veya dinamik IP kullanıyorsanız kendinizi
> kilitleyebilirsiniz. Kilitlenirseniz:
> ```bash
> fly ssh console
> # sqlite3 /data/servet.db "UPDATE settings SET allowed_ips = NULL;"
> ```

---

## Yedekleme

Veritabanı tek dosya: `/data/servet.db`.

```bash
# Sunucudan indir
fly ssh console -C "cat /data/servet.db" > yedek-$(date +%F).db

# Veya panelden CSV dışa aktarım (Ayarlar → Veri)
```

Düzenli yedek alın. Fly'ın disk anlık görüntüleri de vardır ama tek
kopyaya güvenmeyin.

---

## Maliyet

Tek makine `shared-cpu-1x` / 512 MB + 1 GB disk ≈ **aylık 5 dolar**.

`auto_stop_machines = "suspend"` ayarı sayesinde panel kullanılmadığında
uyur; ilk istekte birkaç saniyede uyanır. Bu, faturayı ciddi düşürür.

---

## Ortam değişkenleri

| Değişken | Ne işe yarar |
|---|---|
| `SERVET_PUBLIC=1` | Sıkı güvenlik modu: uzun parola zorunluluğu, 2 saatlik oturum, güvenli çerez, HSTS başlığı |
| `SERVET_DB_PATH` | Veritabanı yolu (varsayılan `/data/servet.db`) |
| `PORT` | Dinlenecek port (varsayılan 3000) |

---

## Yerelde Docker ile deneme

```bash
docker build -t servet .
docker run -p 3000:3000 -v servet_data:/data servet
```

---

## Başka platformlar

**Railway / Render:** Aynı `Dockerfile` çalışır. Panellerinden kalıcı disk
(volume) ekleyip `/data` yoluna bağlayın, `SERVET_PUBLIC=1` ortam
değişkenini tanımlayın.

**Kendi sunucunuz (VPS):** `docker compose` ile çalıştırın, önüne Caddy
veya nginx koyup HTTPS sertifikası alın. `SERVET_PUBLIC=1` şart —
aksi halde çerez `Secure` işaretlenmez.

---

## Güvenlik kontrol listesi

Canlıya almadan önce:

- [ ] Parola en az 12 karakter, tercihen bir cümle
- [ ] İki faktörlü doğrulama açık
- [ ] Kurtarma kodları güvenli bir yerde saklı
- [ ] HTTPS zorunlu (`force_https = true`)
- [ ] `SERVET_PUBLIC=1` tanımlı
- [ ] Yedekleme alışkanlığı kurulmuş
- [ ] (İsteğe bağlı) IP kısıtlaması

Panel giriş denemelerini kaydeder ve **Ayarlar → Giriş kayıtları**
bölümünde gösterir. Tanımadığınız bir IP'den denemeler görürseniz
parolanızı değiştirin ve IP kısıtlamasını açın.
