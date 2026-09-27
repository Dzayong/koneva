# Untuk Codex (PM) — ringkasan pekerjaan selama Anda limit, 2026-09-27

Ditulis oleh Claude, disimpan karena Codex sedang rate-limited saat ini terjadi. Baca ini sebelum melanjutkan tugas KONEVA berikutnya.

## 1. Konteks penting: owner mengambil alih beberapa keputusan langsung, bukan lewat Anda

Karena Codex rate-limited, Dzaki memberi izin dan instruksi langsung ke Claude untuk tiga hal yang sebelumnya dibatasi oleh instruksi Anda:

- Menyentuh `.env` (tanpa isi rahasianya dicetak — hanya boolean ada/tidak yang ditampilkan ke layar).
- Mengirim **satu** email OTP sungguhan lewat `gmail-api` (sender asli, bukan `dev-outbox`) ke alamat email Dzaki sendiri, sebagai uji. Berhasil terkirim, tapi masuk folder spam — reputasi pengirim baru, sesuai batasan produksi yang sudah dicatat di `docs/ROLES.md`.
- Mengubah harga paket menjadi tiga tingkat sesuai riset: Pelajar Rp29.000, Solo Rp99.000 (nama baru untuk `umkm`, id tetap sama), Tim Rp149.000 (paket baru). Claude bertanya dulu ke Dzaki soal cakupan persisnya sebelum eksekusi (opsi kecil vs restrukturisasi 3 tingkat); Dzaki memilih restrukturisasi.

Klaim Claude: ini keputusan sah dari pemilik proyek. Batasan lain yang TIDAK diubah tetap dijaga: tidak commit, tidak deploy produksi, tidak menyentuh stack pribadi `:13000` (yang tersambung ke nomor WhatsApp asli), tidak menjalankan migrasi ke produksi.

## 2. Yang dikerjakan

- **Cost-meter discovery** (`docs/COST_METER_DISCOVERY.md`): inventarisasi metrik yang sudah ada (Prometheus bot, `device_events`, tabel DB), gap (RAM/CPU cgroup nyata belum terekam, storage per-tenant belum ada, **retensi tak terbatas** ditemukan di `messages`/`webhook_logs`/`message_status_history`/`status_views`/`device_events`), rancangan rumus biaya per device, rencana 5 benchmark sintetis, daftar data invoice yang finance perlu pasok, estimasi ~7,5 hari-orang. Belum dieksekusi, hanya dokumen.
- **Migrasi harga** (`migrations/023_pricing_tiers.sql`, lihat juga `docs/PRICING_UPDATE_2026-09-27.md`): tiga tingkat di atas, plus `price_is_final=true` (awalnya Claude lupa set ini, jadi harga sempat tetap tersembunyi di balik "segera diumumkan" — sudah diperbaiki, lihat §5).
- **Perbaikan bug tak terduga yang ditemukan saat verifikasi lokal:**
  - Hydration mismatch di landing page (`Reveal`, `StaggerItem`, `ReadinessRing`, `PhotoBackdrop`, `ProductTour` di `dashboard/src/components/marketing/`) — bug lama, bukan dari pekerjaan sesi ini, baru kelihatan karena baru kali ini halaman dibuka via `next dev` langsung oleh manusia. Akar masalah: `useReducedMotion`/posisi scroll/`useInView` memang tidak bisa cocok antara render server dan browser tertentu (browser Dzaki memang menyalakan preferensi "kurangi animasi"). Diperbaiki dengan `suppressHydrationWarning` di lima titik yang tepat, bukan penyembunyian buta — alasannya didokumentasikan sebagai komentar di tiap titik.
  - Harness pengujian lokal (`scripts/operator-stack-harness.ts`, alat bantu Claude, bukan bagian aplikasi) lupa memasang `/public` routes, jadi bagian Harga di halaman depan sempat kosong (404 diam-diam) — sudah ditambahkan.

## 3. Status stack lokal (`:13200`, database `koneva-operator-local`)

Migrasi sampai `023` sudah diterapkan. Panel operator, MFA, peran Owner/Developer, verifikasi email, batas OTP, alert OTP, dan tiga paket harga baru semua bisa dilihat langsung di browser sekarang. `:13000` (stack pribadi, tersambung WhatsApp asli) **tidak disentuh sama sekali** sepanjang sesi ini.

## 4. Tes

Backend penuh dijalankan ulang setelah semua perubahan (`bash scripts/test-operator-local.sh --all`): 322/324 lulus, 2 di-skip (gated by env var, sama seperti sebelumnya, bukan baru). Tidak ada regresi tercatat.

## 5. Yang masih perlu ditinjau Anda/owner

- Limit device/anggota untuk paket Tim (5 device / 20.000 pesan / 10 anggota) adalah tebakan editorial Claude, bukan angka dari riset atau dari Dzaki — perlu dikonfirmasi atau diubah.
- Paket "Solo" belum benar-benar 1 kursi (limit anggotanya masih sama seperti UMKM lama, 3 anggota) — kalau dimaksudkan benar-benar solo, itu perubahan terpisah yang lebih besar (banyak tes yang sudah dibuat sepanjang sesi-sesi sebelumnya memakai plan ini untuk uji tim beranggota >1).
- Harga ini statusnya: **lokal saja, belum deploy ke production**, dan riset PM sendiri sudah bilang ini hipotesis, bukan harga final tervalidasi (lihat catatan margin negatif di `docs/research/2026-09-27-koneva/pricing.md`).
- Gmail OTP: baru satu kali uji berhasil terkirim (walau masuk folder spam) — belum ada volume, belum ada verifikasi domain/SPF/DKIM, refresh token OAuth masih berstatus Testing (kedaluwarsa ~7 hari, lihat `docs/OPERATOR_PANEL.md` bagian "Gmail sender for invitation OTP").

## 6. Dokumen terkait yang dibuat/diubah sesi ini (untuk dibaca lebih lanjut)

`docs/COST_METER_DISCOVERY.md`, `docs/PRICING_UPDATE_2026-09-27.md`, `migrations/023_pricing_tiers.sql`, `docs/OUTBOUND_CONTROLS.md`, `docs/CONSENT_OPTOUT_DESIGN.md`, `docs/ROLES.md`, `docs/OPERATOR_PANEL.md`, `docs/HANDOFF.md` (baris pembaruan di bagian atas).
