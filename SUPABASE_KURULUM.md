# FX Desk — Supabase Kurulum Rehberi

Bu rehber, siteyi **gerçekten public** (herkesin gördüğü ortak hesaplar + paylaşımlar) hale getirmek içindir.
Şu an `trade.html` **demo modda** çalışıyor: hesaplar ve paylaşımlar yalnız senin tarayıcında saklanıyor.
Aşağıdaki adımları yapıp anahtarları dosyaya yapıştırınca site gerçek hesaplarla çalışır.

---

## 1. Supabase projesi oluştur

1. https://supabase.com adresine git → **Start your project** → GitHub/e-posta ile ücretsiz kayıt ol.
2. **New project** → bir isim ver (örn. `fxdesk`), güçlü bir **database password** belirle, bölge olarak Avrupa'ya yakın birini seç (örn. *Frankfurt*).
3. Proje hazırlanınca (1-2 dk) sol menüden **Project Settings → API** sekmesine gir.
4. Şu iki değeri kopyala:
   - **Project URL** (örn. `https://abcxyz.supabase.co`)
   - **anon public** key (uzun bir metin)

---

## 2. Anahtarları siteye yapıştır

`trade.html` dosyasını bir metin editörüyle aç, en üstteki script bölümünde şu satırları bul ve doldur:

```js
const SUPABASE_URL = "https://abcxyz.supabase.co";   // kendi URL'in
const SUPABASE_ANON_KEY = "eyJhbGciOi...";           // kendi anon key'in
```

> anon key gizli değildir, tarayıcıda görünmesi normaldir. Asıl güvenlik aşağıdaki RLS kurallarıyla sağlanır.

---

## 3. Veritabanı tablolarını oluştur

Supabase'de sol menüden **SQL Editor → New query** aç, aşağıdakini yapıştırıp **Run** de:

```sql
-- KULLANICI PROFİLLERİ
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  is_admin boolean default false,
  created_at timestamptz default now()
);

-- PAYLAŞIMLAR
create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  username text not null,
  symbol text,
  bias text check (bias in ('long','short','neutral')),
  text text,
  img_url text,
  created_at timestamptz default now()
);

-- OYLAR (her kullanıcı bir paylaşıma 1 oy)
create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references posts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  choice text check (choice in ('agree','disagree','neutral')),
  created_at timestamptz default now(),
  unique (post_id, user_id)
);

-- YORUMLAR
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references posts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  username text not null,
  text text not null,
  created_at timestamptz default now()
);
```

---

## 4. Güvenlik kurallarını (RLS) ekle

Aynı SQL Editor'de yeni bir query açıp şunu çalıştır:

```sql
alter table profiles enable row level security;
alter table posts    enable row level security;
alter table votes    enable row level security;
alter table comments enable row level security;

-- Herkes okuyabilir (public görünürlük)
create policy "read_profiles" on profiles for select using (true);
create policy "read_posts"    on posts    for select using (true);
create policy "read_votes"    on votes    for select using (true);
create policy "read_comments" on comments for select using (true);

-- Sadece giriş yapan kendi verisini ekler/siler
create policy "ins_profile" on profiles for insert with check (auth.uid() = id);
create policy "upd_profile" on profiles for update using (auth.uid() = id);

create policy "ins_post" on posts for insert with check (auth.uid() = user_id);
create policy "del_post" on posts for delete using (auth.uid() = user_id);

create policy "ins_vote" on votes for insert with check (auth.uid() = user_id);
create policy "upd_vote" on votes for update using (auth.uid() = user_id);
create policy "del_vote" on votes for delete using (auth.uid() = user_id);

create policy "ins_comment" on comments for insert with check (auth.uid() = user_id);
create policy "del_comment" on comments for delete using (auth.uid() = user_id);

-- YÖNETİCİLER her paylaşımı ve yorumu silebilir
create policy "admin_del_post" on posts for delete using (
  exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true)
);
create policy "admin_del_comment" on comments for delete using (
  exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true)
);
```

---

## 5. Ekran görüntüleri için depolama (Storage)

1. Sol menü → **Storage → New bucket**.
2. İsim: `screenshots`, **Public bucket** seçeneğini **işaretle** → Create.
3. Bu sayede yüklenen ekran görüntüleri herkese görünür bir URL alır.

