# HANDOFF: laporan kerja untuk agent berikutnya (Codex/Claude)

> Update 2026-10-22 (Codex, penjelasan saldo PAYG, commit `c6e8a59` dipush ke `develop` dan dideploy ke local production `:13000`): respons saldo kurang kini menampilkan saldo tersedia, tarif per pesan, kekurangan minimal untuk mengantrekan pesan berikutnya, dan arahan ke Tagihan → Saldo PAYG; ringkasan broadcast menyertakan alasan gagal. Backup privat `backup-20261022T145938Z` dibuat sebelum build. Semua image berhasil dibangun; migrasi 001–061 sudah tercatat tanpa migrasi baru. Tes wallet PAYG 2/2, dashboard TypeScript/ESLint dan diff-check lulus. `scripts/monitor-personal.sh`: Postgres, Redis, API, Device Manager, dashboard, dan tiga bot sehat; `/broadcast` dan `/ready` HTTP 200. Bot di-refresh dengan sesi dipertahankan; tidak ada pesan WhatsApp nyata dikirim. `develop` dan `origin/develop` sinkron pada `c6e8a59`; tidak ada deploy VPS.

> Update 2026-10-22 (Codex, device API key card, commit `b1962bd` dipush ke `develop` dan dideploy ke local production `:13000`): setiap kartu device kini menampilkan prefix key terikat-device dan aksi `Buat & salin`/`Putar & salin`; plaintext hanya tampil sekali setelah create/rotate karena server hanya menyimpan hash. Sebelum deploy dibuat backup privat `backup-20261022T134700Z`; semua image berhasil dibangun dan migrasi 001–061 tercatat (tidak ada migrasi baru). `scripts/monitor-personal.sh`: Postgres, Redis, API, Device Manager, dashboard, dan tiga bot sehat; HTTPS `/` dan `/devices`, serta API `/ready` memberi HTTP 200. TypeScript, ESLint terpilih, dan `git diff --check` lulus. Bot di-refresh dengan sesi dipertahankan; tidak ada pesan WhatsApp nyata dikirim. Commit dan `origin/develop` sinkron pada `b1962bd`; tidak ada deploy VPS.

> Update 2026-10-22 (Codex, commit `02c411e` dipush ke `develop` dan dideploy ke local production `:13000`): batch berisi pembaruan Grup/Saluran/API serta pengamanan outbound. `make update` membuat backup privat, membangun semua image, menjalankan migrasi (052–056 sudah tercatat sehingga tidak perlu diterapkan ulang), me-recreate service, dan refresh tiga bot sambil mempertahankan sesi. `make monitor`: Postgres, Redis, API, Device Manager, dashboard, dan tiga bot sehat; API `/ready` dan dashboard `/groups` memberi HTTP 200. `scripts/test-outbound-local.sh`: 27 lulus, 0 gagal, 1 tes beban opsional dilewati; tidak ada pesan WhatsApp nyata dikirim saat tes/deploy. Status branch diverifikasi sinkron dengan `origin/develop` pada commit tersebut. Tidak ada deploy VPS.

> Update 2026-10-20 (Codex, hotfix pembuatan Saluran Baileys dideploy ke local production `:13000`): respons create WhatsApp Channel dapat mengembalikan `thread_metadata.picture: null` dan `viewer_metadata: null`, sedangkan parser Baileys `7.0.0-rc14` menganggap keduanya selalu ada dan gagal membaca `id`. Ditambahkan `scripts/patch-baileys-newsletter.js` yang null-safe, idempotent, dan menolak versi/parser tak dikenal; dijalankan lewat `postinstall` di instalasi dan image bot. Image live dibuat sebagai baseline agar perubahan lokal lain tidak ikut dideploy; bot diperbarui satu per satu dengan direktori sesi yang sama. Ketiga bot sehat setelah refresh; API `/ready` dan dashboard `/groups` HTTP 200. Tidak ada migrasi DB atau pengiriman pesan/create saluran nyata sebagai tes. Status percobaan create sebelumnya belum diketahui; cek daftar di WhatsApp sebelum mencoba lagi.

> Update 2026-10-19 (Codex, grup/saluran dan sinkronisasi riwayat dideploy ke local production `:13000`): commit `f9d61f9` berhasil dideploy via `make update` setelah owner menyatakan lima tenant API key lama telah dinonaktifkan. Backup privat `backup-20261019T154242Z` dibuat sebelum build; migration 050 diterapkan. `/health`, `/ready`, `/groups`, dan `/operator/login` HTTP 200; seluruh service dan kedua bot sehat; sesi device dipertahankan. Tidak ada provisioning/cutover/drop kolom API key dan tidak ada pengiriman WhatsApp nyata yang diuji. Jangan aktifkan lima tenant sampai scoped-key cutover selesai.

> Keputusan owner batch `f9d61f9`: lima tenant API key lama dinyatakan nonaktif; owner mengizinkan deploy tanpa menjalankan cutover terlebih dahulu. Ini pengecualian untuk batch tersebut. Database masih menyimpan key lama; tenant harus tetap nonaktif sampai integrasi memakai scoped key dan cutover selesai.

> Update 2026-10-19 (Codex, T2.3 deployed ke local production `:13000`): commit aplikasi `f8ec6ff` (berisi fitur T2.3 dan workspace close) berhasil dideploy via `scripts/update-personal.sh`; commit dokumentasi deployment menyusul. Backup privat `backup-20261019T040108Z` dibuat sebelum build, semua checksum, gzip PostgreSQL, Redis RDB, dan arsip sesi valid. Build image pertama gagal pada `next/font/google` di Turbopack; dashboard production build disetel memakai Webpack (`next build --webpack`) di `f8ec6ff`, lalu seluruh image berhasil dibangun. Migration 048 dan 049 diterapkan; `/ready`, dashboard `/`, dan `/operator/login` semua HTTP 200. `make monitor`: Postgres, Redis, API, Device Manager, dashboard, dan dua bot sehat; bot di-refresh dengan sesi device tetap dipertahankan. Pengiriman WhatsApp asli tidak diuji; endpoint login hanya dicek tanpa autentikasi. Tidak ada perubahan/cutover API key lama dan fallback tetap dipertahankan. Backup rotation tetap dry-run; tidak ada purge data.


> Update 2026-10-08 (Claude, LOKAL — belum commit/push/deploy): **MFA/TOTP dihapus dari SEMUA login Operator** per keputusan owner. Login Operator sekarang cukup email + kata sandi. Perubahan: `auth.ts` (login langsung buat sesi, tanpa challenge/MFA), `router.ts` (MFA endpoint return 410 Gone, key-health guard dihapus), `config.ts` (`mfaKey` dihapus dari interface), `auth-flow-panel.tsx`/`use-operator-auth-flow.ts`/`api.ts`/`types.ts` (dashboard disederhanakan), semua tes diupdate (`operator.test.ts`, `operator-entry.test.ts`, `operator-hardening.test.ts`, `operator-mfa.test.ts`, `operator-alerts.test.ts`, `operator-core.test.ts`, `dashboard/tests/`), skrip provisioning disederhanakan, `reset-operator-mfa.ts`/`rotate-operator-mfa-key.ts` jadi stub, `OPERATOR_MFA_ENC_KEY` dihapus dari `.env.example`, `.env.production.example`, `docker-compose.personal.yml`, `inject-secrets.sh`, semua skrip test shell. Docs `OPERATOR_PANEL.md` diupdate. Break-glass alert tetap berfungsi (tanpa MFA). Modul `mfa.ts`, kolom DB, dan tabel terkait dipertahankan sebagai dead code — tidak ada migrasi penghapusan.

> Update 2026-10-02 (Claude — owner menyetujui 4 hal atas update di bawah, lalu commit+push ke `develop` dilakukan di commit ini):
> 1. **Urutan cutover API key disetujui persis seperti dirancang** (backup → provision dry-run lalu `--execute` privat → konfirmasi tiap tenant → cutover → drop kolom → baru deploy). Dilarang menukar urutan. Karena kelima tenant adalah workspace uji owner sendiri: **bila ada kegagalan di tengah jalan, laporkan dan berhenti — jangan improvisasi.**
> 2. **Commit + push ke `develop`: disetujui sekarang** (lihat commit di bawah entri ini). **Deploy ke `:13000` tetap menunggu** cutover 5 tenant selesai sesuai urutan di atas.
> 3. **Gap `docker inspect` pada `scripts/inject-secrets.sh` diterima untuk sekarang** — dicatat sebagai task hardening fase VPS (pola `*_FILE` di `config.ts`) di `docs/ROADMAP_2026-09-28.md`, bukan dikerjakan sekarang.
> 4. **VS Code: owner pasang sendiri malam ini.** Claim "terverifikasi" untuk `code .` dari WSL **tidak boleh dilakukan Claude/PM** sampai owner sendiri mengonfirmasi berhasil.
>
> Tidak ada deploy/restart/mutasi data produksi yang dilakukan di commit ini — hanya commit+push kode/dokumentasi ke `develop`.

