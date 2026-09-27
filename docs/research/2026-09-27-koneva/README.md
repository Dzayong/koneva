# Riset PM KONEVA: pasar, adopsi, regulasi, dan harga

Tanggal: 27 September 2026. Disusun melalui tiga agen riset paralel (pasar, produk/teknologi, regulasi), sintesis PM/finance, dan pemeriksaan hitungan terpisah. Sumber: situs vendor, dokumentasi upstream, pemerintah, BI, dan WhatsApp. Tidak ada pengujian layanan kompetitor atau audit kode KONEVA pada pekerjaan ini.

## Keputusan yang direkomendasikan

KONEVA memiliki hipotesis pasar sebagai gateway terkelola untuk developer dan UMKM Indonesia yang membutuhkan setup sederhana, diagnosis pengiriman, pengendalian akses, dan bantuan lokal. API dasar/QR/pemanasan bukan pembeda yang cukup; riset harga menunjukkan banyak alternatif murah atau gratis. Harga Solo Rp99.000 dan Tim Rp149.000 layak **diuji**, belum layak dianggap optimal/final. Pelajar Rp29.000 hanya sebagai program subsidi dengan batas anggaran.

Risiko platform mendasar tetap ada: WhatsApp Business App Terms efektif 23 September 2026 membatasi aplikasi yang berinteraksi tanpa izin tertulis. Kepatuhan Indonesia, lisensi MIT, opt-in dan pembatasan pengiriman tidak otomatis memberikan izin WhatsApp. Rekomendasi PM: selesaikan telaah model layanan sebelum penjualan umum dan rancang opsi kanal resmi untuk kebutuhan kontinuitas. Ini rekomendasi risiko, bukan kesimpulan bahwa seluruh pemakaian Baileys merupakan tindak pidana. [Ketentuan WhatsApp](https://www.whatsapp.com/legal/WhatsApp-Terms-for-WhatsApp-Business-App).

## Isi laporan

- [12 kompetitor dan batas pembandingannya](competitors.md): Indonesia, Malaysia/Asia, dan global; harga per nomor/user/API slot, annual vs monthly, Meta fees, konflik harga publik.
- [8 referensi adopsi dan kriteria penerimaan](product-references.md): developer experience, keandalan, penggunaan, privacy/abuse, dokumentasi dan arah arsitektur.
- [Regulasi, applicability dan checklist](regulations.md): PDP, PSE, PP TUNAS, konsumen/PMSE, retensi, kontrak platform, dan ketidakpastian hukum.
- [Model biaya dan harga](pricing.md): asumsi yang belum diukur, harga vendor, proyeksi 10/50/100 nomor, subsidi, sensitivitas dan kebutuhan data.
- [Asumsi model](assumptions.json), [skenario](scenarios.csv), [sensitivitas](sensitivity.csv): format yang dapat dibuka di spreadsheet. CSV adalah hasil perhitungan, bukan workbook formula otomatis.

## Temuan pasar yang mengubah asumsi lama

| Temuan terverifikasi dari penawaran publik | Implikasi PM |
| --- | --- |
| Fonnte Lite Rp25.000/1.000 teks, Regular Rp66.000/10.000 teks per device/30 hari. [Vendor](https://fonnte.com/) | Rp99.000 tidak boleh dipasarkan sebagai paling murah. |
| Wablas Nano Rp22.000/1.000 pesan; Lite Rp36.000 bulanan. [Storefront Solo](https://solo.wablas.com/pricing) | Harus ada alasan pelanggan membayar lebih dari API dasar. |
| Whacenter Business Rp600.000/tahun untuk 5 nomor; ekuivalen Rp10.000/nomor/bulan jika semua slot dipakai. [Vendor](https://whacenter.com/) | Ekuivalen bundle bukan tarif bulanan satu nomor; tetap menekan pasar volume. |
| WAHA menyatukan semua fitur Plus ke Core gratis sejak 2026.6.1. [Dokumentasi](https://waha.devlike.pro/docs/how-to/waha-plus/) | Nilai layanan terkelola harus melampaui menjalankan software gratis. |
| respond.io Growth US$159/bulan ekuivalen tagihan tahunan; biaya WhatsApp tidak termasuk. [Harga](https://respond.io/pricing) | Suite resmi mempunyai unit nilai/biaya berbeda; jangan dipakai membuat klaim diskon yang tidak setara. |

Whapi memiliki perbedaan angka/konteks antara halaman harga dan help desk; WATI tidak menampilkan nilai subscription yang berhasil dibaca dalam riset; Qontak memakai beberapa unit paket. Laporan rinci sengaja tidak menebak harga yang belum tegas.

## Referensi yang dipilih untuk diadopsi

1. **WAHA + Stripe:** kontrak event, retry, signature, idempotency dan replay yang aman; lakukan gap audit agar tidak membangun ulang kemampuan yang ada. [WAHA](https://waha.devlike.pro/docs/how-to/events/), [Stripe](https://docs.stripe.com/webhooks).
2. **Fonnte + Twilio sandbox:** panduan integrasi singkat, contoh kode, demo tanpa nomor nyata dan pesan kesalahan yang menjelaskan langkah pemulihan. [Fonnte](https://docs.fonnte.com/), [Twilio](https://www.twilio.com/docs/whatsapp/sandbox).
3. **WAHA observability:** ukur resource dan keadaan sesi untuk harga berbasis biaya, bukan menyalin angka kapasitas engine lain. [Referensi](https://waha.devlike.pro/docs/how-to/observability/).
4. **Evolution:** pemisahan provider resmi/tidak resmi sebagai rancangan masa depan. Telaah syarat lisensi tambahan sebelum menyalin/white-label. [Repositori](https://github.com/evolution-foundation/evolution-api).

Adopsi berarti mengambil pola produk/operasi yang relevan. Belum ada keputusan memasang software, membeli vendor, menyalin implementasi atau mengganti Baileys.

## Harga dan kelayakan usaha

Kandidat per bulan: Pelajar Rp29.000 (subsidi maksimal 10% device berbayar), Solo Rp99.000, Tim Rp149.000. Masing-masing satu device; jumlah anggota berbeda. Asumsi mix 10/60/30 menghasilkan rata-rata Rp107.000/device. Semua ini proposal, belum mengubah paket aplikasi.

| Device berbayar | Omzet | Kontribusi sesudah infra/support/cadangan | Setelah contoh overhead usaha Rp3 juta |
| ---: | ---: | ---: | ---: |
| 10 | Rp1.070.000 | Rp255.800 | -Rp2.744.200 |
| 50 | Rp5.350.000 | Rp2.079.000 | -Rp921.000 |
| 100 | Rp10.700.000 | Rp4.158.000 | Rp1.158.000 |

Ini simulasi sebelum pajak laba dan akuisisi, bukan proyeksi pasti atau laba bersih. Biaya infra Rp600 ribu/Rp2,2 juta/Rp4,4 juta; support+variabel Rp15 ribu/device; pembayaran 1% dan cadangan gangguan 5% omzet. Kapasitas server, bauran paket, dan waktu support belum diukur. Tim QA memeriksa aritmetika dan mengoreksi pembulatan harga minimum ke atas.

Pada 50 device, target margin layanan 40% perlu harga rata-rata setidaknya Rp109.260; 50% perlu Rp134.091. Jika support mencapai satu jam/device/bulan, kontribusi skenario dasar tinggal Rp79.000 sebelum overhead. Prioritas berikutnya adalah mengukur biaya dan membuktikan pelanggan bersedia membayar, bukan menerbitkan angka harga ini sebagai keputusan final.

## Pembagian kerja lintas divisi

Urutan ini usulan backlog, bukan pekerjaan yang telah ditugaskan ke Claude atau jadwal rilis yang dijanjikan.

| Urutan | Divisi | Tugas berikutnya | Bukti selesai |
| --- | --- | --- | --- |
| P0 | QA + full-stack | Review independen OTP/alert sesudah pekerjaan Claude selesai; telusuri alasan skip dan verifikasi proteksi email pada tes. | Laporan terpisah antara bukti kode, tes lokal dan yang belum diuji; tanpa Gmail/WA/produksi. |
| P0 | Backend + trust | Audit penghentian workspace, consent/opt-out pada API, antrean, scheduler, auto-reply; tentukan gap. | Semua jalur ditemukan dan dites dengan data sintetis, atau gap diberi tiket dan risiko. |
| P0 | Security + legal + owner | Telaah kontrak platform, applicability PSE, data map, usia pengguna, terms/privacy/refund, dan rencana insiden. | Keputusan tertulis dan dokumen sesuai model usaha; tidak menganggap disclaimer cukup. |
| P0 | Infra + finance | Ukur resource dan biaya; bedakan synthetic dari live pilot yang membutuhkan izin. | RAM/CPU/storage/traffic dan support per device; invoice serta headroom; model harga diperbarui. |
| P1 | UX + developer experience | Demo tanpa nomor, dokumentasi singkat, diagnosis webhook, kuota/retensi yang jelas. | Pengguna pilot dapat menyelesaikan skenario, waktu dan kebutuhan bantuan dicatat. |
| P1 | Growth + customer success | Wawancara 10 UMKM dan 5 developer/pelajar dewasa; pilih 3–5 pilot yang menyetujui lingkup dan risiko. | Catatan kebutuhan, alternatif yang dipakai, kemauan membayar dan alasan churn; belum ada outreach pada riset ini. |
| P2 | Architecture | Kontrak adapter kanal resmi, estimasi biaya dan batas kemampuan. | Desain tertulis; tanpa janji fallback otomatis, kesetaraan fitur, atau migrasi nomor tanpa syarat. |

## Brief pekerjaan berikutnya untuk Claude (setelah tugas aktif selesai)

> Kerjakan tahap penemuan dan rancangan cost-meter KONEVA. Mulai dari graph dan aturan coverage proyek, lalu identifikasi metrik yang sudah tersedia, data resource/queue/storage yang bisa dihitung tanpa isi pesan atau nomor pribadi, dan seluruh jalur outbound yang perlu menghormati suspend/opt-out. Laporkan gap, rancangan biaya per device, serta rencana benchmark sintetis. Jangan mengubah harga/paket, mengirim email/WhatsApp, membaca .env, menjalankan workload pada nomor asli, restart panel, migrasi database panel, menyentuh produksi, atau commit. Jangan mengklaim kapasitas live dari mock. Sertakan estimasi effort untuk implementasi terpisah dan daftar data invoice yang PM perlukan.

Riset ini menghasilkan dokumen baru saja. Tidak ada kode aplikasi diubah, layanan lokal di-restart, migrasi dijalankan, kontak vendor/pelanggan, pengiriman email/WhatsApp, commit atau deploy. Perubahan OTP/alert yang dilaporkan Claude belum diaudit dalam tugas riset ini.
