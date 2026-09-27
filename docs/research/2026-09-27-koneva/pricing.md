# KONEVA: model biaya dan usulan harga

Tanggal riset: 27 September 2026. Status: hipotesis PM untuk validasi, bukan harga final, penawaran vendor, hasil benchmark, atau keputusan mengganti paket di aplikasi. Biaya aktual pemilik belum diberikan. Semua angka IDR/bulan kecuali disebut lain.

## Dasar harga dari sumber primer

| Masukan eksternal | Angka yang ditemukan | Penggunaan dalam model |
| --- | --- | --- |
| Biznet GIO NEO Lite | MM 8.4: 8 GB, 4 vCPU, harga tampil Rp269.000 dengan pembanding Rp399.000; LL 16.8: 16 GB, 8 vCPU, Rp459.000 dengan pembanding Rp839.000. Snapshot Rp1.500/GB/bulan. | Gunakan angka pembanding yang lebih tinggi untuk anggaran konservatif, bukan menganggapnya harga perpanjangan yang sudah dikonfirmasi. [Daftar harga](https://www.biznetgio.com/pricelist). |
| DigitalOcean Basic regular | 8 GiB/4 vCPU US$48/bulan; 16 GiB/8 vCPU US$96/bulan. | Pembanding biaya, bukan rekomendasi kapasitas. [Harga](https://www.digitalocean.com/pricing/droplets). |
| Hetzner | Penyesuaian sejak 15 Juni 2026; CPX22 Singapura US$30,99/bulan, CPX32 US$57,99; belum VAT/IPv4. | Angka lama di memori bukan dasar pembelian baru. [Penyesuaian resmi](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/). |
| Kurs BI | JISDOR 25 September 2026: Rp17.917/USD. | Pembanding saja: US$48 sekitar Rp860.016, belum selisih kurs kartu/pajak. [BI](https://www.bi.go.id/id/statistik/informasi-kurs/jisdor/Default.aspx). |
| Midtrans | QRIS reguler tampil 0,7%; VA Rp4.000/transaksi; pajak atas biaya perlu dihitung. Produk digital dapat memiliki ketentuan berbeda. | Model memakai cadangan biaya pembayaran 1% sebagai asumsi, bukan tarif kontrak KONEVA. [Harga](https://midtrans.com/pricing). |
| Perubahan QRIS | BI mengumumkan MDR 0% mulai 1 Oktober 2026 untuk seluruh kategori merchant sampai Rp100.000; UMI sampai Rp500.000 tetap 0%. | Belum berlaku pada tanggal riset. Pastikan klasifikasi merchant, implementasi provider, biaya jasa tambahan, dan pajak. Jangan menganggap seluruh biaya gateway menjadi nol. [BI, 17 Agustus 2026](https://www.bi.go.id/id/publikasi/ruang-media/news-release/Pages/sp_2815926.aspx). |

Tidak perlu pindah server sebelum ada invoice dan benchmark aktual. Harga murah luar negeri juga memerlukan evaluasi lokasi data, dukungan, latensi, backup, dan transfer data lintas negara.

## Asumsi kapasitas dan biaya

Satu nomor berbayar = satu device aktif yang dialokasikan biaya bulanan. Model awal memakai satu device per workspace; multi-device dan workspace trial perlu model tersendiri. Nomor trial tidak boleh diasumsikan gratis bagi operator.

| Nomor berbayar | Anggaran komputasi ilustratif | Buffer infrastruktur | Total F |
| ---: | --- | ---: | ---: |
| 10 | 1 x 8 GB pada Rp399.000 | Rp201.000 | Rp600.000 |
| 50 | 2 x 16 GB pada Rp839.000 | Rp522.000 | Rp2.200.000 |
| 100 | 4 x 16 GB pada Rp839.000 | Rp1.044.000 | Rp4.400.000 |

Buffer mencakup perkiraan backup di luar server, domain yang dialokasikan bulanan, monitoring, dan ruang biaya pajak/kenaikan harga. Ini amplop anggaran, bukan rincian tagihan terverifikasi. Infrastruktur banyak server juga tidak otomatis HA: database, session, antrean dan failover perlu rancangan serta uji tersendiri.

**Kapasitas tersebut belum terbukti.** Untuk sanity check RAM saja, asumsi 0,3 GB/device dan cadangan shared service 2/4/6 GB menghasilkan penggunaan 5/19/36 GB pada total 8/32/64 GB. Angka 0,3 GB bukan pengukuran Baileys KONEVA. CPU, reconnect serentak, media, pertumbuhan DB, I/O dan batas disk 60 GB/server dapat lebih dahulu menjadi hambatan. Target ruang kosong minimal 30% adalah usulan engineering, bukan jaminan kapasitas.

Asumsi biaya lain:

- Dukungan langsung 12 menit/device/bulan x Rp50.000/jam = Rp10.000/device. Waktu pemilik tetap bernilai biaya.
- Biaya variabel tambahan Rp5.000/device/bulan untuk pertumbuhan storage/log/traffic di luar alokasi tetap; cocokkan dengan invoice agar tidak menghitung biaya dua kali.
- Cadangan pembayaran 1% omzet dan gangguan/kredit layanan 5% omzet. Cadangan gangguan bukan estimasi probabilitas ban dan bukan dana yang pasti cukup untuk gangguan platform menyeluruh.
- Overhead usaha tambahan Rp3.000.000/bulan sebagai contoh alokasi kerja engineering/administrasi, **di luar** menit support di atas. Ini bukan gaji tim penuh dan bukan fakta biaya perusahaan.
- Belum termasuk biaya akuisisi pelanggan, pengembangan historis, pajak atas laba, tambahan support onboarding, LLM, proxy khusus, dan biaya Meta pada produk resmi. Harga model adalah pendapatan layanan sebelum PPN keluaran bila berlaku; harga publik harus menjelaskan total yang dibayar.

## Rumus yang bisa diperiksa

```text
N = device berbayar
P = pendapatan rata-rata per device per bulan
F = biaya infrastruktur tetap untuk skenario tersebut
V = biaya support + variabel per device = Rp15.000
f = cadangan pembayaran = 0,01
r = cadangan gangguan/kredit = 0,05
O = overhead usaha = Rp3.000.000

Kontribusi setelah infrastruktur = N * P * (1 - f - r) - F - N * V
Surplus sebelum pajak dan akuisisi = kontribusi - O
Biaya layanan/unit sebelum cadangan berbasis omzet = F / N + V
P untuk target margin layanan m = (F / N + V) / (1 - f - r - m)
```

Margin di sini sesudah infrastruktur dan cadangan, tetapi sebelum overhead usaha. Jangan menyebutnya laba bersih atau membandingkannya langsung dengan gross margin akuntansi perusahaan lain.

## Kandidat paket untuk uji pasar

| Paket | Harga kandidat/bulan | Cakupan awal yang diusulkan | Syarat kelayakan |
| --- | ---: | --- | --- |
| Pelajar | Rp29.000 | 1 device, 1 anggota, pembelajaran API, kuota kecil yang ditentukan setelah ukur biaya | Program subsidi terbatas; maksimal 10% device berbayar pada model; verifikasi status dan penanganan pengguna di bawah 18 tahun perlu desain hukum/produk. |
| Solo | Rp99.000 | 1 device, 1 anggota, API dan webhook, dashboard diagnosis pengiriman, support jam kerja | Nilai layanan harus terbukti lebih berguna daripada gateway murah. Tidak menjual klaim bebas blokir. |
| Tim | Rp149.000 | 1 device, usulan 3 anggota (Owner + Developer), kontrol akses/audit dan bantuan integrasi lebih baik | Jangan mengartikan harga lebih tinggi sebagai izin kirim lebih agresif; biaya dukungan paket ini harus diukur terpisah. |

Semua paket tetap mendapat keamanan dasar, pembatasan penyalahgunaan, kontrol opt-out dan informasi risiko. Nomor tambahan dihitung terpisah setelah biaya diketahui; tidak otomatis termasuk tiga nomor dalam paket tiga anggota. Fitur yang belum dibuktikan di WhatsApp tidak dijanjikan sebagai fitur siap pakai.

Kuota komersial harus mengikuti implementasi dan bukti kapasitas. Jangan meniru angka 10.000/unlimited pesaing jika batas operasional KONEVA lebih rendah. Batas komersial, pembatasan penggunaan, dan keberhasilan pengiriman adalah hal berbeda; paket tidak menjamin seluruh kuota terkirim. Sandbox simulasi dapat gratis; trial device nyata perlu durasi dan anggaran biaya.

Rp29.000 bukan harga sehat mandiri untuk satu container pada asumsi ini. Pada 50 device, alokasi biaya Rp59.000; pendapatan sesudah cadangan Rp27.260, sehingga subsidi sekitar Rp31.740/pelajar/bulan. Lima slot sekitar Rp158.700/bulan. Manfaat akuisisi/pendidikan harus diukur dan anggarannya eksplisit. Jangan gunakan harga Pelajar sebagai harga umum.

Tidak merekomendasikan paket tahunan saat beta. Diskon tahunan kelak maksimal berdasarkan margin nyata, disertai aturan berhenti/refund yang adil dan cadangan kewajiban layanan. Paket managed/custom memerlukan penawaran berbasis jam kerja; jangan menyertakan integrasi tanpa batas dalam Rp99.000.

## Skenario campuran paket

Komposisi asumsi: 10% Pelajar, 60% Solo, 30% Tim. Pendapatan rata-rata = 0,1 x 29.000 + 0,6 x 99.000 + 0,3 x 149.000 = **Rp107.000/device/bulan**. Komposisi ini bukan proyeksi penjualan.

| Device berbayar | Omzet | Infrastruktur | Support + variabel | Cadangan bayar + gangguan | Kontribusi | Sesudah overhead Rp3 juta |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | Rp1.070.000 | Rp600.000 | Rp150.000 | Rp64.200 | Rp255.800 | **-Rp2.744.200** |
| 50 | Rp5.350.000 | Rp2.200.000 | Rp750.000 | Rp321.000 | Rp2.079.000 | **-Rp921.000** |
| 100 | Rp10.700.000 | Rp4.400.000 | Rp1.500.000 | Rp642.000 | Rp4.158.000 | **Rp1.158.000** |

Pada 50/100 device, biaya layanan sebelum cadangan = Rp59.000/unit. Harga rata-rata untuk margin layanan 40% sekitar **Rp109.260**; untuk 50% sekitar **Rp134.091**. Campuran Rp107.000 menghasilkan margin 38,86%, sehingga belum memenuhi target 40% secara ketat. Pada tahap 10 device margin hanya 23,91%; pilot memang perlu anggaran pembelajaran.

Implikasi: Rp99.000 cukup masuk akal sebagai **harga uji** Solo, bukan kesimpulan harga optimal atau usaha sudah menguntungkan. Pertahankan opsi menguji Solo Rp129.000 apabila biaya atau waktu dukungan lebih tinggi; pelanggan harus melihat manfaat yang mendukung selisih harga.

Estimasi impas overhead sekitar 73 device hanya jika biaya infrastruktur tetap proporsional Rp44.000/device dan mix tidak berubah: 3.000.000 / (107.000 x 0,94 - 59.000). Bukan titik impas pasti; pembelian server bertahap, trial, churn, pajak dan akuisisi dapat menaikkannya. Pada skenario 100 device, tambahan biaya Rp11.580/device sudah menghabiskan surplus sebelum pajak.

## Sensitivitas yang memengaruhi keputusan

Pada 50 device dan harga rata-rata Rp107.000:

| Perubahan | Kontribusi sebelum overhead |
| --- | ---: |
| Dasar: support 12 menit, infra Rp2,2 juta | Rp2.079.000 |
| Support 30 menit/device/bulan | Rp1.329.000 |
| Support 60 menit/device/bulan | Rp79.000 |
| Infrastruktur 1,5 kali, support 12 menit | Rp979.000 |
| Infrastruktur 2 kali, support 12 menit | **-Rp121.000** |

Kemudahan onboarding dan diagnosis masalah langsung memengaruhi margin. Layanan tidak layak jika kebutuhan support satu jam/device dijual seolah-olah biaya dukungannya nol. CSV lengkap mencakup kombinasi tambahan.

## Pembayaran

Pembayaran manual tahap awal tetap pilihan masuk akal, dengan waktu rekonsiliasi dihitung dalam support/administrasi. Pada Rp29.000, biaya VA Rp4.000 sendiri sekitar 13,8%; pada Rp99.000 sekitar 4,0%, sebelum pajak biaya. Angka tersebut tidak cocok dengan asumsi pembayaran 1% jika sebagian besar pelanggan memakai VA. Ubah model sesuai bauran kanal pembayaran yang benar; pertimbangkan QRIS bila cocok dan disetujui penyedia. Jangan melakukan pemecahan transaksi untuk mengejar ambang MDR.

Tidak mengasumsikan pengiriman Gmail gratis selamanya atau sudah terbukti. Anggaran/provider email autentikasi perlu diverifikasi terpisah. OTP email akun, pesan OTP pelanggan lewat WhatsApp, dan API resmi Meta adalah tiga komponen yang berbeda.

## Data yang harus dikumpulkan sebelum harga final

1. Invoice server/domain/backup/email, lokasi data, pajak dan masa promo/perpanjangan.
2. RAM/CPU p50/p95 per device idle/aktif, reconnect serentak, media, database growth, bandwidth, dan headroom; metrik agregat tanpa isi pesan/nomor pribadi.
3. Menit support, onboarding dan rekonsiliasi pembayaran per paket; jumlah trial dan device idle yang tetap menghabiskan resource.
4. Pengiriman berhasil/gagal dan kredit layanan; bedakan gangguan aplikasi, koneksi, dan pembatasan platform.
5. Wawancara serta pilot berbayar: apa alasan pelanggan memilih KONEVA ketimbang Rp22–66 ribu atau self-host gratis; uji harga Rp99 ribu dan Rp129 ribu dengan penawaran serta manfaat yang jelas.
6. Biaya akuisisi, aktivasi, konversi trial, retensi 30/60 hari dan churn; jangan menyimpulkan LTV dari beberapa pengguna pertama.

Lampiran mesin: `assumptions.json`, `scenarios.csv`, `sensitivity.csv`. Rumus di atas menghasilkan tabel; angka dapat diganti dengan hasil aktual. Tidak ada perubahan harga aplikasi, provisioning server, pembelian, email atau deployment yang dilakukan dalam riset ini.