> Update 2026-10-02 (Claude, LOKAL — belum commit/push/deploy — KEPUTUSAN OWNER FINAL menggantikan update di bawah untuk TOTP Owner dan migrasi API key): Owner meninjau update sebelumnya dan memutuskan: (1) **TOTP Owner dibatalkan total**, (2) **API key statis tenant dihapus total tanpa grace period** (bukan notice 60 hari), (3) latar login/register pakai foto Pexels bebas lisensi (bukan menunggu lampiran owner), (4) DOKU tetap menunggu, (5) cek setup VS Code, (6) buat `scripts/inject-secrets.sh`. Tidak ada commit/push/deploy/restart/mutasi data produksi yang dilakukan.
>
> **(1) TOTP Owner dihapus bersih.** `src/api-gateway/services/owner-mfa.service.ts` dan `migrations/033_owner_mfa_and_auth_transition.sql` (versi lama) dihapus total; `account.service.ts`/`auth.routes.ts` dikembalikan ke login password-only murni (tidak ada lagi `/auth/mfa/*`, tidak ada `security.auth_transition` di `/auth/me`); `session.service.ts` (split sementara untuk menghindari circular import) digabung kembali ke `account.service.ts`. `OWNER_MFA_ENC_KEY` dihapus dari `.env.personal.example`, `docker-compose.personal.yml`, dan tiga skrip test — file-file itu sekarang identik dengan commit `8dcd04b` (tidak ada residu). **MFA Operator tidak disentuh sama sekali** (nol diff di `src/api-gateway/operator/*.ts`). Dicatat di `docs/ROADMAP_2026-09-28.md`: "evaluasi ulang 2FA Owner sebelum pilot".
>
> **(2) API key statis tenant: dihapus total, tanpa grace period.** Desain notice-60-hari dari update sebelumnya (migrasi `035_api_key_legacy_transition.sql`, `issueLegacyKeyNotice`/`legacyKeyStatus`, route `/keys/legacy-*`) **dibuang seluruhnya**, diganti pendekatan langsung:
> - **Migrasi `034_tenant_api_key_nullable.sql`** (auto-apply, aman): `tenants.api_key` jadi nullable, UNIQUE tetap.
> - **`scripts/migrate-legacy-api-keys.ts`** (baru, gerbang `adminContext()` sama seperti skrip admin lain): `provision` membuat scoped key (`KEY_SCOPES` penuh, bukan izin kelola key/tim/billing) untuk tenant yang masih punya key statis dan belum punya scoped key — key baru **hanya ditulis ke file `--out` privat**, tidak pernah ke stdout/stderr/log. `cutover` menge-NULL `api_key` HANYA untuk tenant yang sudah punya scoped key aktif; tenant yang belum di-provision dibiarkan (daftar "NOT ready"). Dry-run adalah default; `--execute` eksplisit.
> - **`scripts/drop-legacy-api-key-column.sql` + `.ts`** (baru, **bukan migrasi otomatis** — sengaja dipisah dari `migrations/` supaya tidak ter-drop sebelum cutover live selesai): `DROP COLUMN` dengan guard SQL yang menolak (exception, transaksi batal) bila masih ada tenant dengan `api_key` terisi. Dijalankan manual oleh owner/Codex setelah `cutover` melaporkan nol tenant "NOT ready".
> - **Kode dihapus**: `middleware/auth.ts` (seluruh cabang fallback key statis + cache Redis-nya dihapus; hanya sesi user `wgs_` dan scoped key `wgk_` yang bisa autentikasi sekarang), `apikey.service.ts` (fungsi legacy-notice dihapus, `resolveApiKey` tidak lagi SELECT `api_key`), `keys.routes.ts` (route `/keys/legacy-*` dihapus), `admin.routes.ts` (`/admin/tenant/create` tidak lagi membuat key `wg_`), `tenant.routes.ts` (`GET /tenant` tidak lagi mengembalikan `api_key`), `account.service.ts` (signup tidak lagi membuat key `wg_`), `shared/types/api.ts` (`TenantContext.api_key` dihapus).
> - **Dashboard**: form "Masuk dengan API key (cara lama)" di halaman login dihapus total, beserta `api.setApiKey`/`getApiKey`/`clearApiKey`, mode `legacy` di `usePermissions()`, dan kartu "API key lama" di halaman Pengaturan. Scoped key (`wgk_`) tetap dikelola seperti biasa dari halaman Developers > Keys oleh orang yang sudah login — key tidak pernah dipakai untuk login dashboard.
> - **Lima tenant produksi yang disebut dalam audit sebelumnya BELUM dimigrasikan** — hanya diuji dengan tenant sintetis di DB disposable. **Langkah live yang masih diperlukan, urut:** (a) backup DB produksi; (b) jalankan `migrate-legacy-api-keys.ts provision --out <file 0600> --execute` untuk kelima tenant, serahkan key baru ke masing-masing secara privat di luar chat/log; (c) tiap tenant mengonfirmasi integrasinya sudah pakai key baru; (d) jalankan `cutover --execute`; (e) setelah `cutover` melaporkan nol "NOT ready", jalankan `drop-legacy-api-key-column.ts` sekali untuk menghapus kolom; (f) deploy kode penghapus fallback (`middleware/auth.ts` dkk) — urutan (f) boleh sebelum (d)/(e) karena kode yang sudah tidak membaca `api_key` tidak terpengaruh kapan kolom itu di-null/di-drop, tapi JANGAN deploy sebelum (b)-(c) selesai untuk kelima tenant, karena begitu kode baru aktif, key statis manapun yang belum diganti langsung berhenti bekerja tanpa jendela transisi (sengaja, sesuai keputusan "tanpa grace period").
>
> **(3) Latar login/register**: dua foto Pexels (lisensi bebas, bukan Unsplash+/berbayar) dari fotografer yang sama (Steve A Johnson) untuk gaya yang konsisten — login mesh ungu gelap (`auth-bg-login.jpg`, ~148 KB), register mesh merah-ungu gelap (`auth-bg-signup.jpg`, ~55 KB). Disimpan lokal di `dashboard/public/`, tidak di-hotlink, tanpa watermark. Sumber/kreator/lisensi/tanggal unduh dicatat di `dashboard/public/ASSETS.md`. Overlay gelap `bg-black/40` di `AuthShell`, teks logo dipaksa putih di atas foto, diuji responsif (375px, tanpa scroll horizontal) dan tanpa console error via Playwright (`dashboard/tests/auth-background.spec.ts`, 3/3 lulus).
>
> **(5) VS Code**: tidak ditemukan VS Code Windows (`Program Files`/`AppData\Local\Programs` kosong) maupun `~/.vscode-server` (ekstensi WSL belum pernah connect) di sesi ini. `winget` tersedia di Windows (`v1.29.380`). Langkah manual untuk owner: (a) di PowerShell/Terminal Windows (BUKAN di WSL): `winget install --id Microsoft.VisualStudioCode -e --source winget`; (b) buka VS Code sekali, pasang ekstensi "WSL" (`ms-vscode-remote.remote-wsl`) dari Extensions, atau jalankan `code --install-extension ms-vscode-remote.remote-wsl` dari PowerShell setelah (a); (c) dari WSL, di folder repo, jalankan `code .` — seharusnya membuka VS Code Windows tersambung ke filesystem WSL. Saya tidak menjalankan instalasi ini sendiri (aksi level sistem di Windows); tidak bisa memverifikasi `code .` sampai owner menyelesaikan (a)-(b). Panduan resmi: https://code.visualstudio.com/docs/remote/wsl
>
> **(6) `scripts/inject-secrets.sh`** (baru) menyalin secret bernama dari file terlindungi mode 0600/0400 ke file per-secret mode 0400 (untuk Docker Compose `secrets:` file-based, ter-mount read-only di `/run/secrets/<nama>` — ini jalan di plain `docker compose`, bukan cuma Swarm). Hanya nama di ALLOWLIST tertulis di skrip yang diterima; file sumber tidak pernah di-`source`/`eval`; nilai tidak pernah ke stdout/stderr/log/argv; `set -x` tidak pernah diaktifkan dan skrip menolak jalan bila shell pemanggil sudah xtrace. Diuji murni dengan fixture sintetis (`scripts/test-inject-secrets.sh`, 18 assertion, semua lulus) — saya tidak membaca atau menjalankan skrip ini dengan secret asli sama sekali. **Keterbatasan yang didokumentasikan apa adanya**: `src/shared/config.ts` KONEVA saat ini hanya membaca `process.env`, belum punya pola `*_FILE` untuk membaca dari file — jadi selama itu belum ada, nilai yang akhirnya dibutuhkan API/device-manager tetap harus lewat `environment:` di compose dan karenanya tetap terlihat lewat `docker inspect` oleh siapa pun yang bisa menjalankannya di host itu; skrip ini mencegah kebocoran lewat skrip ini sendiri (stdout/log/argv), bukan lewat `docker inspect` — itu butuh perubahan `config.ts` terpisah yang belum dikerjakan.
>
> **(4) DOKU**: tidak disentuh sama sekali — tidak ada akun dibuat, tidak ada integrasi dimulai, tidak ada data pribadi dikirim, sesuai instruksi "owner sedang mengurus registrasi sendiri".
>
> **(7) Tidak ada agen baru dipasang.**
>
> **Tes setelah semua perubahan di atas:** `OPERATOR_TEST_REDIS=1 bash scripts/test-operator-local.sh --all` → **365 lulus/0 gagal/2 skip** (gated, pra-eksisting). `bash scripts/test-operator-stack.sh` → **41/41 lulus**. Dashboard: `npx playwright test` (suite UI mock penuh) → **84/84 lulus** (termasuk 3 test baru untuk latar login/register). `scripts/test-inject-secrets.sh` → **18/18 assertion lulus**. Root dan dashboard `tsc --noEmit` serta `eslint` bersih.
>
> **Belum commit, belum push, belum deploy.** Menunggu review owner, khususnya persetujuan urutan cutover live 5 tenant di atas sebelum dieksekusi terhadap produksi.

