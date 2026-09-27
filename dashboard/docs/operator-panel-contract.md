# Panel Operator: kontrak API (revisi 3, diimplementasikan lokal)

Status: **revisi 3**. Endpoint `/operator/*` sudah diimplementasikan di backend (Astra + MFA oleh Claude) dan diuji
secara **UI** dan **STACK-lokal** (lihat bagian 7). Belum ada bukti **LIVE**; belum siap produksi (lihat `docs/OPERATOR_PANEL.md`,
"Remaining operational work"). Keputusan backend yang mengikat ada di `docs/OPERATOR_PANEL.md`; bila berbeda dengan
teks usulan di bawah, dokumen itu yang berlaku.
Semua contoh memakai **data sintetis** (email, id, dan nomor palsu).

Kepemilikan: `dashboard/` = frontend. `src/api-gateway`, `src/shared`, migrasi, autentikasi/otorisasi operator, audit,
billing = Astra. Dokumen ini tidak mengubah kode backend.

## 0. Prinsip
- Same-origin: browser memanggil `/api/operator/*`; dashboard me-rewrite ke `${INTERNAL_API_URL}/operator/*`.
  Path `/admin` **tidak** dipakai browser dan tidak boleh diberi cookie operator.
- Sesi = cookie HttpOnly. Tidak ada token di JavaScript, `localStorage`, atau `NEXT_PUBLIC_*`.
- `ADMIN_API_KEY` tidak boleh menjadi jalan pintas untuk endpoint operator (tanpa identitas = tanpa audit).
- Amplop tetap: sukses `{success:true, data, pagination?}`; gagal `{success:false, error:{code, message, details?}}`.
  **Kecuali `204`**: tanpa body sama sekali.
- Semua respons `/operator/*` (dan halaman `/operator/*`): `Cache-Control: no-store`, `Vary: Cookie`.
- Semua DTO memakai **allowlist kolom** (bukan `SELECT *`, bukan menyalin baris tabel). Tidak ada secret, kunci API,
  webhook secret, QR, token sesi, atau data pribadi berlebih di respons **maupun** audit.
- `noindex` dan `robots.txt` bukan kontrol akses; hanya pengurangan paparan.

## 1. Autentikasi, sesi, CSRF

### 1.1 Bootstrap login (belum ada sesi, jadi belum ada token CSRF sesi)
Login harus dilindungi tanpa token sesi. Opsi yang diusulkan (Astra memilih, frontend mengikuti):

**Opsi A (usulan utama), tanpa token pra-sesi:**
1. `Origin` wajib ada dan **sama persis** dengan origin panel yang dikonfigurasi (`OPERATOR_ALLOWED_ORIGIN`); selain itu
   `403 ORIGIN_NOT_ALLOWED`. Periksa juga `Sec-Fetch-Site` bila ada (`same-origin` saja).
2. `Content-Type: application/json` saja, ditambah header kustom `X-Requested-With: koneva-operator` (memaksa preflight
   bagi situs lain; tanpa CORS mereka tidak bisa mengirimnya).
3. Cookie sesi `SameSite=Strict`.
4. Rotasi sesi saat login (id sesi baru; sesi lama dicabut).

**Opsi B:** `GET /operator/auth/bootstrap` (tanpa sesi) memberi token pra-sesi terikat cookie pra-sesi (`__Host-koneva_op_pre`,
HttpOnly) dan dikirim balik di `X-CSRF-Token` saat login. Lebih berat; dipakai bila Astra ingin token untuk login juga.

### 1.2 Token CSRF sesi
Setelah login, `GET /operator/me` dan respons login mengembalikan `csrf_token` (synchronizer token terikat sesi,
tidak ditulis ke `localStorage`; disimpan di memori tab). Semua metode mengubah data (`POST/PATCH/PUT/DELETE`) wajib
`X-CSRF-Token` **dan** `Origin` yang valid. Kegagalan: `403 CSRF_INVALID` / `403 ORIGIN_NOT_ALLOWED`.

