# Peta Environment KONEVA

Dipetakan dari konfigurasi aktual (docker-compose, script, `playwright.*.config.ts`, `k8s/`) dan proses yang
benar-benar berjalan saat dokumen ini ditulis (2026-09-28), bukan tebakan. Setiap baris menyebut sumbernya.
Port :13000 **tidak diakses** untuk menyusun dokumen ini — datanya dari `docker/docker-compose.personal.yml`,
`.env.personal.example` dan `docs/HANDOFF.md` saja.

## Ringkasan cepat: siapa boleh menyentuh apa

| Environment | Siapa boleh menyentuh | Butuh apa |
|---|---|---|
| `:13000` personal (real WhatsApp, real DB) | **Owner saja** yang menjalankan `make update`/`make ps`. Agen (Claude/Codex/Kimi) **tidak boleh** mengakses/mengubah/restart/deploy tanpa 4 langkah di bawah ("ATURAN KERAS :13000"). | Konfirmasi eksplisit owner, per giliran. |
| `:13200`/`:13300` dev/operator sandbox, harness disposable | Claude boleh start/stop/uji bebas — data sintetis, transport mock. | Tidak ada; sudah disposable by design. |
| VPS (`91.98.225.235`, kunci `~/.ssh/mps_key`) | Belum ada task yang mengotorisasi akses hari ini. | Izin eksplisit owner per task. |
| GitHub (`Dzayong/koneva`) | Hanya Claude yang commit/push ke repo proyek (aturan owner 2026-09-28, lihat `ROADMAP_2026-09-28.md`). | Push develop butuh autentikasi Git yang valid di sandbox eksekusi (lihat T0.4 di `STATUS_PROYEK.md` — saat ini belum ada). |

## Tabel port