> Update 2026-10-02 (Claude, LOKAL — belum commit/push/deploy — diagnosis kirim + audit login + implementasi 6 keputusan owner): Tiga pekerjaan terpisah dalam satu sesi; tidak ada yang di-deploy, tidak ada akun/DB produksi disentuh, tidak ada WhatsApp/email asli terkirim.
>
> **1) Diagnosis kirim gagal `:13000` (read-only, selesai):** Workspace baru "Otomation CS-WA" (tenant dibuat 2026-10-02 13:02), device `WAPI-326C66C526` online dan Docker-healthy. Satu-satunya percobaan kirim (13:05:40) ditolak `409 RECIPIENT_CONSENT_REQUIRED` — log: `"Promotional send denied by recipient consent"`, bukan opt-out/device-offline/transport. Tabel `messages` nol baris untuk tenant ini (ditolak sebelum di-queue). Bekerja sesuai desain T1.4: workspace baru belum punya riwayat consent untuk nomor manapun. Tidak ada retry/pesan uji/perubahan data yang dilakukan.
>
> **2) Audit jalur login lama (audit-only, disetujui owner, lalu diimplementasikan di bawah):** Dipetakan: login pelanggan (`POST /auth/login`, password-only, 5 sesi aktif saat audit), OTP email pelanggan (hanya signup/invitation/verifikasi email owner, bukan login), API key tenant legacy statis (5 tenant masih pakai), API key scoped `wgk_`, login Operator (MFA wajib, tidak diubah), `/admin` legacy (`x-admin-key`). Dilaporkan ke owner sebelum implementasi apa pun; owner menyetujui 8 keputusan di bawah.
>
> **3) Implementasi 8 keputusan owner (lokal, migrasi 033–035, belum di-deploy/commit/push):**
> - **(1) Tanpa perubahan** — login pelanggan tetap password-only; verifikasi email signup tetap wajib (test lama tidak disentuh, masih lulus).
> - **(2) TOTP Owner — opt-in sekarang, wajib otomatis setelah transisi** (`src/api-gateway/services/owner-mfa.service.ts`, baru; migrasi `033`): TOTP terpisah total dari MFA Operator (key `OWNER_MFA_ENC_KEY` sendiri, tabel sendiri `user_mfa_*`, tidak menyentuh `operator/*.ts`). **Keputusan desain yang perlu dikonfirmasi owner:** TOTP TIDAK dipaksa langsung ke seluruh akun Owner aktif (berisiko mengunci akun produksi tanpa peringatan); sebagai gantinya Owner bisa aktifkan sendiri sekarang (`POST /auth/mfa/enroll/start`), dan login akan memaksa enrollment pada login berikutnya HANYA setelah tenggat 30 hari (lihat poin 4) jika belum enroll. Fail-safe: tanpa `OWNER_MFA_ENC_KEY` valid, enroll/verify menjawab `503 OWNER_MFA_UNAVAILABLE`, tidak pernah diam-diam dilewati.
> - **(3) Lupa/reset password** (`src/api-gateway/services/password-reset.service.ts`, baru; migrasi `034`): kode 6 digit via transport email yang sudah ada (`sendNoticeEmail`), 30 menit, maksimal 5 percobaan, tidak membocorkan apakah email terdaftar. Reset sukses mencabut SEMUA sesi pelanggan itu.
> - **(4) Grace period sesi 30 hari + desain enforcement** (migrasi `033`, tabel singleton `auth_transition_notices`, `effective_at` dihitung sekali saat migrasi diterapkan): `/auth/me` menampilkan `security.auth_transition`. Lima sesi pelanggan aktif **tidak disentuh** — pengecekan hanya berjalan di `login()`, bukan di `resolveSession()`, jadi sesi yang sudah ada terus berfungsi normal. Setelah tenggat lewat, Owner yang belum TOTP akan mendapat `mfa_enrollment_required` pada login berikutnya (bukan sesi langsung) — diuji dengan memundurkan `effective_at` pada baris singleton lalu mengembalikannya (tidak pernah dijalankan terhadap DB produksi).
> - **(5) Migrasi API key statis → `wgk_`** (`src/api-gateway/services/apikey.service.ts` +`issueLegacyKeyNotice`/`legacyKeyStatus`; `keys.routes.ts` +`GET/POST /keys/legacy-*`; migrasi `035`, tabel `api_key_legacy_notices`, meniru persis pola `legacy_role_notices` T1.6): notice 60 hari per tenant, sekali per tenant (percobaan kedua `409 NOTICE_ALREADY_SENT`). Setelah tenggat, `middleware/auth.ts` menolak jalur `tenants.api_key` statis (`401 LEGACY_API_KEY_DISABLED`); key scoped `wgk_` tidak terpengaruh sama sekali — itulah cara akses "pulih". **Lima tenant produksi yang disebut dalam audit TIDAK diberi notice** (hanya diuji dengan data sintetis); owner harus memicu notice per-tenant secara sadar lewat endpoint baru.
> - **(6) `/admin` localhost-only** (`src/api-gateway/middleware/admin-access.ts`): default produksi diperketat dari `loopback,private` menjadi `loopback` saja. **Perubahan perilaku dari kode yang sudah ada sebelumnya** (fitur ini sudah ada sejak commit `ee37f28`, defaultnya dulu mengizinkan rentang IP privat juga) — test lama yang mengasumsikan privat-range lolos sudah diperbarui mengikuti keputusan baru ini. `ADMIN_ALLOWED_NETWORKS=loopback,private` tetap tersedia sebagai override eksplisit bila nanti ternyata dibutuhkan akses dari Docker/VPN internal. Diverifikasi loopback (200) vs private-range/public (403) via server Express lokal sekali pakai, tidak menyentuh `:13000`.
> - **(7) Login Operator** — tidak diubah sama sekali (tidak ada diff di `src/api-gateway/operator/*.ts`).
> - **(8) Pesan consent di dashboard** (`dashboard/src/lib/errors.ts` +`sendRejectionGuidance`; dipakai di `broadcast/page.tsx` dan `developers/quickstart/page.tsx`): `RECIPIENT_CONSENT_REQUIRED`/`RECIPIENT_OPTED_OUT` kini menampilkan judul+langkah berikutnya (minta MULAI/START, atau catat consent di Kontak dengan bukti sah) menggantikan pesan generik backend. Enforcement consent backend tidak diubah sama sekali.
>
> **UI latar login/register: terblokir.** Tidak ada gambar terlampir di sesi ini; tidak diganti dengan gambar stock/tebakan sesuai instruksi. Menunggu lampiran ulang.
>
> **Tes:** `OPERATOR_TEST_REDIS=1 bash scripts/test-operator-local.sh --all` → **367 lulus/0 gagal/2 skip** (gated, pra-eksisting; naik dari 362 karena 5 test baru). `bash scripts/test-operator-stack.sh` → **41/41 lulus** (tidak ada test STACK baru ditambahkan untuk UI consent — lihat gap di bawah). Root dan dashboard `tsc --noEmit` bersih; dashboard `eslint` bersih (tidak ada error dari `npx tsc`, tidak dijalankan `npm run lint` penuh berbasis waktu).
>
> **Gap yang tersisa / jujur belum teruji:** (a) tidak ada test Playwright otomatis khusus untuk pesan consent di `broadcast`/`quickstart` dashboard — kedua halaman ini sebelumnya memang belum punya test Playwright sama sekali, menambah satu dari nol butuh harness STACK dengan device sungguhan di luar scope waktu sesi ini; logika pemetaannya (`sendRejectionGuidance`) murni lookup table dan sudah lolos `tsc`. (b) `OWNER_MFA_ENC_KEY` belum ada di `.env.personal` live manapun (hanya ditambahkan ke `.env.personal.example`, `docker-compose.personal.yml`, dan skrip test) — fitur TOTP Owner tidak aktif di `:13000` sampai key itu dibuat dan di-deploy. (c) Lima tenant dengan API key statis belum diberi notice migrasi apa pun (keputusan owner yang masih diperlukan kapan memulainya). (d) Tidak ada endpoint self-service untuk MENONAKTIFKAN TOTP Owner (hanya recovery code untuk login lagi) — cukup untuk MVP tapi dicatat sebagai gap.
>
> **Belum commit, belum push, belum deploy** — semua di atas murni perubahan working tree lokal di `develop`, menunggu review owner sebelum commit.

> Update 2026-10-02 (Claude, Operator hardening deployed — migrations 030–032): Owner approved commit/push to `develop` only (not `master`, not DOKU). Before build, verified backup `backups/personal/backup-20261002T080508Z`; all five `SHA256SUMS` entries passed, and pre-build image digests are preserved in the private `image-ids-before-build.txt` (mode 0600). Migrations 030 (`operator_audit.client_ip`), 031 (`koneva_application`/`koneva_app` role split), and 032 (break-glass operator column + constraint) applied successfully to `wa-personal/wagateway`. API and dashboard images built and are healthy; `/ready`, `https://.../operator/login`, and `/operator/insights` return 200, and `/api/operator/insights` without a session returns 401 as expected.
>
> **Role split confirmed live:** the API connects as `koneva_app`, not the bootstrap superuser. `operator_audit` and `operator_security_events` grant the application role SELECT/INSERT only — UPDATE/DELETE are rejected (confirmed via `has_table_privilege`/live rejection, not just migration text). `operator_audit.client_ip` is `inet` and is being populated for `owner.insights.view` reads.
>
> **Retention:** deletion remains disabled. Backup-rotation ran dry-run with zero eligible candidates; no `retention_job_runs` row in `execute` mode exists. No change from the prior dry-run-only posture.
>
> **Bot containers:** both existing bot containers were recreated with their session directories preserved and both report Docker-healthy. One WhatsApp number is online. The second received `401 logged_out` from WhatsApp and remains offline — **this number was already offline before this deploy**; it needs a QR re-link performed by the owner. No pairing or restart was attempted or should be attempted by an agent. Redis queue aggregate at time of writing: `waiting=0 active=0 delayed=0 prioritized=0 failed=3`; the `messages` table has no rows in `queued`/`sending` status. No test WhatsApp message was sent.
>
> **Break-glass account:** the break-glass code path (alert-on-login, 90-day validation, single-account constraint) is deployed and `OPERATOR_BREAK_GLASS_ALERT_EMAIL` is configured, but **no break-glass account exists yet** (`operators` has zero rows with `is_break_glass`). An agent must not create this account or choose its password — only the owner, running `scripts/provision-break-glass-operator.ts` offline with credentials they set privately, may provision it. No real Gmail send was tested; alert delivery was verified only against the disposable `dev-outbox` transport in automated tests.
>
> **Tests:** found and fixed a test-isolation bug (not a product bug) where a break-glass provisioning test in `operator-hardening.test.ts` left `is_break_glass=true` set on its test row, causing a later, unrelated test in `operator.test.ts` to fail against the live singleton constraint; fixed by resetting the flag at the end of that test. Full suite after fix: `OPERATOR_TEST_REDIS=1 bash scripts/test-operator-local.sh --all` → 362 pass / 0 fail / 2 skip (gated, pre-existing). Root and dashboard `tsc --noEmit` clean; dashboard `eslint` on changed paths clean.
>
> **Git:** changes staged explicitly by path (no `git add -A`); `git status`/`.gitignore` confirmed no backup, `.env.personal`, or secret file was ever untracked/stageable. Committed and pushed to `develop` only.
>
> No secrets, passwords, MFA codes, phone numbers, or raw IP addresses are recorded in this entry or in chat. Owner steps still required: (1) QR re-link the offline bot device; (2) decide and privately set a break-glass account email/password and run the provisioning script; (3) continue the quarterly Operator access review cadence already recorded below.