### 1.3 Cookie
- Produksi: `__Host-koneva_op` dengan `Secure; HttpOnly; SameSite=Strict; Path=/` dan **tanpa** `Domain`.
- Pengembangan (http://localhost): `__Host-` butuh `Secure`. Chrome/Firefox menerima cookie `Secure` di `localhost`;
  Safari tidak. Aturan yang diusulkan: nama cookie dan `Secure` dikonfigurasi lewat env; nilai lemah (`Secure=false`,
  nama tanpa `__Host-`) **hanya** boleh bila `NODE_ENV != production` **dan** flag eksplisit
  `OPERATOR_INSECURE_DEV_COOKIES=true`. Server **menolak start** di produksi bila flag itu aktif. Tidak ada pelemahan diam-diam.

### 1.4 TTL, revokasi, kedaluwarsa
| Item | Usulan |
|---|---|
| Idle timeout | 30 menit, geser (perpanjang maksimal 1x per menit) |
| Batas absolut | 8 jam sejak login, tidak bisa diperpanjang |
| Re-autentikasi untuk aksi sensitif | Password ulang bila login >15 menit lalu untuk konfirmasi pembayaran dan keputusan pelajar: `401 REAUTH_REQUIRED` (opsional, disepakati Astra) |
| Revokasi | `POST /operator/auth/logout` (sesi ini); `POST /operator/auth/sessions/revoke-all` (semua sesi sendiri); ubah kata sandi/nonaktifkan operator mencabut semua sesi |
| Kedaluwarsa | `401 SESSION_EXPIRED` (idle/absolut/dicabut) vs `401 UNAUTHENTICATED` (tidak ada sesi); frontend menampilkan alasan berbeda |

Login, logout, dan interceptor operator **tidak menyentuh** sesi tenant (`wa_gateway_session`) dan sebaliknya.

### 1.5 MFA (TOTP, wajib di setiap login)
Alur (semua tanpa CSRF sesi, dengan cek Origin + JSON + `X-Requested-With`):
1. `POST /operator/auth/login {email,password}` -> `200 {status:"mfa_required"|"mfa_enrollment_required", challenge_id, expires_in:300}`.
   **Tidak ada cookie, tidak ada sesi.** Sesi lama tetap berlaku sampai MFA berhasil, lalu diganti.
2. Operator terdaftar: `POST /operator/auth/mfa/verify {challenge_id, code}` atau `{challenge_id, recovery_code}` ->
   `200 {status:"authenticated", operator, permissions, csrf_token, session, recovery_codes_remaining}` + cookie.
3. Operator baru: `POST /operator/auth/mfa/enroll/start {challenge_id, enrollment_code}` -> `{secret, otpauth_uri}` (kode
   pendaftaran sekali pakai dari luar jalur, 24 jam), lalu `POST /operator/auth/mfa/enroll/confirm {challenge_id, code}` ->
   sesi + 10 `recovery_codes` (tampil sekali; UI menahan masuk sampai operator menyatakan sudah menyimpannya).
4. Kesalahan: `401 INVALID_CREDENTIALS`/`INVALID_CODE`-sejenis (pesan generik), `429 RATE_LIMITED` (+`Retry-After`); challenge mati
   setelah 5 salah atau 5 menit. UI tidak pernah menyimpan challenge, secret, atau kode di storage.
5. **Re-autentikasi** = login penuh (password + MFA) di dalam dialog; setelah berhasil aksi yang sama dikirim ulang dengan
   **kunci idempotensi dan payload yang sama**. `REAUTH_REQUIRED` dijamin tanpa efek.

### 1.6 Endpoint
| Endpoint | Deskripsi | Hasil |
|---|---|---|
| `POST /operator/auth/login` `{email,password}` | Mulai sesi | `200 {status:"authenticated", operator, csrf_token, session:{idle_expires_at, absolute_expires_at}}`; `401 INVALID_CREDENTIALS`; `429 RATE_LIMITED` (`Retry-After`); `403 ORIGIN_NOT_ALLOWED` |
| `GET /operator/me` | Sesi saat ini | `200 {operator, permissions, csrf_token, session}`; `401 UNAUTHENTICATED|SESSION_EXPIRED`; `403 NOT_OPERATOR` |
| `POST /operator/auth/logout` | Cabut sesi ini | `204` tanpa body |

Izin: `payments:read`, `payments:confirm`, `students:read`, `students:decide`, `workspaces:read`, `audit:read`.

```jsonc
// POST /operator/auth/login  (sintetis)
// req  { "email": "ops@example.test", "password": "••••" }
// 200  { "success": true, "data": {
//   "status": "authenticated",
//   "operator": { "id": "0b9e0a52-6f0e-4b0c-8f0a-1a2b3c4d5e01", "name": "Operator Uji", "email": "ops@example.test" },
//   "permissions": ["payments:read","payments:confirm","students:read","students:decide","workspaces:read","audit:read"],
//   "csrf_token": "csrf_EXAMPLE",
//   "session": { "idle_expires_at": "2026-09-27T09:30:00Z", "absolute_expires_at": "2026-09-27T17:00:00Z" } } }
// 401  { "success": false, "error": { "code": "SESSION_EXPIRED", "message": "Sesi berakhir, silakan masuk lagi" } }
```

## 2. Konfirmasi pembayaran

| Endpoint | Deskripsi |
|---|---|
| `GET /operator/invoices?status=unpaid|paid|void&q=&limit=&offset=` | Daftar. `limit` default 25, maks 100, `q` maks 100 karakter; urutan **stabil** `created_at DESC, id DESC`. Izin `payments:read`. |
| `GET /operator/invoices/:id` | Detail. `payments:read`. |
| `POST /operator/invoices/:id/confirm-payment` | Konfirmasi. `payments:confirm`. Wajib `Idempotency-Key`, `X-CSRF-Token`. |

Void/refund **tidak** ada di MVP.

```jsonc
// GET /operator/invoices?status=unpaid&limit=2   (sintetis)
// 200 { "success": true,
//   "data": [ { "id": "b1f6...0001", "number": "INV-202609-0001", "workspace": { "id": "w-...01", "name": "Toko Uji" },
//     "plan": { "id": "umkm", "name": "UMKM" }, "cycle": "yearly", "amount_idr": 990000, "status": "unpaid",
//     "created_at": "2026-09-26T03:00:00Z", "due_at": "2026-10-03T03:00:00Z", "version": 1 } ],
//   "pagination": { "total": 1, "limit": 2, "offset": 0, "has_more": false } }

// GET /operator/invoices/:id
// 200 { "success": true, "data": {
//   "id": "b1f6...0001", "number": "INV-202609-0001", "status": "unpaid", "version": 1,
//   "amount_idr": 990000, "cycle": "yearly", "plan": { "id": "umkm", "name": "UMKM" },
//   "created_at": "...", "due_at": "...", "paid_at": null, "method": null, "reference": null, "note": null, "confirmed_by": null,
//   "workspace": { "id": "w-...01", "name": "Toko Uji", "owner": { "name": "Pemilik Uji", "email": "owner@example.test" } },
//   "subscription": { "plan": "trial", "status": "trial", "period_end": "2026-10-10T00:00:00Z" },
//   "student": null,
//   "timeline": [ { "at": "2026-09-26T03:00:00Z", "event": "invoice.created" } ] } }
```

### 2.1 `confirm-payment`
```jsonc
// POST /operator/invoices/b1f6...0001/confirm-payment
// Headers: Idempotency-Key: 8d2f0a3e-1c44-4b7e-9f55-2a6d9c1e7b10 ; X-CSRF-Token: csrf_EXAMPLE
// req  { "method": "transfer", "reference": "TRF-0001", "note": "Sesuai bukti", "expected": { "amount_idr": 990000, "version": 1 } }
// 200  { "success": true, "data": {
//   "invoice": { "id": "b1f6...0001", "number": "INV-202609-0001", "status": "paid", "version": 2, "paid_at": "2026-09-27T02:00:00Z",
//                "method": "transfer", "reference": "TRF-0001", "confirmed_by": { "id": "0b9e...01", "name": "Operator Uji" } },
//   "subscription": { "plan": "umkm", "status": "active", "cycle": "yearly", "period_end": "2027-09-27T02:00:00Z" } } }
// replay (key + payload sama) -> 200 body identik, header Idempotent-Replay: true, TANPA efek samping baru
```
Semantik `Idempotency-Key` (UUID v4, 16-64 karakter):
1. Disimpan unik pada `(operator_id, operation, target_id, key)` dengan `payload_hash` (hash JSON kanonik body) dan snapshot respons.
2. Key sama + payload sama -> kembalikan hasil sebelumnya, tanpa efek ulang (juga bila respons pertama hilang di jaringan).
3. Key sama + payload **berbeda** -> `409 IDEMPOTENCY_KEY_REUSED`.
4. Permintaan pertama masih berjalan -> `409 REQUEST_IN_PROGRESS` + `Retry-After`.
5. Kunci operator lain, operasi lain, atau target lain tidak bertabrakan. Retensi minimal 72 jam.

Kesalahan:
| Kode | Arti | `details` |
|---|---|---|
| `409 INVOICE_NOT_PAYABLE` | Sudah diproses (mis. operator lain) | `{current_status, paid_at, confirmed_by:{name}}` |
| `409 INVOICE_CHANGED` | `amount_idr`/`version` tidak lagi sama | `{current:{amount_idr, version, status}}` |
| `409 STUDENT_NOT_VERIFIED` | Paket Pelajar tanpa persetujuan | |
| `409 DUPLICATE_REFERENCE` | Lihat 2.2 | `{existing_invoice_number}` |
| `409 IDEMPOTENCY_KEY_REUSED` / `REQUEST_IN_PROGRESS` | Lihat di atas | |
| `400 VALIDATION_ERROR` | Field salah | `{fields:{...}}` |
| `401 UNAUTHENTICATED/SESSION_EXPIRED/REAUTH_REQUIRED`, `403 FORBIDDEN/CSRF_INVALID/ORIGIN_NOT_ALLOWED`, `404 INVOICE_NOT_FOUND`, `500 AUDIT_FAILED` | | |

### 2.2 Keunikan `reference` (perlu keputusan Astra)
Frontend **tidak** menganggap `reference` unik global. Usulan: unik per `(method, reference_normalized)` di antara invoice
`paid`; `reference` opsional; bila bentrok -> `409 DUPLICATE_REFERENCE` (bukan menimpa). Definisi akhir milik Astra; UI
hanya menampilkan pesan dan invoice yang bertabrakan.

### 2.3 Audit dan transaksi
Pencatatan audit terjadi **dalam transaksi yang sama** dengan perubahan invoice dan langganan. Bila audit gagal,
seluruh transaksi dibatalkan dan responsnya galat (`500 AUDIT_FAILED`), bukan sukses.

## 3. Verifikasi pelajar

Bukti yang **ada**: domain email pengaju dan catatan teks. **Tidak ada** unggah dokumen. Domain email hanya indikasi asal
email, bukan bukti status pelajar; UI menampilkan peringatan itu, dan API sebaiknya menamai bidangnya `email_domain` dan
`academic_domain_hint` (bukan `verified`).

Model: pengajuan punya **id sendiri** (`request_id`). Pengajuan ulang membuat pengajuan **baru**; keputusan lama tetap
tersimpan. State: `pending -> approved | rejected`; pengajuan yang tergantikan menjadi `superseded`. Approve/reject hanya
untuk `pending`. **Revoke tidak ada di MVP** (dampaknya pada langganan aktif belum disepakati).

| Endpoint | Deskripsi |
|---|---|
| `GET /operator/student-requests?status=pending|approved|rejected|superseded&q=&limit=&offset=` | `students:read` |
| `GET /operator/student-requests/:requestId` | `students:read` |
| `POST /operator/student-requests/:requestId/decision` | `students:decide`; `Idempotency-Key` dianjurkan |

```jsonc
// GET /operator/student-requests?status=pending  (sintetis)
// 200 { "success": true, "data": [ { "id": "r-...0001", "workspace": { "id": "w-...02", "name": "Uji Pelajar" },
//   "requester_email_masked": "m***@kampus.example.ac.id", "email_domain": "kampus.example.ac.id", "academic_domain_hint": true,
//   "status": "pending", "requested_at": "2026-09-26T04:00:00Z", "version": 1 } ],
//   "pagination": { "total": 1, "limit": 25, "offset": 0, "has_more": false } }

// GET /operator/student-requests/r-...0001  -> tambahan: requester_email (penuh, hanya di detail), note, decided_at:null, decided_by:null, reason:null, history:[]
// POST /operator/student-requests/r-...0001/decision
// req  { "decision": "reject", "reason": "Email bukan email kampus", "expected": { "request_id": "r-...0001", "version": 1 } }
// 200  { "success": true, "data": { "id": "r-...0001", "status": "rejected", "version": 2, "decided_at": "...", "decided_by": { "name": "Operator Uji" }, "reason": "Email bukan email kampus" } }
```
Kesalahan: `409 REQUEST_NOT_PENDING` (`{current_status, decided_by, decided_at}`), `409 REQUEST_CHANGED` (`version`), `409 REQUEST_SUPERSEDED`
(`{latest_request_id}`), `400 REASON_REQUIRED` (wajib untuk `reject`; opsional untuk `approve`), plus kode umum di 1.

## 4. Workspace (read-only)
| Endpoint | Deskripsi |
|---|---|
| `GET /operator/workspaces?q=&limit=&offset=` | `workspaces:read`, allowlist |
| `GET /operator/workspaces/:id` | `workspaces:read` |

```jsonc
// GET /operator/workspaces/w-...01   (sintetis; PERHATIKAN: tidak ada api_key, webhook_secret, kredensial, sesi WA, qr_code)
// 200 { "success": true, "data": {
//   "id": "w-...01", "name": "Toko Uji", "status": "active", "created_at": "2026-09-20T00:00:00Z",
//   "owner": { "name": "Pemilik Uji", "email": "owner@example.test" },
//   "subscription": { "plan": { "id": "umkm", "name": "UMKM" }, "status": "active", "cycle": "yearly", "period_start": "...", "period_end": "...", "days_left": 360 },
//   "usage": { "messages_used": 12, "messages_limit": 10000, "devices_used": 1, "devices_limit": 3, "members_used": 1, "members_limit": 3 },
//   "student": { "status": "approved" } } }
```

## 5. Audit (read-only)
`GET /operator/audit?action=&operator_id=&target_type=&target_id=&from=&to=&limit=&offset=` (`audit:read`). Ditulis **hanya oleh server**;
frontend tidak pernah membuat atau mengubah audit. `from/to` ISO 8601, rentang maksimal wajar (mis. 90 hari), `limit` maks 100.
```jsonc
// 200 { "success": true, "data": [ { "id": "a-...01", "at": "2026-09-27T02:00:00Z",
//   "operator": { "id": "0b9e...01", "name": "Operator Uji" }, "action": "invoice.confirm_payment",
//   "target": { "type": "invoice", "id": "b1f6...0001", "label": "INV-202609-0001" }, "reason": null,
//   "changes": { "status": { "from": "unpaid", "to": "paid" }, "method": { "from": null, "to": "transfer" } },
//   "request_id": "req-EXAMPLE" } ], "pagination": { "total": 1, "limit": 25, "offset": 0, "has_more": false } }
```
`changes` disanitasi per-aksi dengan allowlist bidang; **bukan** salinan baris database dan tidak memuat secret, token,
QR, atau data pribadi berlebih (mis. isi catatan pelajar tidak disalin).

### 5.1 Peringatan OTP (baca saja)
`GET /operator/alerts/otp` (`audit:read`) -> `{ events: [{ id, at, kind: "sender_70_percent"|"sender_cap_reached", scope: "sender_daily", window_hours, threshold_percent, severity: "warning"|"critical", usage_at_event, cap_at_event, percent_at_event, active, snapshot: true }], has_active, history_days, current: { usage, cap, percent, window_hours, measured_at, scope } }`.
`usage_at_event`/`cap_at_event` adalah **snapshot saat kejadian**; `current` diukur saat permintaan. Tanpa email, IP, kode, atau kunci pembatas. Halaman `/operator/alerts` dan banner di ringkasan; peringatan hanya terlihat saat operator membuka panel (tidak ada kanal lain).

## 6. Daftar dependensi backend untuk Astra
1. Identitas operator terpisah dari sesi tenant (tabel/peran platform, sesi sendiri), izin granular (1.6).
2. Cookie sesi (1.3) dengan konfigurasi env dan penolakan start produksi bila lemah.
3. Bootstrap login (1.1), CSRF sesi (1.2), pemeriksaan `Origin`, rate limit + penguncian login, TTL idle/absolut, revokasi (1.4).
4. **MFA** (1.5): TOTP selesai secara lokal; tersisa provisioning/pemulihan produksi dan audit event MFA.
5. Rewrite/proxy `/operator/*` yang aman, `Cache-Control: no-store`, `Vary: Cookie`.
6. Tabel idempotensi (2) dan `version` pada invoice; aturan keunikan `reference` (2.2).
7. Audit operator **transaksional**, mengizinkan target tanpa workspace, dengan `operator_id`, `reason`, `changes` tersanitasi, `request_id`.
8. Entitas pengajuan pelajar dengan id, versi, riwayat, dan state (3).
9. DTO allowlist untuk semua endpoint operator; perbaiki `GET /admin/tenants` (`SELECT t.*`) dan `GET /admin/devices`
   (`SELECT *`) yang mengembalikan kolom sensitif (`api_key`, `webhook_secret`, `qr_code`) kepada pemegang kunci admin
   (paparan yang tidak perlu; **bukan** kebocoran publik yang terbukti).
10. Pagination stabil, validasi filter, `total`.
11. Tes integrasi STACK bersama frontend: 403 non-operator, CSRF/Origin, konflik antaroperator, idempotensi (replay, reuse, in-progress),
    kegagalan audit membatalkan transaksi, tidak ada secret di respons.

## 6b. Aturan klien yang berlaku (diimplementasikan di `src/lib/operator`, `use-guarded-submit`)
- Deadline: baca 15 s, tulis 30 s (AbortController). Timeout/abort/redirect/respons bukan JSON milik API/5xx pada mutasi = **hasil
  belum pasti**: form dikunci, "Coba lagi (aman diulang)" memakai **kunci dan payload yang sama**, "Periksa status" membaca ulang
  invoice/pengajuan. Kunci baru hanya lewat reset eksplisit setelah status dibaca.
- `AUDIT_FAILED` = gagal pasti **hanya** bila `details.rolled_back === true`; selain itu tak pasti. `OUTCOME_UNKNOWN` selalu tak pasti.
- Setelah reload/hilang state, status invoice/pengajuan dibaca ulang sebelum tombol aksi aktif (`staleTime:0`, tombol nonaktif saat fetch).
- Filter tanggal audit: tanggal WIB -> `from` = 00:00 WIB hari mulai (inklusif), `to` = 00:00 WIB **hari berikutnya** dari tanggal akhir (eksklusif), dikirim sebagai UTC ISO.
- Catatan pribadi pelajar dan alasan keputusan tidak masuk URL, log konsol, analitik, atau pesan error.

## 7. Tingkat bukti (aturan pelaporan)
- Tes frontend dengan API di-mock = **UI**. Mock tanpa secret tidak membuktikan backend nyata bebas secret.
- Bukti otorisasi/respons aman = **STACK** bersama Astra di lingkungan terisolasi.
- **LIVE** tidak diklaim dari mock atau tes browser.
- Sekarang: **UI** = `npx playwright test` (65 tes, API di-fake di browser). **STACK-lokal** = `bash scripts/test-operator-stack.sh`
  (28 tes: Postgres sekali-pakai, router operator asli, proxy Next asli, cookie asli; termasuk cookie `__Host-` HttpOnly/Secure/Strict,
  penolakan `ADMIN_API_KEY`/bearer tenant, Origin/CSRF/izin, replay, ubah payload, konflik antaroperator, kegagalan audit =
  rollback penuh, respons hilang setelah COMMIT, 502/redirect, re-autentikasi, revokasi/kedaluwarsa, batas tanggal WIB, paginasi,
  tanpa kolom rahasia). **LIVE**: belum ada.
