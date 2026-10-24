# Rencana Migrasi Top-up PAYG dari DOKU ke Duitku

**Status:** implementasi lokal dan tes sintetis tersedia; belum menjalankan migrasi database, belum menguji pembayaran sandbox sungguhan, dan belum deploy.
**Tanggal audit:** 23 Oktober 2026.

## Rekomendasi

Gunakan **Duitku POP / Create Invoice** untuk sandbox pertama. API ini membuat `paymentUrl` yang dapat dibuka pengguna, sesuai alur checkout KONEVA sekarang dan pola pada `alur-pembayaran.pdf`. Jangan pindah ke produksi sebelum checkout, callback, rekonsiliasi, dan kasus pembayaran ganda diuji di sandbox.

## Alur KONEVA saat ini

`POST /api/v1/billing/payg/topup-checkout` membuat baris top-up berstatus belum dibayar, lalu meminta URL checkout DOKU. Callback publik `/billing/doku/notify` memverifikasi signature dan timestamp, memproses event dalam transaksi database dengan idempotensi, memeriksa invoice dan jumlah, lalu memperbarui top-up dan mengkredit `wallet_ledger`. Perhitungan saldo dan pemotongan pesan berada di wallet/ledger; keduanya sebaiknya tetap menjadi sumber kebenaran selama penggantian gateway.

## Perbedaan protokol penting

| Bagian | DOKU yang dipakai KONEVA | Duitku POP yang direkomendasikan |
|---|---|---|
| Buat checkout | JSON ke `/checkout/v1/payment`; signature `Client-Id`, `Request-Id`, `Request-Timestamp`, `Signature` | JSON ke `https://api-sandbox.duitku.com/api/merchant/createInvoice`; header merchant code, timestamp milidetik, dan HMAC-SHA256 atas `merchantCode + timestamp` |
| Identitas transaksi | `invoice_number` KONEVA dikirim sebagai nomor invoice DOKU | `merchantOrderId` harus unik dari sisi KONEVA; respons `reference` Duitku juga perlu disimpan |
| URL bayar | `response.payment.url` | `paymentUrl` |
| Callback | JSON bertanda tangan dengan header DOKU | Form URL-encoded; verifikasi HMAC-SHA256 atas `merchantCode + amount + merchantOrderId`, hasil sukses `resultCode=00` |
| Pengakuan pembayaran | Periksa status dan nominal invoice dalam transaksi database | Terapkan kontrol yang sama: verifikasi signature, cocokkan merchant/order/nominal dengan record KONEVA, lalu kredit sekali dalam satu transaksi |
| Redirect browser | Hanya untuk pengalaman pengguna | `returnUrl` hanya untuk navigasi. Jangan menganggap parameter redirect sebagai bukti pembayaran; callback terverifikasi yang mengubah saldo |

Rincian tersebut mengikuti [dokumentasi resmi Duitku POP](https://docs.duitku.com/pop/en/), khususnya bagian Create Invoice, callback, dan redirect. Duitku menyatakan callback perlu direspons HTTP 200 dan akan mengirim ulang jika tidak menerima 200; dokumentasi menyebut maksimum lima percobaan dan menyediakan pengiriman ulang dari dashboard laporan.

## Implementasi yang disiapkan

1. Tambahkan konfigurasi sandbox server-side (`DUITKU_MERCHANT_CODE`, `DUITKU_API_KEY`, dan base URL tetap sandbox) tanpa menaruh secret di frontend, log, git, atau chat.
2. Simpan provider pada record top-up dan referensi Duitku secara eksplisit. Pastikan nomor order unik dan tidak dapat digunakan lintas workspace.
3. Ganti implementasi checkout di balik endpoint KONEVA yang sama agar UI tidak perlu mengetahui detail provider; simpan `paymentUrl` hanya setelah provider menerima permintaan.
4. Tambahkan callback Duitku terpisah. Validasi tipe konten/form, signature dengan perbandingan aman, merchant code, order yang dikenal, nominal IDR tepat, dan result code sebelum mengubah status.
5. Buat tabel event callback Duitku dengan kunci unik untuk deduplikasi. Perubahan status top-up dan entri kredit ledger harus atomik; callback gagal di tengah transaksi harus dapat dicoba ulang.
6. Tambahkan tes signature dengan fixture sintetis, callback sukses/gagal/nominal salah, replay, callback order yang tidak dikenal, transaksi rollback, dan top-up lama DOKU.
7. Uji sandbox dengan tunnel publik: buat checkout, bayar nominal uji, terima callback, pastikan saldo masuk sekali, lalu uji resend callback dan pemeriksaan status.
8. Siapkan rekonsiliasi untuk callback yang hilang menggunakan status transaksi Duitku. Sebelum membuka produksi, tentukan pemantauan, prosedur refund/komplain, dan rollback.

## Transisi yang disetujui

Top-up baru memakai Duitku POP sandbox. Pemilik menyetujui menutup top-up DOKU yang masih belum dibayar karena penggunaan masih terbatas pada pemilik dan teman; migrasi menandainya `void` dan mempertahankan baris untuk audit. Callback DOKU untuk invoice paket lama tetap terpisah, sedangkan callback DOKU tidak dapat mengkredit top-up PAYG baru.

## Keputusan pemilik yang sudah diterima

1. Duitku POP / Create Invoice untuk checkout redirect.
2. Top-up DOKU unpaid ditutup (`void`) pada migrasi sandbox; data historis tetap disimpan.
3. Credential Duitku sandbox dan URL tunnel harus diisi langsung di `.env.personal` yang privat. Tidak ada credential yang diterima di chat.
4. Produksi tetap memerlukan keputusan dan perubahan terpisah setelah pengujian sandbox selesai.

## Progres implementasi

- Konfigurasi Duitku terpisah dan endpoint sandbox tetap (tidak ada toggle produksi).
- Checkout PAYG memakai endpoint KONEVA yang sama; callback diverifikasi dan dikreditkan atomik/idempoten.
- Migrasi `066_duitku_payg_topups.sql` menutup DOKU pending dan menambahkan provider/reference serta log callback.
- Tes sintetis lewat `scripts/test-duitku-sandbox.sh` sudah lulus untuk alur checkout/callback dan kasus signature, nominal, replay, order tidak dikenal/void, serta transisi top-up pending DOKU.
- Belum diverifikasi dengan credential Duitku sandbox milik pemilik, callback tunnel aktif, atau pembayaran nyata. Migrasi dan deploy juga belum dijalankan.

## Bukan bagian dari migrasi gateway ini

Nominal minimum/maksimum top-up, harga per pesan, diskon bertingkat, voucher, dan aturan kredit mahasiswa tetap mengikuti keputusan produk tersendiri. Migrasi gateway tidak mengubah tarif atau nilai saldo yang diterima.

## Referensi

- `PANDUAN-PELANGGAN.pdf` dan `alur-pembayaran.pdf` — contoh sistem NES; bukan spesifikasi KONEVA.
- [Duitku POP API Reference](https://docs.duitku.com/pop/en/) — dokumentasi resmi, diperiksa 23 Oktober 2026.
- `docs/DOKU_INTEGRATION_SPEC.md` — rincian implementasi DOKU KONEVA yang akan dipertahankan untuk penyelesaian top-up lama.
