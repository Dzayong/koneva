# Status Proyek KONEVA

Sumber kebenaran status proyek. Codex/PM mengubah status dan `updated_at` setiap ada perubahan yang terverifikasi. Claude memperbarui task ke `doing` saat mulai, lalu `done` hanya setelah bukti tercatat; jika gagal karena prasyarat, gunakan `blocked` beserta kebutuhan yang jelas. Kimi hanya membaca file ini, tidak boleh mengubah status.

- **Updated at:** 2026-09-27
- **Tahap aktif:** Tahap 0 — Aman & tertib
- **Posisi bukti:** Lokal / sintetis saja; belum ada bukti LIVE baru
- **Git:** branch `develop` dibuat dari `master` (`master` tidak berubah, masih `2250924`). 11 commit lokal baru di `develop` (lihat T0.2). Working tree sekarang hanya 2 entri belum commit: `migrations/023_pricing_tiers.sql` dan `docs/PRICING_UPDATE_2026-09-27.md` — sengaja ditahan karena angka harganya beda dari "Keputusan terkunci" di `ROADMAP_2026-09-28.md` (menunggu T1.1). 0 staged. Tidak ada remote. `k8s/secrets.yaml` tetap tracked di `develop` (isinya template `CHANGE_ME`, dikonfirmasi bukan secret aktif — lihat T0.1). Tarball `wa-gateway-backup-20260925.tar.gz` sudah **tidak reachable** dari riwayat lokal manapun.
- **Catatan:** T0.1 dan T0.2 (bagian aman) selesai dikerjakan Claude 2026-09-27. Tidak ada push. Tidak menyentuh `.env` (dibaca terenkripsi via scanner saja, isinya tidak pernah dicetak), nomor WhatsApp, stack `:13000`, VPS atau production.

## Tahap 0 — Aman & tertib