| Port | Layanan | Sumber definisi | Database | Mode WhatsApp/Email | Siapa boleh sentuh | Tingkat verifikasi |
|---|---|---|---|---|---|---|
| **13000** | Dashboard Next.js, stack personal (`wa-personal-dashboard-1`) | `docker/docker-compose.personal.yml` (`DASHBOARD_PORT`, default 13000) | Postgres `:55432` (lihat baris terkait) | **REAL** — bot container Baileys asli; email sesuai `EMAIL_TRANSPORT` di `.env.personal` pemilik (tidak dibaca) | **Owner saja**, via 4-langkah "ATURAN KERAS :13000" di bawah | LIVE (dipakai nomor WhatsApp asli pemilik, per `docs/HANDOFF.md` §7) |
| **18000** | API gateway, stack personal (`wa-personal-api-gateway-1`) | `docker/docker-compose.personal.yml` (`API_PORT`) | sama seperti di atas | REAL | Owner saja | LIVE |
| **18001** | Device manager, stack personal | `docker/docker-compose.personal.yml` (`MANAGER_PORT`) | — | REAL (mengorkestrasi container bot asli via Docker socket) | Owner saja | LIVE |
| **55432** | Postgres, stack personal | `docker/docker-compose.personal.yml` (`DB_PORT`), bind `127.0.0.1` | — | — | Owner saja | LIVE |
| **56379** | Redis, stack personal | `docker/docker-compose.personal.yml` (`REDIS_PORT`), bind `127.0.0.1` | — | — | Owner saja | LIVE |
| **5432** | Postgres, dev-lama (`docker-postgres-1`) | `docker/docker-compose.yml` (base, tanpa profil personal) | kredensial default lemah (`wagateway123`) — **hanya untuk `npm test`** | tidak relevan (tidak ada API/bot terpasang) | Claude boleh nyala/matikan hanya saat `npm test` (`docs/HANDOFF.md` §2) | UNIT (dependency tes unit backend) |
| **6379** | Redis, dev-lama (`docker-redis-1`) | `docker/docker-compose.yml` (base) | — | — | sama seperti di atas | UNIT |
| **13100** | Dashboard Next.js, tes UI Operator Panel terisolasi | `dashboard/playwright.config.ts` (`baseURL`, tetap 13100, tidak ada override env) | **Tidak ada** — API operator di-mock penuh di browser (`tests/support/operator-mock.ts`) | Tidak ada transport nyata sama sekali (mock) | Claude bebas | UI (mock API, bukan STACK/LIVE) |
| **13200** | Dashboard Next.js — **lihat catatan ketidakcocokan di bawah** | Default fallback di `dashboard/playwright.stack.config.ts` (`STACK_WEB_PORT`, dipakai **hanya jika env var itu tidak di-set**) | Tergantung siapa yang start | Sebelum task ini: **tidak dijamin mock** — proses `next-server` yang sedang berjalan di port ini (pid berbeda-beda antar sesi) tidak selalu diberi `KONEVA_SANDBOX=1`. Setelah task ini: banner DEV + guard aktif **hanya jika** proses tersebut diberi `KONEVA_SANDBOX=1` secara eksplisit saat start. | Claude boleh start/stop bebas selama data sintetis | UI, tergantung env instance — **tidak otomatis "aman" hanya karena nomor portnya 13200** |
| **13210 / 13211 / 18091** | API harness / kontrol harness / stub device-manager | Default fallback di `scripts/operator-stack-harness.ts` (`STACK_API_PORT`/`STACK_CTL_PORT`) dan `dashboard/tests-stack/support/stack.ts` (`STACK_MANAGER_PORT`) | Postgres disposable (Docker, port acak `127.0.0.1::5432`, lihat baris di bawah) | Router palsu (`operator-stack-harness.ts`) — **bukan** `src/api-gateway/index.ts` sungguhan; tidak ada bot/WhatsApp; email lewat `/email` control endpoint, default tidak diset (fail-safe `none`) | Claude bebas | STACK-local (router/middleware asli, tanpa Redis/bot/WhatsApp) |
| **13300 / 13310 / 13311 / 18092** | Web / API / kontrol harness / stub device-manager — **port yang BENAR-BENAR dipakai** | `scripts/test-operator-stack.sh` (baris `export STACK_WEB_PORT=13300 STACK_API_PORT=13310 STACK_CTL_PORT=13311` dan `DEVICE_MANAGER_URL=...18092`) — script ini yang dijalankan T0.3, bukan nilai default di config | Postgres disposable, label `koneva.purpose=operator-isolated-test` | Sama seperti baris 13210 di atas: router palsu, tanpa bot/WhatsApp, `EMAIL_TRANSPORT=dev-outbox` (file lokal saja) | Claude bebas | STACK-local — **inilah env yang benar-benar dilaporkan 37/37 lulus di T0.3**, bukan yang di port 13200/13210 |
| **(port acak, di-bind `127.0.0.1::5432`/`::6379`)** | Postgres/Redis disposable per skrip tes | `scripts/test-operator-local.sh`, `test-outbound-local.sh`, `test-operator-entry.sh` — semua label `koneva.purpose=operator-isolated-test` | data sintetis, dibuang sesudah tes | `EMAIL_TRANSPORT=none` dieset eksplisit di ketiga skrip ini; tidak ada bot/WhatsApp sama sekali | Claude bebas | UNIT/backend (dilaporkan T0.3) |
| **15432** (proses live saat ini) | Postgres, harness operator lokal (manual, di luar ketiga skrip resmi di atas) | Tidak ada di skrip manapun — terlihat dari `ss -ltnp` saat ini, kemungkinan disetel manual `DATABASE_URL=...15432/operator_test` pada sesi sebelumnya | data sintetis `operator_test` | tidak relevan | Claude (dimulai sesi sebelumnya) | Tidak resmi — sebaiknya disamakan dengan salah satu skrip di atas |
| **9000** (per bot), **9090** Prometheus, **8000** api-gateway, **8001** device-manager, **5432**/**6379** Postgres/Redis | Kubernetes (`k8s/`) — Kind cluster disposable (`wa-gateway-control-plane`) | `k8s/*/deployment.yaml`, `k8s/*/statefulset.yaml`, `k8s/network-policies.yaml` | Postgres/Redis StatefulSet di namespace `wa-gateway` (cluster Kind lokal, bukan cloud) | Tergantung image yang di-`kind load`; `scripts/deploy.sh` menolak jalan bila `k8s/secrets.yaml` masih `CHANGE_ME` | Claude bebas (cluster disposable, lihat T0.1/T0.1b) | UI/STACK terbatas (`scripts/verify-kind.sh`) |

### Ketidakcocokan dokumentasi vs konfigurasi yang ditemukan

1. **":13200" tidak dan/atau tidak lagi berarti satu hal yang konsisten.** `playwright.stack.config.ts` memakainya sebagai *default fallback* untuk `STACK_WEB_PORT`, tetapi `scripts/test-operator-stack.sh` — satu-satunya jalur resmi yang dipakai T0.3 — **selalu meng-override** ke `13300`. Proses `next-server` yang nyatanya sedang berjalan di `:13200` saat ini tidak berasal dari skrip resmi manapun; tampaknya dimulai manual pada sesi sebelumnya untuk pratinjau visual (`npx next dev -p 13200`), dan sebelum task ini **tidak diberi env `KONEVA_SANDBOX`** apa pun. Task hari ini (banner DEV + guard) diimplementasikan mengikuti instruksi eksplisit owner untuk `:13200`; disiplinnya sekarang ada di **env var `KONEVA_SANDBOX=1` yang harus diset eksplisit setiap kali proses itu dimulai**, bukan pada angka port itu sendiri — lihat `dashboard/playwright.sandbox.config.ts` dan bagian "DEV banner" di bawah.
2. **`docs/HANDOFF.md` §2 tidak menyebut `MANAGER_PORT` (18001) atau `REDIS_PORT` (56379)** untuk stack personal, walau keduanya didefinisikan di `docker/docker-compose.personal.yml`/`.env.personal.example`. Tidak diperbaiki di sini (di luar scope task ini mengedit HANDOFF selain aturan :13000 baru); dicatat agar tidak dianggap tidak ada.
3. **Port `15432`** yang sedang live (Postgres, tampak dari `ss -ltnp` saat dokumen ini ditulis) tidak berasal dari skrip resmi manapun (`test-operator-*.sh` memakai port acak via `-p 127.0.0.1::5432`, bukan port tetap 15432). Kemungkinan sisa dari sesi manual sebelumnya. Tidak dihentikan oleh task ini (di luar scope; berpotensi container Claude sendiri dari sesi lalu, bukan milik proses lain).

## ATURAN KERAS :13000

Tidak ada bagian dari task ini yang mengizinkan akses ke `:13000`. Proses wajib sebelum instance `:13000` boleh
disentuh (dicatat juga di `docs/HANDOFF.md` dan `docs/STATUS_PROYEK.md`):

1. Claude menyelesaikan perubahan lokal, lalu melaporkan diff/bukti tes dan kondisi sistem apa adanya.
2. PM (Codex) memeriksa bukti dan mengonfirmasi.
3. Owner memberi konfirmasi eksplisit.
4. Baru deploy/update `:13000` dijalankan.

Tanpa keempat langkah itu selesai, agen dilarang mengakses, mengubah, me-restart, atau deploy ke `:13000`. Agen
bekerja di `:13200`/`:13300`/harness disposable saja.

## DEV banner dan sandbox (`:13200`)

- **Mekanisme:** `dashboard/src/lib/sandbox.ts` (`isSandbox()`) membaca `process.env.KONEVA_SANDBOX` **di server, per-request**, lewat `next/server`'s `connection()` di `dashboard/src/components/dev-banner.tsx` — bukan `NEXT_PUBLIC_*` (yang dibekukan saat `next build`, sehingga satu build artifact yang dipromosikan ke beberapa environment akan menampilkan nilai yang sama di semua tempat) dan bukan deteksi port di browser (`window.location.port`).
- **Fail-closed:** env var tidak diset atau bernilai apa pun selain string `"1"` persis → banner **tidak tampil**, dan (lihat di bawah) transport WhatsApp tetap `real` (perilaku `:13000` tidak berubah).
- **Kill-switch WhatsApp:** `src/shared/sandbox.ts` (`whatsappTransportMode()`), dipanggil paling awal di `src/bot-container/connection.ts`'s `connect()` — sebelum `loadSession`/`fetchLatestBaileysVersion`/`makeWASocket` apa pun. `KONEVA_SANDBOX=1` memaksa `mock` tanpa bisa dioverride oleh `WHATSAPP_TRANSPORT=real` (tidak ada jalur tidak sengaja untuk menyalakannya kembali). Bukti: `src/bot-container/connection.test.ts`.
- **Allowlist email:** `src/shared/sandbox.ts` (`isSandboxEmailAllowed()`), dipanggil di `src/api-gateway/services/mailer.ts`'s `sendInvitationOtp()` sebelum transport `gmail-api` (transport asli) dipakai. Allowlist kosong secara default (menolak semua); `dev-outbox` (file lokal) tidak terpengaruh karena memang tidak pernah keluar mesin. Bukti: `src/api-gateway/services/mailer.test.ts`.
- **Tes banner:** `dashboard/playwright.sandbox.config.ts` + `dashboard/tests-sandbox/dev-banner.spec.ts` (banner tampil, `KONEVA_SANDBOX=1` di env proses itu sendiri) dan `dashboard/tests/marketing/dev-banner.spec.ts` (banner tidak tampil, config default tanpa `KONEVA_SANDBOX` — port 13100, bukan `:13000` sungguhan).

## Cara menjalankan tiap suite (ringkas)

| Perintah | Menjalankan apa | Port |
|---|---|---|
| `bash scripts/test-operator-local.sh --all` | Backend Operator Panel, Postgres/Redis disposable | port acak |
| `bash scripts/test-operator-entry.sh` | Entrypoint asli (`index.ts`) | port acak |
| `bash scripts/test-outbound-local.sh` | Guard outbound | port acak |
| `bash scripts/test-operator-stack.sh` | STACK-local: router asli + Next proxy asli | **13300**/13310/13311/18092 |
| `cd dashboard && npm run test:ui` | UI Operator Panel, API di-mock | 13100 |
| `cd dashboard && npx playwright test -c playwright.sandbox.config.ts` | Banner DEV, `KONEVA_SANDBOX=1` | 13200 (bisa override `SANDBOX_WEB_PORT`) |
| `bash scripts/verify-kind.sh` | Kubernetes disposable (Kind) | lihat tabel k8s di atas |