> Update 2026-10-01 (Codex, Panel Pemilik deployed): owner explicitly approved the `:13000` deployment. `develop` commits `fb465a9` (Panel Pemilik read-only) and `3755026` (dashboard production typecheck scope) were deployed with `scripts/start-personal.sh`. Before build, verified backup `backups/personal/backup-20261001T133502Z`; all six `SHA256SUMS` entries pass, including the private `image-ids-before-deploy.txt` record of pre-build images. The first build stopped before migration/recreate because the dashboard tsconfig excluded no `tests-stack`; restoring its intentional `tests-stack` exclusion made the production build pass. Migration `029_operator_owner_insights.sql` then applied successfully to `wa-personal/wagateway`; the pre-existing owner row has MFA enrolled and now holds the full operational permissions plus `owner:insights`. API, dashboard, device-manager, nginx, Postgres, Redis, and both existing bot containers report healthy; `/operator/login` and `/operator/insights` return HTTP 200 through LAN HTTPS, `/api/operator/insights` without a session returns 401 as expected, and `/ready` returns 200. Owner should sign in at `https://192.168.1.7:13000/operator/login`, then open `/operator/insights`; we did not use the owner's password/TOTP or create an authenticated session. Retention deletion remains disabled (scheduler dry-run only). Failed customer-login event tracking is a separate security-priority task before pilot; other missing event sources are deferred. No DOKU or new WhatsApp send was used.

> Update 2026-10-01 (Codex, latest Operator UI): `48f807a` (`style(operator): align owner panel with customer dashboard`) deployed using `scripts/backup-personal.sh` then `scripts/start-personal.sh`. Backup: `backups/personal/backup-20261001T154011Z`; all five `SHA256SUMS` entries passed, backup-retention mode was dry-run with zero eligible snapshots, and pre-build image IDs are preserved in the private `image-ids-before-build.txt`. Migration runner confirmed migrations 001–029 already applied; no schema migration ran. Dashboard, API, device-manager, Postgres, Redis and both bot containers are healthy. LAN HTTPS login and insights pages return 200; API readiness returns 200 and unauthenticated insights API returns 401. No owner credentials were used. Retention deletion remains disabled. Perform an Operator access review every three months, including a privilege-creep check: verify each account is still needed, compare permissions with current responsibilities, confirm MFA/recovery escrow, and disable accounts no longer authorized. Follow-up hardening (migrations 030–032, role split, break-glass alert and validation, owner audit IP) was implemented and verified against disposable Postgres locally, then deployed to the live DB 2026-10-02 — see the update above for current status. Break-glass email identity is configured; no break-glass account has been provisioned yet.

> Update 2026-10-01 (Codex, signup fix deployed; local HTTPS/Operator ready for owner enrollment): Signup-without-OTP was a code gap. Fix commit `2cc81e4` is pushed to `develop` and deployed to `:13000`; migration 028 is recorded and `pending_signup_workspace_name` exists. UI says email verification is required. Backend 358 pass/2 skip, dashboard build/typecheck/ESLint, and STACK 41/41 pass. Live API/dashboard are healthy; no live signup OTP was sent in verification (STACK used synthetic dev-outbox). Before deploy, backup `backup-20261001T104933Z` checksum and DB/session/Redis validation passed. Old image IDs: API `sha256:2215e588b58e267324ed2783b444490720d09dd61e713a664cc7502a6b4ea400`; dashboard `sha256:f6b4a9673eb8ebdd6a61ee34c8b9f7656a9e6036d95402da695cf3715be14a61`. New image IDs: API `sha256:d6a19a7ba2b61fd403964c8b9443cc11a48d0a1677e784ded24bde995ea6a922`; dashboard `sha256:379044deceb47dc25b64234a89ed5d5ae0bee19e878219eb858d868e702a2a89`. Operator/TLS follow-up uses a locally generated mkcert certificate for `192.168.1.7`, trusted in the Windows current-user root store; nginx is healthy and `https://192.168.1.7:13000/operator/login` returned 200 from Windows. Windows portproxy now binds only `192.168.1.7:13000` to WSL `172.24.163.243:13000`; Private firewall rule is restricted to LocalSubnet. Direct API/dashboard host binds are loopback (`18000`/`13001`), HTTPS is the LAN entrypoint, and the prior broad 13000/18000 portproxy entries were removed. API has production Operator enabled with exact HTTPS origin, Secure `__Host-koneva_op` cookie, one trusted proxy hop, and generated MFA encryption key in ignored `.env.personal` (mode 0600). Fresh backup `backup-20261001T110721Z` checksums and DB/Redis/session validation passed before provisioning; `operators` count is still 0. Owner provisioning is waiting at the local tmux prompt `koneva-owner-operator`; attach from WSL with `tmux attach -t koneva-owner-operator`. That prompt shows the MFA key only locally for vault escrow, then asks the owner to confirm `127.0.0.1/<DB_NAME>`, set a password with hidden input, and provisions a 24-hour enrollment code to the local screen/private file. Owner must complete TOTP QR setup and save the 10 recovery codes in their password manager; no password, enrollment code or recovery code belongs in chat. The Windows current-user browser is trusted; any other client laptop must also trust the local mkcert root certificate. Retention stays dry-run; no deletion, Gmail test email, or WhatsApp send was performed.

> Update 2026-10-01 (Owner-approved :13000 deployment completed): Before build, backup `backups/personal/backup-20261001T091735Z` completed with `RETENTION_DAYS=30`, retention mode `dry-run`, and zero eligible snapshots. `sha256sum -c SHA256SUMS`, PostgreSQL gzip validation, session tar listing, and Redis `redis-check-rdb` all passed. Pre-build image IDs are recorded immediately below. First dashboard image build stopped before migration because dashboard TypeScript included `tests-stack`; `dashboard/tsconfig.json` now excludes that backend-only suite, and both local `npm run build` and the subsequent production image build passed. Migrations 018–027 all completed and were confirmed in `_migrations`; API `/ready` and dashboard `/` returned HTTP 200. API, dashboard, device-manager, Postgres, Redis, and both existing bot containers are healthy. Both bot containers were refreshed from the new bot image while preserving session directories. Host ports 13000 (dashboard) and 18000 (API) publish on `0.0.0.0`; manager/database/Redis remain loopback-only. Gmail API transport and sender/client/secret/refresh-token presence are confirmed inside API config without exposing values. No email or WhatsApp message was sent by Codex; Gmail delivery/token validity remains untested. Retention deletion gates remain false/unset; no `--execute` was run. The current WSL Windows host can reach the dashboard through its WSL address, but Windows is in WSL NAT mode and no LAN portproxy exists for 13000/18000; an Administrator PowerShell portproxy + Private-profile firewall rule is needed before another Wi-Fi laptop can connect. Operator table is empty (0 accounts), so Operator login is not provisioned/enabled. No commit/push was made; deployment used the authorized local `develop` working tree. Loopback rollback command is recorded in the owner-approval note below.

> Update 2026-10-01 (Owner-approved :13000 test deploy): Owner explicitly authorized the current `develop` batch to `:13000` for a same-WiFi signup test. OAuth client-secret rotation was declined by Owner; risk accepted by Owner because the secret had appeared in chat. Never copy any OAuth value into tracked files, logs, or reports; private runtime credentials remain only in ignored `.env.personal` (mode 0600). For this test `.env.personal` is set to `RETENTION_DAYS=30`, `APP_BIND_ADDRESS=0.0.0.0`, and `EMAIL_TRANSPORT=gmail-api`. Compose forwards Gmail settings only to `api-gateway`. Retention deletion remains prohibited; do not use `--execute`. Rebind after LAN testing: set `APP_BIND_ADDRESS=127.0.0.1`, then from the repo run `source scripts/personal-common.sh; personal_load; personal_lock; "${COMPOSE[@]}" up -d --no-deps --force-recreate api-gateway dashboard`. This restores loopback publishing without rebuilding the app. Pre-build container image IDs captured 2026-10-01: `wa-personal-dashboard-1` `sha256:185a0746efb28d29e09b5d11d626e6ddc24623430fa1842f4c768eeebc393563`; `wa-personal-device-manager-1` `sha256:aca3e8e90272dd6557261465209868d381fee79e88b1597dfe219db9c91561e5`; `wa-personal-api-gateway-1` `sha256:ad9a52ac3b8728cff76a3d63e993c1c248e7f30723bce8abd516828b35627a67`; both live bot containers `sha256:34614f0a249c29dd5bb5c7b607b0c69aa024494fe173f9023aae77ee8e3ec091`; Postgres `sha256:f7d23353e1b15400d22ebe31189f4d314b87a4c129cc400c8c2d8d4ca127bf81`; Redis `sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499`. Backup artifact and deployment evidence are recorded in the next update; no retention deletion will be enabled.

> Update 2026-10-01 (Codex): Owner menerima bukti T1.5 dan menyetujui uji manual multi-hari hanya pada disposable sandbox `:13200`. Sandbox dihidupkan ulang dari container baru `koneva-retention-sandbox` pada loopback `:15432`; HTML banner DEV dan harness API sehat. Hari 1: satu percobaan manual `messages_90d` menghapus tepat satu pesan sintetis expired; queued lama dan data baru bertahan, dan status partial menandai pesan aktif yang sengaja dilindungi. Lima dry-run terjadwal pada 03:00 UTC (run 13–17) tercatat, semuanya tanpa penghapusan: `messages_90d` partial dengan satu expired dan satu aktif terlindungi; `webhook_logs_30d` menemukan satu; tiap tabel security-log menemukan satu; closed accounts dan invoices nol. Total 17 laporan agregat tersimpan (16 dry-run, 1 execute). Scheduler tetap dry-run-only. Uji manual kategori lain perlu dijalankan pada hari berbeda sebelum klaim uji multi-hari beres. `:13000` tetap gerbang terpisah.

> Update 2026-10-01 (Codex): Owner memutuskan transisi T1.6 hari ke-60 berlaku untuk kedua model API key workspace: tenant key lama dan scoped `wgk_`. Middleware menolak keduanya selama masih ada admin/viewer lama setelah deadline, dan akses pulih setelah Owner mengonversi/menghapus semua role lama; tidak ada jalur API untuk melewati penangguhan. Countdown dimulai saat notice in-app; email notice menyusul pada T4 begitu transport aktif tanpa me-reset deadline. Tes backend 119/119 lulus baik tanpa Redis (scoped key), maupun dengan `OPERATOR_TEST_REDIS=1` yang menyalakan Redis disposable dan menguji tenant key lama; TypeScript lulus. T1.5 tetap uji hari pertama; kategori manual berikutnya dijadwalkan satu per hari (berikutnya `webhook_logs_30d` pada 2026-10-02 WIB). Email belum dikirim.