| Task | Status | Bukti singkat | Blocker / langkah berikut |
|---|---|---|---|
| T0.1 Inventaris file sensitif dan bersihkan `k8s/secrets.yaml` + tarball dari riwayat lokal | **done** | Scan redacted (gitleaks v8.21.2) atas worktree (328 temuan, semua di path yang sudah `.gitignore`d — `data/`, `backups/`, `sessions/`, `.next*` — atau di file lama yang sudah ter-commit sebelumnya) dan riwayat penuh (3 temuan, sama-sama pre-existing/placeholder). `k8s/secrets.yaml` diperiksa strukturnya: semua field sensitif (`JWT_SECRET`, `ADMIN_API_KEY`, `ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, dst.) berisi placeholder `CHANGE_ME`-style, bukan nilai aktif — **tidak perlu diubah**. Tarball `wa-gateway-backup-20260925.tar.gz` (65 MB, ditambahkan di commit lama `5cc7584`) dikonfirmasi memuat `.env` dan `.env.production` **asli** berdasarkan daftar nama file di dalam arsip (isi tidak pernah dibaca). Checkpoint filesystem penuh dibuat (`~/koneva-checkpoint-20260927T222923`) sebelum rewrite; worktree di-`git stash` lalu riwayat ditulis ulang dengan `git-filter-repo` (`--invert-paths --path wa-gateway-backup-20260925.tar.gz`); diverifikasi: 18 commit master isi/urutan identik, `git fsck --full` bersih, tidak ada remote, tarball tidak reachable dari objek manapun; stash dikembalikan dan **git status setelah pop sama persis 109 entri dengan sebelum rewrite** — tidak ada perubahan worktree yang hilang. | **Rotasi kredensial yang ada di `.env`/`.env.production` era 2026-09-25 (ADMIN_API_KEY, JWT_SECRET, kredensial database saat itu) tetap wajib ditandai sebagai blocker sebelum push mana pun ke remote mana pun** — riwayat lokal bersih tidak membatalkan kebutuhan rotasi jika arsip itu pernah terekspos ke pihak lain (mis. pernah di-`scp`/disalin manual). Tidak ada rotasi yang dijalankan Claude (tidak berwenang menghubungi provider). |
| T0.2 Branch `develop` dan commit per fitur/topik | **done (bagian aman)** | `develop` dibuat dari `master`. 11 commit topik dibuat (urut lama→baru): `8dd19a6` operator core+MFA, `ee37f28` roles+OTP+verifikasi email, `5bee322` outbound controls, `8f3c795` tes entrypoint asli, `80e0f87` skrip tooling, `a85d195` UI Panel Operator+roles, `99c2ddf` tes dashboard, `6cbab11` perbaikan hydration marketing, `01e8fe7` workflow CI, `b19d9f5` dokumentasi, `b58e840` status proyek (commit ini). Setiap `git add` diperiksa otomatis terhadap pola `.env/secret/session/backup/.tar.gz/data` sebelum commit — tidak ada yang cocok. Tes penuh dijalankan di `develop` setelah semua commit: backend `test-operator-local.sh --all` 322/324 lulus (2 skip gated, sama seperti biasa), `dashboard` `tsc --noEmit` dan `eslint` bersih. | 2 file harga (`migrations/023_pricing_tiers.sql`, `docs/PRICING_UPDATE_2026-09-27.md`) **sengaja tidak di-commit** — angkanya (Pelajar 29rb/Solo 99rb/Tim 149rb) sudah digantikan "Keputusan terkunci" di ROADMAP (Pelajar 29rb/Asisten Pribadi 59rb/Tim UKM 99rb/Bisnis CS 199rb). Menunggu T1.1 untuk migrasi baru yang sesuai. |
| T0.3 Checks/CI pertama | todo | Belum dijalankan pada task ini | Jalankan matrix workflow lokal; CI hosted hanya jika tersedia remote dan owner menyetujui push |
| **Gerbang 0** Repo aman, pekerjaan terpilih tercatat dalam commit aman, checks wajib hijau | todo | T0.1+T0.2 lulus; T0.3 belum dikerjakan | T0.3 |

## Tahap 1 — Kesiapan lokal final

| Task | Status | Bukti singkat | Blocker / langkah berikut |
|---|---|---|---|
| T1.1 Katalog harga baru, grandfather Pelajar aktif, tutup annual order baru | todo | Belum dikerjakan | Implementasi hanya setelah Gerbang 0; uji migrasi disposable dan histori invoice |
| T1.2 Syarat & Privasi, consent, opt-out, retensi copy | todo | Halaman tersedia; ada placeholder yang harus diperiksa/diisi | Retensi dan copy “unlimited*” perlu keputusan owner/legal |
| T1.3 Bayar → submit data Pelajar → verifikasi | todo | Belum dikerjakan | Menunggu pilihan owner untuk data invalid/tenggat/refund/aktivasi |
| T1.4 Consent/opt-out end-to-end | todo | Desain ada; implementasi belum terbukti | Perlu policy scope dan bukti tes semua outbound path |
| T1.5 Retensi tabel data bisnis | todo | Banyak tabel belum punya retensi terjadwal | Menunggu keputusan durasi per jenis data |
| T1.6 Pemberitahuan transisi peran admin/viewer (60 hari) | todo | Keputusan 60 hari sudah ada | Buktikan notice dan tidak ada pencabutan dini |
| **Gerbang 1** Semua bukti stack-local, copy legal minimum lengkap, tests hijau | todo | — | Tidak lanjut sebelum semua P0 tertutup |

## Tahap 2 — Level/Misi & cost meter

| Task | Status | Bukti singkat | Blocker / langkah berikut |
|---|---|---|---|
| T2.1 Spec Level & Misi Nomor | todo | Owner memberi konsep Lv 0–4 | Codex tulis acceptance criteria, consent guardrails, bypass copy dan misi tiap level |
| T2.2 Implementasi Level & Misi | todo | Belum dikerjakan | Sesudah spec disetujui owner |
| T2.3 Cost meter per workspace/paket | todo | Discovery/rancangan tersedia; angka nyata belum diukur | Benchmark sintetis dan data tagihan infra/support diperlukan |
| **Gerbang 2** Fitur lokal dan data biaya per paket tersedia | todo | — | Tidak lanjut tanpa bukti dan asumsi biaya yang ditandai |

## Tahap 3–6 — Infrastruktur dan peluncuran

| Task | Status | Bukti singkat | Blocker / langkah berikut |
|---|---|---|---|
| T3.1 Benchmark resource 1 idle / 1 aktif / 5 aktif | todo | Belum dijalankan | Lokal sintetis; bukan pemakaian WhatsApp LIVE |
| T3.2 VPS IP publik: sewa dan deploy stack disposable | todo | Belum ada VPS/bukti IP | Vendor/budget owner; deployment tidak boleh menyentuh production |
| T3.3 Observasi sesi uji 14 hari nonstop | todo | Belum ada izin/akun uji | Akun khusus dan izin eksplisit owner; ukur stabilitas, bukan bebas ban |
| **Gerbang 3** VPS lolos → baru domain dibeli | todo | — | Uptime/reconnect/auth-loss/IP/resource terukur dan diterima owner |
| T4 Go-live infrastruktur domain sendiri | todo | Belum mulai | Gerbang 3, pembelian domain, email sender, monitoring, backup/restore dan rollback |
| T5 Pilot terbatas satu periode penuh | todo | Belum mulai | Gerbang 4, cohort dan dukungan disetujui, akun/nomor uji diizinkan |
| T6 Rilis umum | todo | Belum mulai | Gerbang 5; legal/PSE harus ditempatkan sebelum public use bila diwajibkan |
