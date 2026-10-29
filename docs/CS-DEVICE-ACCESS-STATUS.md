# Checkpoint akses device CS — 29 Oktober 2026

## Selesai di kode
- Owner memilih device ketika mengundang CS dan mengubah pilihan anggota CS.
- Pilihan kosong berarti CS tidak memperoleh akses device.
- Undangan meneruskan pilihan device ke membership ketika diterima.
- Daftar inbox difilter berdasarkan izin; akses langsung pesan, balasan, unggahan, dan media diperiksa di backend.
- Pemeriksaan izin membaca membership kembali agar pencabutan akses berlaku pada request berikutnya.
- Migrasi tambahan: `migrations/073_cs_device_grants.sql`. CS lama mulai tanpa device terpilih.

## Validasi
- Backend `npm run build`: lulus.
- Dashboard `npx tsc --noEmit`: lulus.
- Tes cs-device-access, team, permissions: 34 lulus; database dimock, bukan pengujian integrasi database nyata.
- HTTPS lokal port 13000 merespons HTTP 200 saat diperiksa.
- Graph lama; verifikasi perubahan menggunakan source langsung dan compiler/tests.

## Belum dilakukan
- Menerapkan migrasi 073 pada database runtime.
- Deploy perubahan backend dan dashboard.
- Uji manual dengan akun Owner dan CS: undang, terima, pilih device, balas, lalu cabut akses.
- Commit/push tidak dilakukan pada pekerjaan ini.

## Batas operasi
Tunnel, WSL, konfigurasi privat, dan sesi WhatsApp tidak dihentikan atau diubah. Status domain tunnel publik belum diverifikasi pada checkpoint ini. Jangan ulang audit seluruh repository; lanjutkan dari migrasi/deploy dan pengujian flow di atas.
