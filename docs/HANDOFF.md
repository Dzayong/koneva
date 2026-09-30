# HANDOFF: laporan kerja untuk agent berikutnya (Codex/Claude)

> Update 2026-09-30 (Codex): T1.2 copy legal dan tes lulus lokal, masuk commit lokal batch T1.2; tidak dipush. Owner menetapkan refund/pembatalan, retensi, target respons, urgent, liability cap 3 bulan dan forum PN Bandung. Halaman legal tetap draf sampai ditinjau penasihat hukum/tanggal publikasi; cleanup retensi masih T1.5. T1.3 dimulai lokal dengan keputusan owner: 7 hari memperbaiki bukti, layanan aktif penuh saat verifikasi menunggu setelah pembayaran, lewat tenggat beralih ke harga normal tanpa suspend, refund tidak ada, invalid kedua suspend + email. Preview fix terpisah ada di `c839cdf`; T1.1 `48e2323` dipush menurut owner. Tidak ada push/deploy, `master` serta `:13000` tidak disentuh. Lihat [STATUS_PROYEK.md](STATUS_PROYEK.md) untuk status terkini.

> Update 2026-09-30 (Codex): T1.3 commit `d68794c` is pushed to `develop` after T1.2 commit `8bbd842`: migration `024_student_verification_flow.sql`, pay-before-student-review, seven-day correction deadline and pricing sweeper, second-invalid suspension, durable email outbox, and Tagihan UI states. Disposable backend/operator suite 118/118; direct mailer tests 7/7; backend/dashboard TypeScript and dashboard ESLint pass. Owner reported installing `libnspr4` and `libnss3`; successful Chromium runs now confirm browser dependencies resolve. `cd dashboard && npm run test:ui -- tests/marketing/hydration.spec.ts` passes 7/7. `npx playwright install-deps` was also tried in this session but waits for interactive sudo authentication, so this session did not install packages. No deploy, production database, `:13000`, DOKU, or real WhatsApp/email used.

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
  `ADMIN_API_KEY`, `PAYMENT_INSTRUCTIONS`, `OPERATOR_CONTACT`, `WA_PROXY_URL`, `NEXT_PUBLIC_SITE_URL`
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
  (`anti-ban.ts`: pemanasan, batas harian/menit, jendela persona, kelelahan, filter isi), jeda ala manusia, mengetik,
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
| Pemanasan (hari 1-2: 5/hari tanpa memulai; 3-4: 10; 5-7: 20 + media; 8+: 50), balasan boleh sejak hari 1 | LIVE + UNIT | |
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
5. **Pemanasan/anti-ban tidak bisa dibuktikan di sini**: efek nyata ke WhatsApp hanya terlihat dari waktu dan data
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
- Batas: status 3/hari/device (`STATUS_DAILY_LIMIT`), media hanya setelah hari ke-5 pemanasan.

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
> Update 2026-09-30 (Codex): T1.4 enforcement point 1 diimplementasikan lokal menunggu final commit/push dan owner review. `025_recipient_consent.sql` membuat consent state + append-only audit dan backfill opt-out historis secara konservatif; API admission menahan send/retry/broadcast tanpa opt-in, API manual consent wajib source note, dan hanya OTP yang lolos verifikasi server dapat memakai pengecualian. Caller `priority: urgent` tidak dianggap bukti. Verifikasi terbaru: `test-operator-local.sh --all` 349 lulus/2 skip/0 gagal; migrasi disposable 26 migrasi, legacy backfill dan idempotence lulus; `git diff --check` bersih. Batas: worker/final-send dan inbound STOP/START belum dilindungi, jadi jangan anggap consent enforcement end-to-end selesai; tunggu review owner sebelum points 2–4. Playwright `tests/marketing/hydration.spec.ts` 7/7 lulus; pemasangan `playwright install-deps` tertahan autentikasi sudo, tidak ada paket yang dipasang sesi ini. Tidak ada deploy/DB produksi/`:13000`/DOKU/WhatsApp/email sungguhan.