> Update 2026-10-01 (Codex): T1.5 selesai dan divalidasi lokal; owner sekarang menyetujui uji penghapusan manual multi-hari hanya pada sandbox `:13200` dengan database disposable. Migration 026 menyediakan dry-run + constrained delete untuk messages/status/autoreply, webhook, security logs, dan closed accounts; invoices dipersist sebagai billing snapshots dan tetap report-only/selalu menolak delete. Runner `scripts/data-retention.ts` menolak superuser/nonmember, tidak fallback ke `DATABASE_URL`, hanya execute satu job eksplisit dengan `--execute` + dua env gate; scheduler `--schedule` hanya dry-run harian 03:00 UTC. Hasil DB dry-run/execute/failed disimpan sebagai aggregate-only di `retention_job_runs`, termasuk cutoff, oldest eligible, durasi/status/error-code generik. Backup rotation melapor lewat file JSONL privat durable; cloud purge tetap fail-closed. Bukti unit akhir: `bash scripts/test-data-retention.sh` (fresh migrasi 001-026 + reapply 026, marker forged denial, close/reopen/reclose, cutoff konsisten pada PostgreSQL LA dan Asia/Jakarta, scheduler 03:00 UTC dengan `TZ=Asia/Jakarta`, 5 dry-run tersimpan tanpa PII, kedua gerbang delete, synthetic deletion dan invoice protection); `bash scripts/test-backup-retention.sh`; backend suite 353 pass/2 skip/0 fail; operator STACK 40/40; billing unit 20/20; root/dashboard TypeScript dan diff-check bersih. Perubahan T1.5 dipush pada 2026-10-01 di commit `9c10450`. Hari 1 sandbox-lokal tercatat di catatan terbaru di atas; ini belum cukup untuk klaim uji multi-hari selesai. Tidak ada data non-sintetis/produksi, deploy, `:13000`, DOKU, atau WhatsApp asli yang disentuh.

> Update 2026-09-30 (Codex): T1.2 copy legal dan tes lulus lokal, masuk commit lokal batch T1.2; tidak dipush. Owner menetapkan refund/pembatalan, retensi, target respons, urgent, liability cap 3 bulan dan forum PN Bandung. Halaman legal tetap draf sampai ditinjau penasihat hukum/tanggal publikasi; cleanup retensi masih T1.5. T1.3 dimulai lokal dengan keputusan owner: 7 hari memperbaiki bukti, layanan aktif penuh saat verifikasi menunggu setelah pembayaran, lewat tenggat beralih ke harga normal tanpa suspend, refund tidak ada, invalid kedua suspend + email. Preview fix terpisah ada di `c839cdf`; T1.1 `48e2323` dipush menurut owner. Tidak ada push/deploy, `master` serta `:13000` tidak disentuh. Lihat [STATUS_PROYEK.md](STATUS_PROYEK.md) untuk status terkini.

> Update 2026-09-30 (Codex): T1.3 commit `d68794c` is pushed to `develop` after T1.2 commit `8bbd842`: migration `024_student_verification_flow.sql`, pay-before-student-review, seven-day correction deadline and pricing sweeper, second-invalid suspension, durable email outbox, and Tagihan UI states. Disposable backend/operator suite 118/118; direct mailer tests 7/7; backend/dashboard TypeScript and dashboard ESLint pass. Owner reported installing `libnspr4` and `libnss3`; successful Chromium runs now confirm browser dependencies resolve. On WSL, Chromium/Playwright system dependencies include `libnspr4` and `libnss3` (install with apt/sudo as owner); run npm/npx without sudo from `~/projects/wa-gateway/dashboard`. `cd dashboard && npm run test:ui -- tests/marketing/hydration.spec.ts` passes 7/7. No deploy, production database, `:13000`, DOKU, or real WhatsApp/email used.