(Yükleme izni için SQL Editor'de:)

```sql
create policy "upload_screenshots" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'screenshots');

create policy "read_screenshots" on storage.objects
  for select using (bucket_id = 'screenshots');
```

---

## 6. E-posta doğrulamasını kapatmak (opsiyonel, test için)

Test sırasında kayıt olur olmaz giriş yapabilmek istersen:
**Authentication → Providers → Email** → *Confirm email* seçeneğini geçici olarak kapatabilirsin.
Yayına alınca güvenlik için tekrar açman önerilir.

---

## 7. Güzel Hosting'e yükleme

Site tamamen statik (HTML/CSS/JS) olduğu için herhangi bir paylaşımlı hostinge yüklenebilir:

1. Güzel Hosting **cPanel → File Manager → public_html** klasörüne gir.
2. `trade.html` dosyasını yükle (istersen adını `index.html` yap ki domain açılınca direkt gelsin).
3. Domain'ine girince site açılır. Supabase anahtarları dosyada olduğu için backend otomatik bağlanır.

---

## Yönetici (admin) tanımlama

Site kurucusu sensin; sen ve seçtiğin kişiler her paylaşımı silebilir. İki yöntem:

1. **Hızlı yöntem (e-posta listesi):** `trade.html` içindeki `ADMIN_EMAILS` dizisine yönetici e-postalarını ekle:
   ```js
   const ADMIN_EMAILS = ["bozdagm68@gmail.com", "yardimci@mail.com"];
   ```
   Bu e-postalarla giriş yapan herkes otomatik yönetici olur (üst köşede **YÖNETİCİ** rozeti görünür).

2. **Veritabanı yöntemi (Supabase):** Bir kullanıcıyı yönetici yapmak için SQL Editor'de:
   ```sql
   update profiles set is_admin = true where username = 'mustafa_fx';
   ```
   `is_admin = true` olan kullanıcılar da tüm paylaşımları silebilir (yukarıdaki `admin_del_post` kuralı sayesinde).

Yöneticiler her paylaşımın altında **🗑 Sil**, sıradan kullanıcılar ise yalnızca kendi paylaşımlarında **🗑 Sil** görür.

---

## Kullanıcı listesi (admin panelinde e-posta + aktiflik)

Admin panelindeki **👥 Kullanıcılar** tablosunun her üyeyi **e-postası**, **kayıt tarihi**, **son aktif olduğu zaman**, **canlı çevrimiçi durumu** (🟢 Aktif / Çevrimdışı) ile göstermesi ve panelden **moderatör yapma / banlama** yapabilmek için aşağıdaki SQL'i **bir kez** çalıştır (SQL Editor → New query → Run). Blok tekrar çalıştırılabilir (idempotent) — daha önce eski sürümü çalıştırdıysan da güvenle yeniden çalıştırabilirsin.

> Neden gerekli? E-postalar Supabase'in korumalı `auth.users` tablosunda durur; tarayıcıdaki anon anahtar bunları **doğrudan okuyamaz** (güvenlik için). Bu yüzden e-postaları yalnızca **yöneticiye** döndüren, admin kontrolü yapan güvenli fonksiyonlar (`admin_list_users`, `admin_set_flags`) kullanıyoruz. Böylece e-postalar sıradan kullanıcılara hiçbir zaman açılmaz ve mod/ban işlemlerini yalnızca admin yapabilir.

```sql
-- 1) profiles tablosuna eksik kolonlar
alter table profiles add column if not exists is_moderator boolean default false;
alter table profiles add column if not exists is_banned    boolean default false;
alter table profiles add column if not exists last_seen    timestamptz;

-- 2) Yalnızca yöneticinin çağırabildiği, e-posta + aktiflik + durum döndüren fonksiyon
--    (dönen kolonlar değiştiği için önce eskisini düşürüyoruz)
drop function if exists admin_list_users();
create function admin_list_users()
returns table (
  id           uuid,
  username     text,
  email        text,
  is_admin     boolean,
  is_moderator boolean,
  is_banned    boolean,
  created_at   timestamptz,
  last_seen    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'yetkisiz';
  end if;
  return query
    select p.id, p.username, u.email::text,
           p.is_admin, coalesce(p.is_moderator, false), coalesce(p.is_banned, false),
           p.created_at, p.last_seen
    from profiles p
    join auth.users u on u.id = p.id
    order by p.last_seen desc nulls last;
end;
$$;
grant execute on function admin_list_users() to authenticated;

-- 3) Admin: bir kullanıcının moderatörlük/ban durumunu değiştir (null = değiştirme)
create or replace function admin_set_flags(
  target_id uuid,
  p_is_moderator boolean default null,
  p_is_banned    boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'yetkisiz';
  end if;
  if exists (select 1 from profiles p where p.id = target_id and p.is_admin = true) then
    raise exception 'admin uzerinde islem yapilamaz';
  end if;
  update profiles set
    is_moderator = coalesce(p_is_moderator, is_moderator),
    is_banned    = coalesce(p_is_banned,    is_banned)
  where id = target_id;
end;
$$;
grant execute on function admin_set_flags(uuid, boolean, boolean) to authenticated;
```

Notlar:
- **Son aktif / çevrimiçi:** Site açıkken her ~45 sn'de bir kullanıcının `profiles.last_seen` alanı güncellenir. Son 2 dakika içinde sinyal veren kullanıcı **🟢 Aktif** sayılır. Bu eşik `trade.html` içindeki `ONLINE_WINDOW_MS` ile ayarlanabilir.
- Admin paneli açıkken liste **30 sn'de bir** otomatik tazelenir; tablo başlığında *"X kullanıcı · Y aktif · Z banlı"* özeti görünür. Üstteki kutudan **e-posta / kullanıcı adı arayabilirsin**.
- **Mod / Ban:** Her satırdaki **Mod yap/al** ve **Banla/Yasağı kaldır** düğmeleri `admin_set_flags`'i çağırır. Yöneticiler üzerinde işlem yapılamaz. Banlanan kullanıcı **giriş yapamaz** (girişte ve oturum geri yüklemede kontrol edilir).
- Kendi `last_seen`'ini güncelleme yetkisi, kurulumdaki mevcut `upd_profile` (yalnızca `auth.uid() = id`) kuralıyla zaten sağlanır; ek izin gerekmez.

### Aktif süre ("Süre" sütunu)

Admin tablosundaki **Süre** sütunu, kullanıcının uygulamada geçirdiği **toplam aktif süreyi** gösterir. Bunun için `profiles`'a bir sayaç kolonu + sayacı artıran bir fonksiyon gerekir. Aşağıdaki SQL'i **bir kez** çalıştır (SQL Editor):

```sql
-- 1) Aktif süre sayacı (saniye)
alter table profiles add column if not exists total_seconds bigint default 0;

-- 2) Giriş yapan kullanıcının kendi süresini artıran fonksiyon
--    (site açık + sekme görünürken her ~30 sn'de bir çağrılır)
create or replace function bump_activity(secs int)
returns void
language sql
security definer
set search_path = public
as $$
  update profiles
     set total_seconds = coalesce(total_seconds, 0) + greatest(0, least(secs, 120))
   where id = auth.uid();
$$;

grant execute on function bump_activity(int) to authenticated;
```

Notlar:
- **Geçmişi saymaz:** Sayaç bu SQL'i çalıştırdığın andan itibaren birikmeye başlar; önceki kullanım geriye dönük gelmez. İlk başta herkes `-`/küçük değer görünür, kullandıkça dolar.
- `least(secs, 120)` her çağrıyı en fazla 120 sn ile sınırlar (suistimale karşı; istemci 30 gönderir).
- **Süre yine boş kalıyorsa:** Admin'in tüm kullanıcıların `total_seconds` değerini okuyabilmesi için `profiles` tablosunda **SELECT** (okuma) izninin açık olması gerekir. Kullanıcı adları zaten join'le okunabildiği için bu kural genelde mevcuttur; değilse profiles'a authenticated SELECT politikası ekle.

### (Opsiyonel) Ban'ı sunucu tarafında da zorla

Tarayıcıdaki ban kontrolü teknik bir kullanıcı tarafından atlanabilir. Banlı birinin **içerik paylaşmasını/yorum/oy vermesini** sunucuda da engellemek istersen, insert kurallarına ban kontrolü ekle:

```sql
drop policy if exists "ins_post"    on posts;
drop policy if exists "ins_comment" on comments;
drop policy if exists "ins_vote"    on votes;

create policy "ins_post" on posts for insert with check (
  auth.uid() = user_id and not exists (select 1 from profiles where id = auth.uid() and is_banned = true)
);
create policy "ins_comment" on comments for insert with check (
  auth.uid() = user_id and not exists (select 1 from profiles where id = auth.uid() and is_banned = true)
);
create policy "ins_vote" on votes for insert with check (
  auth.uid() = user_id and not exists (select 1 from profiles where id = auth.uid() and is_banned = true)
);
```

---

## Gated access (özel grup — admin onayı)

Yeni kayıtların **yalnızca sen onayladıktan sonra** girebilmesi için. Sırayla:

**1. Aşağıdaki SQL'i Supabase → SQL Editor'de çalıştır** (bir kez):

```sql
-- 1) approved kolonu. default false → bundan sonra kayıt olan herkes onaysız gelir.
alter table profiles add column if not exists approved boolean not null default false;
-- Aşağıdaki satırlardan BİRİNİ seç:
--   (a) Yumuşak geçiş: mevcut herkes onaylı kalsın, sadece yeni kayıtlar onay beklesin
-- update profiles set approved = true;
--   (b) SIKI geçiş (DC'ye özel lansman): HERKESİ kilitle, tek tek sen onayla; adminler hariç
update profiles set approved = false;
update profiles set approved = true where is_admin = true;

-- 2) admin_list_users: approved alanını da döndür (dönen tip değişti → düşür+oluştur)
drop function if exists admin_list_users();
create function admin_list_users()
returns table (
  id uuid, username text, email text,
  is_admin boolean, is_moderator boolean, is_banned boolean,
  approved boolean, created_at timestamptz, last_seen timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'yetkisiz';
  end if;
  return query
    select p.id, p.username, u.email::text,
           p.is_admin, coalesce(p.is_moderator,false), coalesce(p.is_banned,false),
           coalesce(p.approved,false), p.created_at, p.last_seen
    from profiles p join auth.users u on u.id = p.id
    order by p.last_seen desc nulls last;
end;
$$;
grant execute on function admin_list_users() to authenticated;

-- 3) admin_set_flags: p_approved parametresi eklendi (eski imzayı düşür)
drop function if exists admin_set_flags(uuid, boolean, boolean);
create or replace function admin_set_flags(
  target_id uuid,
  p_is_moderator boolean default null,
  p_is_banned    boolean default null,
  p_approved     boolean default null
)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'yetkisiz';
  end if;
  if exists (select 1 from profiles p where p.id = target_id and p.is_admin = true) then
    raise exception 'admin uzerinde islem yapilamaz';
  end if;
  update profiles set
    is_moderator = coalesce(p_is_moderator, is_moderator),
    is_banned    = coalesce(p_is_banned,    is_banned),
    approved     = coalesce(p_approved,     approved)
  where id = target_id;
end;
$$;
grant execute on function admin_set_flags(uuid, boolean, boolean, boolean) to authenticated;
```

**2. SQL bittikten SONRA** `trade.html` (ve `index.html`) içindeki bayrağı aç:
```js
const GATED_ACCESS = true;   // varsayılan false
```

Nasıl çalışır:
- **Bayrak `false` (varsayılan):** Hiçbir değişiklik yok; herkes kayıt olup hemen girer. SQL'i çalıştırsan bile gating devreye girmez.
- **Bayrak `true` + SQL çalıştırıldı:** Yeni kayıt = **başvuru**. Kullanıcı "Başvurun alındı, onay bekleniyor" görür, giremez. Sen **Admin paneli → Kullanıcılar**'da o kişiyi **✅ Onayla** dersin; artık girebilir. Üst başlıkta "*N onay bekliyor*" sayacı çıkar; onay bekleyen satırlar **⏳ Onay bekliyor** rozetiyle işaretlenir.
- **Güvenlik:** `approved` kolonu yoksa (SQL çalıştırılmadıysa) sistem **açık** kalır — bayrak yanlışlıkla `true` olsa bile kimse kilitlenmez. Yöneticiler (ADMIN_EMAILS) her zaman girer.
- **Onayı geri alma:** Aynı satırda **Onayı al** ile kullanıcıyı tekrar beklemeye düşürebilirsin.

---

## Geri bildirim (Beta sekmesi → Admin paneli)

Beta sekmesindeki "Sorun bildir / özellik öner" kutusundan gelen mesajların **Supabase'de saklanması** ve admin panelindeki **📨 Geri Bildirimler** bölümünde okunabilmesi için `feedback` tablosunu ve kurallarını oluştur. SQL Editor → New query → Run:

```sql
create table if not exists feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  username   text,
  message    text not null,
  created_at timestamptz default now()
);

alter table feedback enable row level security;

-- Giriş yapan herkes kendi adına geri bildirim ekleyebilir
create policy "ins_feedback" on feedback
  for insert to authenticated with check (auth.uid() = user_id);

-- Yalnızca yöneticiler okuyabilir (mesajlar gizli)
create policy "admin_read_feedback" on feedback for select using (
  exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true)
);

-- Yalnızca yöneticiler silebilir
create policy "admin_del_feedback" on feedback for delete using (
  exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true)
);
```

Notlar:
- Tablo kurulmadan Beta'dan "Gönder"e basınca **"Gönderilemedi"** hatası alınır; bu SQL'i çalıştırınca düzelir.
- Mesajları **yalnızca admin** görür; admin panelini açınca otomatik yüklenir, başlıkta sayı görünür (örn. *📨 Geri Bildirimler (3)*), panel açıkken 30 sn'de bir tazelenir. Her mesajın yanında **Sil** düğmesi vardır.

---

## Kendi içeriğini düzenleme (paylaşım & yorum)

Paylaşımlar sekmesinde kullanıcı **kendi paylaşım ve yorumunu düzenleyebilir** (✏️) ve **silebilir** (🗑). Silme kuralları kurulumda zaten var; **düzenleme** için iki UPDATE kuralı eklenmeli. SQL Editor → Run:

```sql
create policy "upd_post" on posts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "upd_comment" on comments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Notlar:
- **Düzenle (✏️)** yalnızca içerik **sahibine** görünür. **Sil (🗑)** sahip + **yöneticiye** görünür.
- Bu SQL çalıştırılmazsa düzenleme arayüzde görünür ama **kaydolmaz** (RLS engeller). Eklenince düzgün çalışır.

---

## İçerik denetimi (uygunsuz görsel engelleme)

Site şu an **iki katmanlı** korumaya hazırlanıyor:

1. **Tarayıcı tarafı (eklendi):** Yüklenen/yapıştırılan her görsel, paylaşılmadan önce tarayıcıda otomatik müstehcenlik kontrolünden (NSFW tespiti) geçer. Uygunsuzsa görsel hiç eklenmez. Ayrıca her paylaşımda **🚩 Bildir** butonu var.
2. **Sunucu tarafı (yayına alırken önerilir):** Tarayıcı kontrolü teknik bir kullanıcı tarafından atlanabileceği için, gerçek public sürümde asıl koruma sunucuda olmalı. Yöntem: Supabase **Edge Function** ile, görsel yüklenince bir moderasyon API'sine (örn. **Sightengine**, **Google Vision SafeSearch** veya **AWS Rekognition** — çoğunda ücretsiz kota var) gönderip uygunsuzsa reddetmek.

İstersen Supabase projesi hazır olunca bu Edge Function'ı da birlikte kurarız; o zaman tarayıcıyı atlayan biri bile uygunsuz görsel yükleyemez. Ek olarak bildirimleri toplayan bir **reports** tablosu + senin görüp silebileceğin basit bir **admin** ekranı da ekleyebiliriz.

---

## Sırada ne var?

Bu adımları yapıp anahtarları yapıştırdığında **giriş/kayıt gerçek** olur.
**Paylaşım, oy ve yorumların** da Supabase'e taşınması (şu an demo verisi yerel tutuluyor) bir sonraki adım — tablolar hazır olunca bana haber ver, o kısmı `trade.html` içine bağlayalım ve birlikte test edelim.

---

## Canlı MT5 bağlantısı (MetaApi) — elle yüklemesiz otomatik veri

> Bu adım en sona bırakıldı: önce Supabase + hosting kurulmalı. Beta süresince "Rapor Yükle" (HTML/PDF) akışı kullanılır.

### Gerekenler
1. **MetaApi hesabı** (https://metaapi.cloud) → bir **API token**.
2. **MT5 bilgileri:** hesap numarası · **investor (salt-okunur) şifre** · broker sunucu adı (örn. `Tickmill-Live`).
3. **Supabase Edge Function** (token + investor şifre burada saklanır, sitede ASLA değil).
4. Yayında site (hosting).

### Kurulum adımları
1. metaapi.cloud'a kayıt ol → API token oluştur.
2. MT5 → hesap sağ tık → Change password → **Investor (read-only)** şifresini al/oluştur.
3. Supabase'de bir **Edge Function** oluştur; MetaApi token'ı **secret** olarak ekle (`supabase secrets set METAAPI_TOKEN=...`).
4. MetaApi'ye hesabı tanıt (provisioning): hesap no + investor şifre + sunucu → bulutta MT5 terminali açılır.
5. Edge Function şu uçları çağırsın:
   - *Read account information* (bakiye/equity)
   - *Read deals by time range* (işlem geçmişi)
   - (opsiyonel) **MetaStats API** → hazır win rate / profit factor metrikleri
6. Journal, elle yükleme yerine bu veriyi çeksin; periyodik (örn. saatlik) yenilensin.

### Maliyet
- 1 hesap için temel kullanım ücretsiz olabilir; üzeri **aylık ~$5–10 / hesap** (kullanıma göre). Güncel kademeler: https://metaapi.cloud/#pricing
- Supabase başlangıç planı ücretsiz.

### Notlar
- **Fon firmaları:** MT5 tabanlıysa (investor şifresiyle) çekilir. Kendi platformlarını (DXtrade/Match-Trader) kullanıyorlarsa MetaApi çalışmaz → PDF account statement yükleme ile devam.
- **Güvenlik:** investor şifresi salt-okunur; yine de yalnızca backend'de saklanır.

Kaynaklar: https://metaapi.cloud/ · https://metaapi.cloud/docs/client/

---

## 📓 İşlem Günlüğüm (notebook) — `nb_state` tablosu

"İşlem Günlüğüm" sekmesi, kişisel kayıtları (setup görseli + giriş/çıkış + RR + TP/Stop + after-chart) her cihazda görebilmen için Supabase'de saklar. Bu tablo **bir kez** oluşturulmalı (Journal'ın `jr_state` tablosundan bağımsızdır). Supabase → **SQL Editor**'de çalıştır:

```sql
create table if not exists nb_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb,
  updated_at timestamptz default now()
);
alter table nb_state enable row level security;
create policy "nb_state self" on nb_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- Görseller mevcut `screenshots` bucket'ına yüklenir; tabloda yalnızca URL tutulur (tablo küçük kalır).
- Tablo henüz yoksa veri **yine de** tarayıcıda (localStorage) çalışır; tabloyu açınca otomatik cihazlar arası senkron olur.

