# Panel Pemilik — Tahap 1: insights read-only

Panel Pemilik adalah section pada Panel Operator yang sama. API mengharuskan izin `owner:insights`; migration 029 menambah izin itu ke allowlist database dan memberikannya hanya ke akun pemilik KONEVA yang telah diprovisikan (`koneva.id26@gmail.com`). Operator staf tetap memiliki izin operasional yang diberikan saat provisioning. Tidak ada kontrol suspend atau mutasi bisnis pada tahap ini. Tahap 2 memerlukan izin terpisah `owner:actions` dan keputusan owner baru.

Setiap pemuatan `GET /operator/insights` menulis satu event `owner.insights.view` ke `operator_audit` sebelum membaca snapshot. Endpoint hanya mengembalikan angka agregat dan field aktivitas yang sudah diizinkan; isi pesan, nomor penerima, API key, dan rahasia webhook tidak dikirim ke browser.

## Sumber yang sudah tersedia

| Tampilan | Sumber |
|---|---|
| Akun terdaftar | `users` |
| Workspace aktif/suspend saat ini | `tenants.status` |
| Pesan terkirim 24 jam/30 hari | `messages.status` + `sent_at` |
| Antrean queued/sending dan rasio gagal kirim | `messages.status` + `created_at` |
| Email OTP hari ini | `otp_rate_events`, dimensi `sender`, awal hari Asia/Jakarta |
| Sisa batas OTP | batas harian internal `OTP_SENDER_DAILY_CAP` dikurangi hitungan sender hari ini |
| Device WhatsApp | `devices.status` + `updated_at`; ini status tersimpan, bukan ping langsung ke container |
| Signup | `users.created_at` |
| Pembayaran diterima | `invoices.paid_at` |
| Permintaan STOP | `recipient_consent_events` |
| Pengiriman pesan gagal dan webhook HTTP 5xx | `messages` dan `webhook_logs` |
| Kegagalan verifikasi MFA Operator | `operator_security_events` |
| Ambang pengiriman OTP | `otp_threshold_events` |

## Batas pengamatan

Tabel yang ada belum menyimpan kegagalan login pelanggan sebagai event terstruktur, riwayat perubahan suspend workspace, error proses API/container, atau penolakan consent yang terjadi sebelum pesan masuk antrean. Karena itu halaman menjelaskan gap ini dan tidak mengarang event. Kegagalan MFA Operator yang terlihat bukan kegagalan login pelanggan. Angka pesan diblokir hanya mencakup baris pesan yang memang disimpan.

Angka sisa batas OTP mengukur batas internal KONEVA, bukan sisa kuota Google Gmail. Tidak ada API Gmail untuk membaca kuota Google pada tahap ini. Status device juga bisa tertinggal dari keadaan container sebenarnya.

## Estimasi

- Tahap 1 memakai tabel yang tersedia: sekitar **4–6 hari kerja** termasuk izin/audit, API agregat, section dashboard dan tes integrasi. Implementasi saat ini menyajikan data yang ada dan menandai batas di atas.
- Melengkapi feed dengan event persisten yang belum tersedia: tambahan sekitar **3–5 hari kerja**, bergantung sumber error API/container yang dipilih dan keputusan retensi.
- Tahap 2 untuk suspend workspace: sekitar **2–3 hari kerja** untuk izin `owner:actions`, dialog konfirmasi, endpoint transaksional, audit, reauth, tes dampak ke device/pesan/langganan, dan prosedur pemulihan. Belum diimplementasikan atau diaktifkan.