> Update 2026-09-26 (Codex/Astra): backend Panel Operator now exists locally; see
> [OPERATOR_PANEL.md](OPERATOR_PANEL.md) for the reviewed contract, configuration, migration 018, validation and limits.
> Update 2026-09-26 (Claude): Operator Panel frontend (`dashboard/src/app/operator`) and TOTP MFA (migration 019) are done **locally**.
> Evidence: UI (65 Playwright tests, mocked API), STACK-local (28 browser tests against a real disposable Postgres + real router +
> Next proxy: `bash scripts/test-operator-stack.sh`), backend suite 277/277 (`bash scripts/test-operator-local.sh --all`). LIVE: none.
> Update 2026-09-26 (Claude, hardening stage): MFA security log (migration 020), owner-run provisioning/reset/key-rotation scripts, key-mismatch
> fail-safe, `/admin` network + legacy-write restrictions, hourly cleanup (idempotency retention 7 days), CI definition, legacy-student notice,
> real-`index.ts` tests (`bash scripts/test-operator-entry.sh`). Review candidate only; see the same file for what remains.
> Update 2026-09-26 (Claude, roles): customer roles are now Owner + Developer (legacy admin/viewer kept, not assignable), Gmail-only invitations with email OTP
> (fails safe until an email sender exists), Developer can delete devices. See [ROLES.md](ROLES.md) (migration 021 impact + owner decisions).
> Update (Codex): Gmail API OAuth sender support is now implemented for **invitation email OTP only**. No Google account was connected and no email was sent. `EMAIL_TRANSPORT` remains `none` unless configured. It requires Gmail API OAuth with only `gmail.send`; see the "Gmail sender for invitation OTP" section in [OPERATOR_PANEL.md](OPERATOR_PANEL.md). Operator MFA remains TOTP.
> Update 2026-09-27 (Claude): OTP limits (recipient/invitation/workspace/sender/IP, rolling, shared across processes, Gmail-alias-aware limiter keys) and Owner
> email verification before inviting/paying are implemented locally (migration 022); tests pin email off. Alerting for the 70 % threshold is still open. See [ROLES.md](ROLES.md).
> Update 2026-09-27 (Claude): the OTP 70 % / cap alert is now shown in the Operator Panel (`/operator/alerts`, `audit:read`); implemented locally, not deployed, no push channel.
> Update 2026-09-27 (Claude): outbound controls audit: workspace suspension / device pause now stop queued jobs, urgent jobs, auto-replies and device write commands at a last check before the WhatsApp transport;
> uncertain sends are no longer retried automatically. Local/fake-transport evidence only. See [OUTBOUND_CONTROLS.md](OUTBOUND_CONTROLS.md).
> **Baca dulu: [HANDOFF_TO_CODEX_2026-09-27.md](HANDOFF_TO_CODEX_2026-09-27.md)** — ringkasan lengkap pekerjaan Claude saat Codex rate-limited (harga, cost-meter, perbaikan bug lokal, batas mana yang owner ubah langsung).
> Update 2026-09-27 (owner decision, mid-session): pricing changed locally to match the PM research candidates (Pelajar Rp29.000, Solo/`umkm` Rp99.000 renamed, new Tim Rp149.000
> tier), migration 023. Hypothesis prices per the research, not validated; see [PRICING_UPDATE_2026-09-27.md](PRICING_UPDATE_2026-09-27.md) for open items. Not deployed.
> Not production-ready: see "Remaining operational work" in [OPERATOR_PANEL.md](OPERATOR_PANEL.md). Nothing was committed or deployed.
> It is disabled by default and cannot be enabled in production before MFA. No commit/deploy/production migration was
> performed. Claude's uncommitted dashboard files were preserved. The historical status sections below describe the
> earlier deployed baseline, not this uncommitted local implementation.
> Update 2026-09-28 (Claude): [ENVIRONMENT_MAP.md](ENVIRONMENT_MAP.md) added — port/service/DB/mock-vs-live map derived
> from actual config (not :13000 access). DEV sandbox banner + fail-closed WhatsApp/email guards for `:13200`
> (`KONEVA_SANDBOX=1`): `dashboard/src/components/dev-banner.tsx`, `src/shared/sandbox.ts`, wired into
> `src/bot-container/connection.ts` and `src/api-gateway/services/mailer.ts`. See "ATURAN DEPLOY PER GERBANG" below —
> deploy to `:13000` is now explicitly a per-Gerbang-batch decision, not per task; nothing in this update touched `:13000`.
> Update 2026-09-28 (Claude, same day, follow-up): identified the live `:13200` process by PID/cwd/env before touching
> it (cwd = this repo's `dashboard/`, wired to the operator-stack harness on `:13210`) instead of using a broad
> `pkill`; stopped it by exact PID and restarted both the dashboard and the harness with `KONEVA_SANDBOX=1`. Confirmed
> live: the DEV banner renders in `:13200`'s actual HTML (`curl`), and the real `:13000` `bot-container`/`device-manager`
> Docker processes seen in `ps aux` were checked and confirmed to point at a *different* Postgres (the `wa-personal`
> compose network) than this harness's disposable one, i.e. structurally unrelated to `:13200`. Generated a new,
> dedicated SSH key for GitHub push (`~/.ssh/koneva_github_deploy`, not `mps_key`, which stays VPS-only) — the
> private key was never printed; only its public key/fingerprint were shared with the owner to register as a GitHub
> deploy key. Push is still blocked (see T0.4 in `STATUS_PROYEK.md`): the new key is not yet registered on GitHub.

## ATURAN DEPLOY PER GERBANG (`:13000`)

Deploy ke `:13000` dilakukan **per batch setelah satu Gerbang selesai, bukan per task**. Sebelum deploy batch:

1. Claude menyelesaikan perubahan lokal, lalu melaporkan diff/bukti tes dan kondisi sistem apa adanya.
2. PM (Codex) memeriksa bukti dan mengonfirmasi.
3. Owner memberi konfirmasi eksplisit.
4. Baru deploy **batch Gerbang** ke `:13000` dijalankan.

Tanpa keempat langkah itu selesai, agen dilarang mengakses, mengubah, me-restart, atau deploy ke `:13000` —
untuk task apa pun, bukan hanya yang menyentuh `:13000` secara langsung. Gerbang 0 selesai pada 2026-09-29 (lihat `STATUS_PROYEK.md`); status itu tidak mengizinkan deploy. Agen bekerja
di `:13200`/`:13300`/harness disposable saja. Detail port/service/mock-vs-live: [ENVIRONMENT_MAP.md](ENVIRONMENT_MAP.md).

Ditulis 2026-09-26 oleh Claude Code (Sonnet 5), atas permintaan pemilik proyek (Dzaki). Bahasa percakapan dengan
pemilik: **Indonesia**. Kode dan dokumen teknis: Inggris (kecuali UI, yang Indonesia).

Tujuan dokumen: agent yang membaca ini bisa langsung tahu **apa yang sudah jadi, seberapa yakin itu bekerja,
apa yang belum, apa yang sulit, dan apa yang sebaiknya dikerjakan berikutnya**, tanpa membaca riwayat obrolan.

> Kejujuran status. Setiap fitur ditandai tingkat verifikasinya. Jangan menganggap "unit test lulus" sama dengan
> "terbukti jalan di WhatsApp asli".

---

## 1. Produk singkat

**KONEVA** (sebelumnya "WA Gateway"; nama internal Docker/Kubernetes tetap `wa-gateway`). Layanan API + dashboard
untuk mengirim/menerima pesan WhatsApp memakai **nomor milik pelanggan sendiri**, terhubung lewat QR
(Baileys `7.0.0-rc14`, jalur **TIDAK resmi**, tanpa fallback resmi). Risiko pembatasan/blokir nomor nyata dan
dinyatakan terbuka di situs; tidak ada janji "bebas blokir".

- Satu container bot = satu device (satu nomor). Istilah UI untuk satu nomor tersambung: **Device** (dulu "Nomor").
- Pelanggan awal yang dituju: **Pelajar + UMKM** (self-service, tagihan manual). Bisnis menyusul; Instansi terakhir
  (butuh jalur resmi/hibrida, SLA, kontrak).
- Harga masih placeholder (`price_is_final=false`); harga akhir harus dihitung dari biaya per nomor (belum diukur).

## 2. Menjalankan

Lingkungan: WSL2 (Linux) di `/home/dzayong/projects/wa-gateway`, Windows di `/mnt/c/Users/dzaki`.

| Aksi | Perintah |
|---|---|
| Bangun ulang + migrasi + segarkan bot (sesi WhatsApp tetap) | `make update` |
| Lihat status | `make ps`, `make logs`, `make monitor` |
| Backup | `make backup` |
| Semua tes | `docker start docker-postgres-1 docker-redis-1; npm test; docker stop docker-postgres-1 docker-redis-1` |
| Satu berkas tes | `node --require ts-node/register --test path/to/file.test.ts` |
| Typecheck | `npx tsc --noEmit` (root) dan `cd dashboard && npx tsc --noEmit && npx eslint src` |

- Tumpukan pribadi (port): API `18000`, dashboard `13000`, Postgres `55432`. Dashboard mem-proxy `/api/v1/*`,
  `/auth/*`, `/public/*` ke API (`dashboard/next.config.ts`; `proxyTimeout` dinaikkan ke 70 s).
- **3 tes kesehatan butuh Postgres di `localhost:5432`**: nyalakan container lama `docker-postgres-1` /
  `docker-redis-1` hanya saat menjalankan `npm test`, lalu matikan.
- Env: `.env.personal` (jangan di-commit). Contoh: `.env.personal.example`. Variabel penting selain DB/Redis:
  `ADMIN_API_KEY`, `PAYMENT_INSTRUCTIONS`, `OPERATOR_CONTACT`, `NEXT_PUBLIC_SITE_URL`
  (**harus diisi domain asli sebelum publik**; default `localhost` merusak canonical/sitemap).
- Verifikasi UI dilakukan dengan Playwright/Chromium. Di WSL ini Chromium butuh libs tambahan:
  `LD_LIBRARY_PATH=/tmp/pwlibs/root/usr/lib/x86_64-linux-gnu` dan `NODE_PATH=$HOME/.claude/skills/playwright-skill/node_modules`,
  launch dengan `--no-sandbox`. (Libs diekstrak manual dari paket `.deb` karena tidak ada sudo.)

Tes: **243 lulus, 0 gagal** (per commit `79e8a49`).

## 3. Arsitektur (ringkas)

```
Browser -> Next.js dashboard (:13000) --proxy--> API gateway (Express 5, :18000) --> Postgres
                                                      |  \--> Redis (BullMQ queue + pub/sub)
                                                      v
                                      device-manager --docker run--> bot container (1 per nomor)
                                                                      Baileys socket <-> WhatsApp
```

- **Kirim pesan:** `POST /api/v1/message/send` -> baris `messages` (status `queued`) -> job BullMQ
  `queue:messages:<deviceKey>` (+ antrean `-urgent` untuk OTP) -> bot `queue.ts` menjalankan anti-ban
  (`anti-ban.ts`: batas harian berbasis health score, batas per menit, jendela persona, kelelahan, filter isi), jeda, mengetik,
  lalu `sock.sendMessage`. Status/recibo diperbarui dari event Baileys; webhook dikirim (`webhook.ts`).
- **Pesan masuk:** `incoming.ts` -> tabel `messages` (`direction='inbound'`) -> webhook `message.received`
  -> balas otomatis (`auto-reply.ts`).
- **Perintah ke device (baru):** gateway menulis `device_commands` + publish Redis `bot:command:<key>`;
  `command-runner.ts` di bot mengklaim baris (`FOR UPDATE SKIP LOCKED`), menjalankan `commands.ts`, menulis hasil.
  Dipakai untuk: `status.post`, `profile.get`, `profile.update`, `profile.picture`.
- **Presence (baru):** `presence.ts`, dipakai `queue.ts`, `auto-reply.ts`, `commands.ts`.
- **Akun/peran:** pengguna, workspace (=tenant), peran `owner/admin/developer/viewer`, kunci API `wgk_`,
  sesi `wgs_`, undangan `wgi_`. Aturan izin default-deny di `src/shared/permissions.ts` (satu daftar aturan
  regex; tes penjaga memastikan tiap rute punya aturan).
- **Tagihan (manual):** `plans`, `subscriptions`, `invoices`; status efektif dihitung dari tanggal
  (`src/shared/billing.ts`); penegakan di `billing.service.ts`.

Migrasi: `migrations/001..017` (sekali jalan berurutan, sudah diuji dari nol sampai 013; 014-017 diterapkan di DB
hidup). Berkas penting: lihat bagian 10.

## 4. Status fitur

Legenda verifikasi: **LIVE** = terbukti di nomor WhatsApp asli; **STACK** = dijalankan lewat API/DB stack nyata
(tanpa WhatsApp); **UI** = diperiksa di browser sungguhan; **UNIT** = hanya tes unit.

### Selesai dan terbukti
| Fitur | Verifikasi | Catatan |
|---|---|---|
| Kirim/terima pesan, status terkirim/dibaca | LIVE | Pesan masuk sempat gagal (participant `''` di Baileys), sudah diperbaiki. |
| Jeda ala manusia, mengetik, jendela persona, kelelahan, 24 jam, jeda tetap/acak per nomor | LIVE + UNIT | Preset peran nomor (`presets.ts`). |
| OTP `priority: urgent` cepat (~0,75 s) | LIVE | Antrean terpisah, tanpa jeda. |
| Device dapat langsung dipakai setelah online; batas pengiriman umum dan pemeriksaan consent tetap berlaku | UNIT | Tidak ada lagi batas berdasarkan usia device. Risiko pembatasan WhatsApp tetap ada. |
| Skor kesiapan v2 (5 faktor berbobot) | UNIT + STACK | `readiness.ts`. |
| Deteksi ban/logout/error + webhook `device.status_changed` | LIVE (sintetis) + UNIT | |
| Antrean andal (retry, penyapu pesan tersangkut) | LIVE | Bug lama: re-queue tanpa attempts. |
| Akun, peran, kunci API, tim + undangan, audit log | STACK + UI | |
| Tagihan manual, paket, kuota, masa tenggang 7 hari | STACK + UI | Harga placeholder. |
| Webhook: kunci `whsec_`, tes, log, header `X-Webhook-Signature`, timeout 10 s | STACK + UNIT + UI | Halaman `/developers/webhooks`. |
| Rutinitas presence: pesan masuk -> jeda 1-200 s acak -> online -> jeda -> baca -> jeda -> offline; membalas/mengirim memastikan online dulu | UNIT (+ berjalan di bot hidup) | **Belum diamati perilakunya di WhatsApp asli** (belum ada pesan masuk uji). Default ON semua nomor; bisa dimatikan per nomor. |
| `profile.get` (nama, About, foto, tipe akun, profil bisnis) | **LIVE** (baca saja, nomor Business milik pemilik) | 0,4 s. |
| Landing page di `/`, SEO, `robots`, `sitemap`, `llms.txt`, OG image, FAQ+JSON-LD, `/docs` publik | UI + curl | Belum diuji oleh crawler nyata. |
| Statistik kunjungan tanpa cookie (`site_events`) | STACK + UNIT | Operator: `GET /admin/site-stats`. |
| Media di pesan/broadcast (`media_url`, `media_type`, caption; tautan di teks) | STACK + UNIT | Belum mengirim gambar sungguhan ke WhatsApp. |

### Ada tetapi BELUM terbukti di WhatsApp asli
| Fitur | Risiko |
|---|---|
| **Posting Status** (teks/gambar/video, jadwal, batas 3/hari, audiens `chatted`/`list`) | Belum pernah benar-benar diposting. Audiens memakai `statusJidList` dari riwayat pesan. |
| **Hitung yang melihat Status** (`status_views`, dari event `message-receipt.update`) | Tidak diketahui apakah WhatsApp mengirim recibo lihat ke sesi tertaut. Hanya orang dengan "tanda baca" aktif terhitung (batas bawah). |
| **Ubah profil**: nama, About, foto (`profile.update`, `profile.picture`), profil bisnis | Mengubah nomor asli; hanya UNIT. Foto: klien memotong persegi 640 px -> base64 -> `sock.updateProfilePicture` (sharp ada di image bot). |
| Media pesan (gambar/video/dokumen) | Belum dikirim ke penerima nyata. |

### Dihapus / tidak berjalan
- **Katalog WhatsApp Business: DIHAPUS.** `getCatalog/getCollections/productCreate...` tidak dijawab WhatsApp untuk
  sesi perangkat tertaut (8 varian stanza dicoba di nomor Business yang punya katalog; JID biasa vs LID x `smax_id`
  none/6/35/5: semuanya tanpa jawaban). Pustaka Baileys diam-diam mengembalikan hasil **kosong** setelah timeout 60 s
  (terlihat seperti "katalog kosong"). Laporan pihak ketiga menyebut masalah upstream yang sama (Baileys #2717).
  Halaman publik `wa.me/c/<nomor>` hanya deep link tanpa data. Kode katalog sudah dilepas; `withDeadline` di
  `commands.ts` tetap ada agar kegagalan diam-diam serupa tidak tampil sebagai data kosong.

### Belum dikerjakan (backlog, urut usulan)
1. **Panel Operator (super admin) di dashboard.** Sekarang "super admin" hanya pemegang `ADMIN_API_KEY` lewat `curl`
   (`/admin/*`). Tidak ada UI, tidak ada peran super admin untuk akun pengguna. **Penting untuk peluncuran**: konfirmasi
   pembayaran manual dan verifikasi pelajar hanya bisa lewat `curl`. Yang belum ada: daftar pengguna, nonaktifkan/hapus
   akun, reset kata sandi, log lintas tenant, impersonasi.
2. Akun demo per peran + halaman "Peran dan akses".
3. Asisten harian: pengingat WhatsApp (ke diri sendiri/orang tertentu, berulang), catatan cepat, rekap pagi,
   cek kebiasaan. Risiko ban rendah (pesan ke diri sendiri/kontak yang sering berbalas).
4. Riwayat profil nomor dari chat history (hanya angka ringkasan, isi pesan TIDAK disimpan; sudah disetujui pemilik).
   "Jalur cepat" untuk nomor lama. Butuh sambung ulang nomor uji karena riwayat hanya datang saat pairing.
5. Asisten gaya-bicara (LLM, opt-in per nomor; mulai dari mode Draf).
6. ~~Auto-reply belum mengecek paket~~ **Sudah ditutup lokal (2026-09-27)**: pemeriksaan administratif terakhir (`send-guard.ts`) sebelum transport untuk antrean, auto-reply, dan perintah tulis device; lihat [OUTBOUND_CONTROLS.md](OUTBOUND_CONTROLS.md). Penyapu langganan tetap hanya mencatat (status efektif dihitung dari tanggal).
7. Email: belum ada layanan email (verifikasi email, reset kata sandi, verifikasi pelajar otomatis).
8. Kepemilikan: transfer owner / keluar workspace belum ada.
9. Grup: ID grup tidak disimpan di pesan masuk/webhook; kirim ke grup belum ada (opt-in dengan batas sendiri disarankan).
10. `docs/openapi.yaml` belum memuat billing, webhook, status, profil, media (docs/API.md sudah).
11. Pool cadangan nomor (failover), proxy per nomor, uji beban, PgBouncer/Kubernetes.
12. Kode pairing sebagai alternatif QR.
13. Identitas usaha di footer, halaman status layanan, tinjauan hukum (lihat 7).

## 5. Kesulitan dan keputusan penting (agar tidak diulang)

1. **Katalog tidak bisa** (lihat 4). Jangan hidupkan lagi tanpa bukti bahwa WhatsApp menjawab. Pembanding: cek
   dulu lewat baca saja (`sock.query` mentah) sebelum menulis UI.
2. **Timeout proxy Next 30 s vs API 45 s** menghasilkan "500" polos di browser. Solusi: `experimental.proxyTimeout`
   70 s dan tunggu API dipendekkan (profil 22-40 s). Gejala umum bila ada panggilan lambat lagi.
3. **Animasi mati diam-diam** untuk pengguna Windows dengan "kurangi gerakan": aturan global `!important` di
   `globals.css` membekukan teks berjalan. Pengecualian: kelas `.keep-motion` (marquee, kursor). Uji dengan
   `reducedMotion: 'reduce'` di Playwright, bukan hanya mode normal.
4. **Baileys quirks:** `key.participant` bisa `''`; pesan `@lid` butuh `remoteJidAlt`; riwayat lama hanya datang saat
   pairing (`syncFullHistory` + browser Desktop bila mau); query yang tidak dijawab **diselesaikan kosong**, bukan error.
5. **Kontrol pengiriman tidak menjamin bebas pembatasan**: efek nyata ke WhatsApp hanya terlihat dari waktu dan data
   nyata. Semua angka adalah kehati-hatian, bukan batas terukur.
6. **Skor kesiapan** dulu memberi poin gratis (mis. `blocked_at`/`reported_at` tak pernah terisi). Sudah dibersihkan; hanya
   kirim keluar berstatus sent/delivered/read yang dihitung.
7. **SQL tidak tertangkap tes unit dengan queryFn palsu** (mis. `inconsistent types deduced for parameter`).
   Jalankan SQL baru sungguhan di Postgres (dry-run) sebelum dianggap benar.
8. **Media di `messages`:** `type` = jenis media, `content` = caption, `media_url` = alamat. Baris lama menyimpan alamat di
   `content`; `toMessageContent` (queue.ts) menangani keduanya.
9. **Harga katalog x1000** dan konversi lain dari fitur katalog sudah dihapus bersama katalog.
10. **Tampilan:** "warna per section" memakai backdrop tetap yang diinterpolasi saat scroll (`stage.tsx`), teks tiap
    section memakai token `tone-*` (`globals.css`). Perubahan warna cukup di token itu.

## 6. Perilaku tiap saat yang perlu diketahui

- Bot **memakai `markOnlineOnConnect: false`**; online hanya lewat `presence.ts`. Default rutinitas presence
  **aktif untuk semua nomor**, artinya pesan masuk dibaca dengan jeda sampai ~6 menit kecuali balas otomatis yang
  membacanya lebih dulu. Ini akan terasa saat pemilik menguji.
- Penyapu di API: langganan (tiap jam), hasil `device_commands` non-status (dihapus >1 hari; berisi email/alamat
  profil bisnis), status post (>30 hari).
- `device_commands` yang tersisa `running` setelah bot restart ditandai `failed: INTERRUPTED` (tidak diulang agar
  status tidak terposting dobel).
- Batas: status 3/hari/device (`STATUS_DAILY_LIMIT`); media tersedia setelah device online dan tetap tunduk pada kontrol umum.

## 7. Keamanan dan hal yang masih menggantung

- **Commit `5cc7584` (riwayat git) memuat `.env.production` di dalam tarball 68 MB.** Sudah di-untrack dan
  `*.tar.gz` di-gitignore, tetapi tetap ada di riwayat. **Sebelum push apa pun: tulis ulang riwayat dan rotasi semua
  rahasia produksi.** Jangan push sebelum itu dilakukan; pemilik belum meminta push.
- Jangan pernah meng-commit `.env*`, `sessions/`, `backups/`, `data/`.
- Dua device uji milik pemilik, **keduanya tercatat dengan nomor telepon yang sama (+6285624509601)**:
  `WAPI-BE415D7BCB` ("CS", workspace Dzaki) **online** (akun WhatsApp Business); `WAPI-3243AB10B5` ("CS-Djoko", workspace
  "Toko Djoko") **offline, `logged_out` (401)** sehingga sesinya perlu dipindai ulang. Kontainer "healthy" tidak berarti
  sesi WhatsApp online: cek kolom `devices.status` atau log bot.
- Sesi login dashboard disimpan di `localStorage` (risiko XSS). Peningkatan yang diketahui: cookie httpOnly.
- Pengambilan media oleh bot memakai URL dari pelanggan: hanya https, host privat/lokal ditolak (`shared/media-url.ts`);
  rebinding DNS tidak ditangani.
- Halaman `/syarat` dan `/privasi` adalah **draf** (`[DIISI]` menandai keputusan pemilik), `noindex`, belum ditinjau ahli hukum.
  Nama merek "KONEVA"/singkatan "WA" perlu tinjauan hukum merek; `koneva.com` sudah menjawab DNS (kemungkinan terpakai).
- Logo: `Downloads/KONEVA.png` ternyata infografis roadmap (bukan logo). Logo yang terpasang **dibuat sendiri** (SVG,
  `dashboard/src/components/brand/koneva-logo.tsx`, `app/icon.svg`). Ganti bila pemilik punya logo final.

## 8. Preferensi pemilik (penting untuk cara kerja)

- Jawaban ringkas, padat, teknis, Bahasa Indonesia; jelaskan konsep dengan **teks, bukan Artifact**.
- Alur proyek (dari `CLAUDE.md` pemilik): PLAN -> DESIGN -> BUILD -> FIX -> TEST -> DEPLOY -> NOTIFY (`~/notify.sh "..."`);
  loop FIX/TEST sampai lulus. Maks 1 pertanyaan per giliran, 3 total, jangan bertanya ulang yang sudah dijawab.
- Keputusan penting dicatat ke `~/memory.md` (format `[tanggal] [proyek] [keputusan]`); baca di awal sesi.
- **Commit hanya bila diminta**; sejauh ini pemilik menyetujui commit tiap tahap ("gas keun"). Jangan `--amend`, jangan
  ubah riwayat, jangan push.
- **Jangan menyentuh nomor WhatsApp asli pemilik tanpa izin** (memposting status, mengubah profil, mengirim pesan).
  Operasi baca murni pernah dilakukan dan diberitahukan.
- UI: cerah, profesional, tidak terlihat seperti "buatan AI"; token warna di `dashboard/src/app/globals.css` adalah rujukan.
  Landing bergaya produk luar negeri (referensi Resend/Clerk/Linear); foto yang sudah dipilih **jangan diubah**.
- Jujur soal risiko dan bukti: jangan mengarang testimoni/angka; tulis apa yang belum teruji.
- Jangan `pkill -f` dengan pola yang muncul di baris perintahmu sendiri (membunuh shell). Untuk `redis-cli` di
  container gunakan `docker exec ... sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ...'` (tanda kutip tunggal).
- Setelah menguji dengan akun/tenant/perangkat percobaan, **bersihkan datanya** (hapus `messages` dulu sebelum `tenants`
  karena FK; hapus job Redis `queue:messages:<key>*` dan container bot uji).

## 9. Perubahan terbaru (commit `79e8a49`)

Permintaan pemilik: hapus katalog, pindahkan profil ke modul device, ganti nama modul "Nomor" menjadi "Device".

- Backend: `src/shared/commands.ts` (tipe perintah: `profile.get|update|picture`, `status.post`),
  `src/bot-container/commands.ts` (profil, `withDeadline` 15 s, `WA_TIMEOUT`), `src/api-gateway/routes/device-content.routes.ts`
  (nama baru dari `business.routes.ts`: status + `/devices/:key/profile*`), izin `content:write` untuk PATCH/POST/DELETE profil,
  aturan audit `profile.*`, `docs/API.md` bagian "Status and device profile".
- Dashboard: halaman `/catalog` dihapus (juga item menu); tab **Profil** di detail device
  (`components/devices/device-profile.tsx`: foto dengan potong-persegi + resize di browser, nama, About, dan profil bisnis
  bila akun Business); label modul **Nomor -> Device** (menu, judul, tombol, toast, pilihan; kalimat penjelas yang
  merujuk "nomor WhatsApp" sengaja dibiarkan).
- Diverifikasi: typecheck root + dashboard, lint, 243 tes, dan `profile.get` LIVE (baca saja). Ubah profil belum diuji live.

## 10. Peta berkas

| Area | Berkas |
|---|---|
| Entri API | `src/api-gateway/index.ts` (rute, penyapu, error handler) |
| Rute | `src/api-gateway/routes/*.routes.ts` (`device-content` = status + profil, `billing`, `admin`, `public`, ...) |
| Layanan | `src/api-gateway/services/*.service.ts` (`command.service.ts`, `billing.service.ts`, `account.service.ts`, ...) |
| Izin/peran | `src/shared/permissions.ts` (+ `permissions.test.ts` penjaga rute) |
| Bot | `src/bot-container/`: `index.ts`, `connection.ts`, `queue.ts`, `anti-ban.ts`, `presence.ts`, `commands.ts`, `command-runner.ts`, `incoming.ts`, `auto-reply.ts`, `status-views.ts`, `webhook.ts`, `health-score.ts` |
| Bersama | `src/shared/`: `persona.ts`, `presets.ts`, `readiness.ts`, `billing.ts`, `commands.ts`, `media-url.ts`, `config.ts` |
| Dashboard | `dashboard/src/app/(dashboard)/*` (aplikasi), `(marketing)` (`/`, `/docs`, `/syarat`, `/privasi`), `components/marketing/*` (landing), `components/brand/koneva-logo.tsx` |
| Dokumentasi | `docs/API.md` (rujukan utama), `docs/openapi.yaml` (usang), `dashboard/README.md`, `~/memory.md` (keputusan) |

## 11. Riwayat commit (terbaru di atas)

```
79e8a49 Remove catalog; device profile tab; rename Nomor module to Device; HANDOFF report
7ff0d7a KONEVA rebrand with generated logo, media in messages/broadcast, status view counts
c034bad Catalog: honest notice, share link, purge finished read commands; remove probe
cccc115 Fix bare 500 on slow catalog calls: raise Next proxy timeout, shorten catalog waits
ff32e3d Landing UX: nav signup CTA, audience section, price hint, calmer risk line, step/picture sync by centre distance
9fbed4d Landing fixes: marquee under reduced motion, always-mounted step images + photo, stable rotating headline, lazy video
528f039 WhatsApp Status posting, Business profile and catalog via device commands; docs and dashboard pages
94fae68 Public site: landing at /, SEO (...), docs, draft terms/privacy, FAQ, cookie-free stats, scroll colour transitions
3d904fa Landing photos, formal footer, Newsreader display font, presence routine
677faad Webhook secret/test/logs + docs, cobalt/navy palette, landing redesign, product tour media
5fe018e Billing (plans, subscriptions, manual invoices, enforcement) + Tagihan page + animated landing
135db6c Dashboard: translate the remaining screens to Indonesian and refresh the README
c2a76bd Add personal deployment tooling, docs and Kubernetes updates
5b230e2 Dashboard: sign-up, role-aware navigation, number setup and developer tools
8e8b18b Add accounts, roles, scoped API keys, team invitations, audit log and presets
8ad24f3 Fix inbound messages and make sending behave like a person
5cc7584 WIP: Integration testing pending  (memuat rahasia produksi di riwayat, lihat bagian 7)
```

## 12. Langkah berikutnya yang disarankan untuk agent baru

1. Baca bagian 4 dan 7, jalankan `npm test` dan `make ps` untuk memastikan kondisi.
2. Bangun **Panel Operator** (backlog 1). Mulai dari rencana
   singkat (peran super admin di tabel pengguna atau kunci admin lewat sesi, halaman `/operator` terpisah, audit lintas tenant).
3. Sebelum membangun fitur yang menyentuh WhatsApp, buktikan lewat operasi baca atau nomor uji dan minta izin pemilik.
4. Perbarui dokumen ini (bagian 4 dan 9) di akhir setiap tahap.
> Update 2026-09-30 (Codex): owner accepted point 1 and approved points 2–4 as one batch. Point 1 commit `f786a36` and log follow-up `3965180` are pushed to `develop`; they cover API send/retry/broadcast admission, source-note-backed manual consent API, server-verified OTP exception, structured denial warnings, and conservative legacy opt-out backfill. Batch implementation now protects queue worker/final transport, internal bot `/send`, auto-reply, and `status.post`; inbound STOP/START persists before webhook/auto-reply, STOP suppresses queued promos and gets one idempotent non-promotional confirmation. Consent UI remains separate. Validation: full local suite 353 passed/2 skipped/0 failed; outbound disposable DB+Redis suite 23/23; migration proof on fresh disposable PostgreSQL reports 26 migrations, legacy backfill and idempotence passed; root/dashboard typechecks, OpenAPI parse, and diff-check pass. No deploy/DB production/`:13000`/DOKU/WhatsApp/email real.

> Update 2026-10-07 (Codex): generated a dedicated RSA-2048 key pair for DOKU SNAP merchant registration. Private key is stored at `/home/dzayong/.local/share/koneva/doku-sandbox/merchant-private.pem` (directory mode 0700, file mode 0600); public key at `/home/dzayong/.local/share/koneva/doku-sandbox/merchant-public.pem`. The current checkout/webhook integration is Non-SNAP and uses HMAC-SHA256 with DOKU_SHARED_KEY; it does not currently use JWE or this RSA key. Keep the private key for a future SNAP access-token signature flow; do not inject it into the current HMAC integration. Public-key SHA-256 fingerprint: `6e682f4c8044b5cb55928671112a52383efa67bbe7e1f2d5fc1b135d38750dc6`. Owner confirmed on 2026-10-07 that the public key is registered in DOKU Dashboard > Settings > API Keys > Edit Merchant Public Key. This RSA key is for a future SNAP access-token signature flow; the current Non-SNAP HMAC checkout/webhook does not use it.

> Update 2026-10-08 (Codex, Gmail/OTP recovery): Owner confirmed Google Auth Platform status is **In production**. The previous Gmail OAuth refresh token returned `invalid_grant`; a dedicated helper `scripts/get-gmail-oauth-token.personal.ts` completed a new consent flow for `gmail.send` and wrote the new refresh token only to ignored `.env.personal` (mode 0600; token never printed). A token refresh test returned HTTP 200. API gateway was recreated alone using the existing personal Compose project, became healthy, and its in-container refresh token was compared to `.env.personal` without displaying either value (match). OTP/outbox regression on disposable Postgres/Redis passed 127/127 with Gmail variables pinned empty. One test email to the owner address was accepted by Gmail API (HTTP 200); delivery to Inbox/Spam awaits owner confirmation. `/ready` returned ready and no new `EMAIL_CREDENTIALS_INVALID` appeared in the recent API log. The old refresh token was replaced locally and already unusable (`invalid_grant`); no separate revoke request was sent because Google documents that revocation removes all project scopes and invalidates issued tokens across clients, which could also revoke the newly issued token. The authorization callback/code was accidentally pasted into chat during the first attempt; that attempt failed state validation and was discarded. The second callback was consumed and exchanged successfully; do not reuse or share callback URLs/codes. The helper and docs changes remain uncommitted. No DOKU verification, API-key cutover, retention execution, or Kimi activation was started.

> Update 2026-10-08 (Codex, DOKU sandbox checkpoint): Isolated DOKU sandbox Postgres/Redis and API are separate from `wa-personal`; Cloudflare Quick Tunnel package SHA-256 matched Cloudflare's upstream release checksum before execution. The current tunnel is `https://witness-plumbing-planets-ken.trycloudflare.com`; `/health` returned 200, and POST `/billing/doku/notify` reached the handler (empty-body probe returned expected `400 MISSING_HEADERS`). `.env.doku-sandbox` remains private mode 0600; credential fields are configured, and a format-only check found no surrounding whitespace, quotes, or duplicate entries. `APP_PUBLIC_URL` was updated to the current tunnel root and the isolated API restarted. A synthetic signup (local dev-outbox OTP) and IDR 59,000 Asisten invoice were created in the disposable database. Checkout against the hard-coded sandbox host `api-sandbox.doku.com` failed with provider `invalid_signature` (HTTP 400); application error mapping hid provider details, and a separate direct diagnostic using the same DOKU signing function got the same code. No payment URL was obtained, no payment was made, no webhook was processed, and no invoice/workspace was activated. The request signature structure matches DOKU's current Non-SNAP docs, so the likely cause is a Client ID / Secret Key mismatch or credentials from the wrong environment; cannot distinguish without owner checking both values in Sandbox Back Office. Do not proceed to payment until checkout succeeds. The owner must update the relevant payment-channel Notification URL to `https://witness-plumbing-planets-ken.trycloudflare.com/billing/doku/notify`; DOKU docs require a public URL set per channel. This code is Non-SNAP HMAC checkout and does not use a SNAP Token URL. Tunnel and sandbox runtime are session-bound and will stop with this session. No secrets or credential values were recorded; no production DOKU or `:13000` payment was used.