---

## 🤖 Otomatik sonuç işaretleme — `check-outcomes` (2026-07-03)

Hedef/Stop girilmiş paylaşımlar artık **otomatik** "✅ tuttu / ❌ stop" işaretlenir.

Kurulu bileşenler (bu adımlar UYGULANDI; yeni projeye taşınırsa tekrar gerekir):

1. **Kolonlar** — migration `outcome_auto_columns_and_cron_ext`:
```sql
alter table posts add column if not exists outcome_auto boolean default false;
alter table posts add column if not exists outcome_at timestamptz;
create index if not exists posts_open_outcome_idx on posts (created_at) where outcome = 'open';
create extension if not exists pg_cron;
create extension if not exists pg_net;
```
2. **Edge Function `check-outcomes`** (kaynak: `supabase-edge-check-outcomes.ts`):
   Yahoo Finance 5 dk mumlarıyla, post SONRASI fiyat önce TP'ye mi SL'e mi değmiş bakar.
   - Aynı mumda ikisi de değdiyse muhafazakâr: stop sayılır.
   - Yön/değer tutarsızsa (long'da hedef<stop) karışmaz.
   - 30 günden eski açık paylaşımlara bakmaz. XAU için GC=F (vadeli) kullanılır.
   - Test: `GET /functions/v1/check-outcomes?probe=EURUSD=X` → mum sayısı döner (DB'ye dokunmaz).
3. **Zamanlama** — pg_cron işi `check-outcomes-5m` (5 dakikada bir `net.http_post` ile fonksiyonu çağırır).
   Kontrol: `select jobname, schedule, active from cron.job;`
   Son koşular: `select * from cron.job_run_details order by start_time desc limit 5;`

Manuel işaretleme her zaman otomatiği geçersiz kılar (`outcome_auto=false` yazılır).
