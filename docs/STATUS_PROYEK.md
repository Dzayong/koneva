# Status Proyek KONEVA

Sumber kebenaran status proyek. Codex/PM mengubah status dan `updated_at` setiap ada perubahan yang terverifikasi. Claude memperbarui task ke `doing` saat mulai, lalu `done` hanya setelah bukti tercatat; jika gagal karena prasyarat, gunakan `blocked` beserta kebutuhan yang jelas. Kimi hanya membaca file ini, tidak boleh mengubah status.

- **Updated at:** 2026-09-27
- **Tahap aktif:** Tahap 0 — Aman & tertib
- **Posisi bukti:** Lokal / sintetis saja; belum ada bukti LIVE baru
- **Git:** branch `master`; 109 entri worktree belum commit (108 entri sebelumnya + file status PM ini); 0 staged; belum ada remote yang terlihat. `k8s/secrets.yaml` tercatat di Git. Tarball backup disebut ada dalam sejarah Git, tidak ada di worktree. Audit redacted belum dikerjakan.
- **Catatan:** Prompt Claude disiapkan Codex; belum dijalankan berhasil. Tidak ada branch/commit baru. Jangan menyentuh `.env`, nomor WhatsApp, stack `:13000`, VPS atau production tanpa izin eksplisit.

## Tahap 0 — Aman & tertib

| Task | Status | Bukti singkat | Blocker / langkah berikut |
|---|---|---|---|
| T0.1 Inventaris file sensitif dan bersihkan `k8s/secrets.yaml` + tarball dari riwayat lokal | doing | Claude mulai: scan redacted worktree+history, checkpoint lokal, lalu pembersihan riwayat | Claude jalankan scanner dengan redaction penuh dan checkpoint aman; jika secret aktif ditemukan, laporkan kategori tanpa nilainya dan tandai rotasi sebelum push |
| T0.2 Branch `develop` dan commit per fitur/topik | todo | Belum ada branch atau commit baru | Tunggu T0.1; jangan mass-commit; exclude `.env*`, secret, sessions, backups dan data |
| T0.3 Checks/CI pertama | todo | Belum dijalankan pada task ini | Jalankan matrix workflow lokal; CI hosted hanya jika tersedia remote dan owner menyetujui push |
| **Gerbang 0** Repo aman, pekerjaan terpilih tercatat dalam commit aman, checks wajib hijau | todo | — | Tidak lanjut Tahap 1 sebelum gerbang lulus |

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
