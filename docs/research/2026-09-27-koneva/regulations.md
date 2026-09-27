# KONEVA — riset regulasi dan risiko platform

Tanggal pemeriksaan: 27 September 2026. Lingkup: SaaS API/dashboard berbasis Baileys, pelanggan menghubungkan nomornya sendiri, pasar awal Indonesia. Ini riset PM dari sumber primer, bukan pendapat hukum atau audit kepatuhan implementasi. Tidak memeriksa kode, status izin perusahaan, produksi, atau data pelanggan.

**Keputusan PM yang saya sarankan:** jadikan penilaian risiko kontrak WhatsApp, PSE, dan perlindungan data sebagai gerbang sebelum menjual layanan umum. Bangun opsi transport resmi untuk pelanggan yang memerlukan kontinuitas. Anti-spam mengurangi penyalahgunaan; ia tidak menghapus persoalan izin integrasi.

## Fakta hukum dan kontrak yang memengaruhi produk

### 1. Kontrak platform — risiko paling mendasar

Ketentuan WhatsApp Business App yang berlaku **23 September 2026**, bagian 5(g), melarang aplikasi berinteraksi dengan layanan tanpa persetujuan tertulis sebelumnya; 5(h) membatasi API yang ditawarkan tanpa izin; bagian 6 memungkinkan pembatasan, penangguhan, atau penghentian akun. Penggunaan merek juga dibatasi. **Implikasi/inferensi untuk KONEVA:** integrasi Baileys tanpa izin tertulis memiliki risiko kontraktual yang kuat; jangan menjanjikan anti-ban atau afiliasi resmi. Pendaftaran PSE tidak memberikan izin WhatsApp, dan pelanggaran kontrak platform tidak otomatis sama dengan tindak pidana Indonesia. [Ketentuan WhatsApp Business App terbaru](https://www.whatsapp.com/legal/WhatsApp-Terms-for-WhatsApp-Business-App).

Untuk nomor WhatsApp personal, ketentuan umum juga membatasi akses otomatis/tidak berizin dan komunikasi impermissible. [WhatsApp Terms of Service](https://www.whatsapp.com/legal/terms-of-service).

Kebijakan bisnis saat ini meminta nomor/username diberikan oleh penerima, izin menerima komunikasi berikutnya, serta penghormatan opt-out. Jangan bergantung pada halaman `/preview` terjemahan yang dapat tertinggal; halaman aktif menyebut opt-in umum dan tidak sama dengan klaim bahwa izin spesifik WhatsApp selalu diwajibkan. Saran produk: simpan bukti sumber/tanggal/tujuan persetujuan, kategori pesan, dan suppression list yang dicek pada pengiriman langsung maupun antrean. [Business Messaging Policy aktif](https://whatsappbusiness.com/policy/).

### 2. UU PDP

[UU 27/2022](https://peraturan.bpk.go.id/Home/Download/224884/UU%20Nomor%2027%20Tahun%202022.pdf) mengatur dasar pemrosesan (Pasal 20), persetujuan orang tua/wali untuk data anak (25), pencatatan pemrosesan (31), penilaian dampak risiko tinggi (34), penghapusan/pemusnahan (43–45), dan pemberitahuan kegagalan pelindungan tertulis paling lambat **3×24 jam kepada subjek dan lembaga**, dengan informasi data terdampak, kejadian, dan pemulihan (46). Prosesor bekerja atas instruksi; subprosesor memerlukan persetujuan tertulis pengendali (51). Transfer internasional mengikuti urutan perlindungan setara/lebih tinggi, perlindungan memadai mengikat, lalu persetujuan bila keduanya tidak terpenuhi (56).

Inferensi peran KONEVA: pengendali untuk akun, billing, keamanan; biasanya prosesor untuk pesan/kontak yang diproses atas instruksi pelanggan. Penetapan akhir tergantung tujuan dan kontrak nyata. Tindakan: inventaris data, privacy notice, perjanjian pemrosesan, daftar vendor/lokasi, runbook insiden, permintaan hak data, dan jadwal retensi per kategori. Hash atau ID yang dapat dikaitkan ke orang tidak otomatis anonim.

**Perubahan yang mudah terlewat:** MK memutus kriteria DPO Pasal 53(1) dibaca **dan/atau**, bukan harus seluruhnya terpenuhi. Salah satu kriteria dapat cukup: pelayanan publik; pemantauan teratur sistematis skala besar; atau pemrosesan skala besar data spesifik/pidana. Jangan menyimpulkan startup kecil otomatis wajib/tidak wajib. Catat asesmen skala, kategori dan tujuan; tunjuk PIC privasi sejak pilot. [Putusan 151/PUU-XXII/2024, ringkasan resmi MK](https://www.mkri.id/berita/mk-data-pribadi-warga-wajib-dilindungi-negara-secara-maksimal-23553).

Status aturan pelaksana: sumber Komdigi **21 Juli 2026** masih menyebut otoritas PDP sedang disiapkan; **20 Agustus 2026** masih menyebut pengembangan peraturan pelaksana. Saya tidak menemukan bukti primer lebih baru yang memastikan seluruh perangkat sudah operasional. Jangan menyatakan UU belum berlaku atau kewajiban boleh ditunda; verifikasi kanal notifikasi insiden terbaru bersama penasihat hukum. [Komdigi Juli](https://portal.komdigi.go.id/kanal-publik/berita-kini/10412), [Komdigi Agustus](https://portal.komdigi.go.id/kanal-publik/berita-kini/10492).

### 3. PSE privat dan lokasi hosting

Layanan yang menawarkan jasa, komunikasi, atau pemrosesan data operasional publik termasuk kriteria pendaftaran PSE privat. Dari deskripsi produk, KONEVA **sangat mungkin masuk**; lengkapi identitas badan/usaha, OSS/NIB dan klasifikasi kegiatan yang tepat, lalu daftar sebelum dipakai publik dan perbarui informasi. Dasar aturan PP71/2019 dan Permenkominfo5/2020 sebagaimana diubah 10/2021. Ini penilaian applicability; status registrasi KONEVA belum diperiksa. [Kriteria resmi](https://pse.komdigi.go.id/panduan/kriteria-pendaftaran-pse-lingkup-privat), [penjelasan perubahan 10/2021](https://www.komdigi.go.id/berita/siaran-pers/detail/siaran-pers-no-182-hm-kominfo-05-2021-tentang-lindungi-warga-di-ruang-digital-kominfo-terapkan-tiga-kebijakan).

PP71 Pasal21 mengizinkan PSE privat menyimpan/memproses di Indonesia **dan/atau luar Indonesia**, dengan syarat pengawasan dan penegakan hukum; sektor tertentu bisa punya aturan tambahan. Jadi tidak tepat mengklaim semua SaaS wajib server Indonesia. Untuk biaya hosting luar negeri, tetap hitung pekerjaan transfer data dan vendor assessment. [PP71 naskah resmi](https://peraturan.bpk.go.id/Download/112816/PP%20Nomor%2071%20Tahun%202019.pdf).

### 4. Target Pelajar: keputusan segmentasi perlu eksplisit

PP TUNAS17/2025 mencakup layanan yang dirancang atau mungkin diakses anak; indikatornya termasuk pemasaran dan komposisi pengguna. Ia mengatur penilaian risiko, persetujuan orang tua/wali, privasi tinggi secara baku, dan pelindungan anak. **Pelajar tidak identik dewasa.** Rekomendasi pilot: UMKM dan mahasiswa/developer dewasa 18+; sebelum memperluas ke sekolah, lakukan asesmen usia, kontrak dan pemrosesan data anak. Batas 18+ adalah usulan segmentasi produk, bukan penetapan umum kecakapan kontraktual; checkbox usia juga tidak otomatis membebaskan dari PP TUNAS. [PP17/2025](https://www.peraturan.go.id/files/pp-no-17-tahun-2025.pdf).

Permenkomdigi9/2026 sudah terbit. Pemerintah memulai pembatasan akun anak di bawah16 pada **platform berisiko tinggi** secara bertahap 28 Maret2026. Jangan menggeneralisasi semua SaaS dilarang bagi usia di bawah16 atau menganggap KONEVA otomatis berkategori tinggi/rendah. [Katalog peraturan pelaksana](https://jdih.komdigi.go.id/produk_hukum/katalog/1007), [pengumuman implementasi](https://eppid.komdigi.go.id/berita/detail/pernyataan-menteri-komunikasi-dan-digital-tentang-penerbitan-permen-turunan-pp-tunas).

### 5. Penjualan SaaS, kontrak, refund dan retensi

UU8/1999 mengatur informasi yang benar dan larangan klausula baku pengalihan tanggung jawab/penolakan pengembalian uang. Jangan menggunakan “seluruh risiko pelanggan, tidak ada refund dalam keadaan apa pun”. Klaim uptime, kuota, dukungan, otomatisasi, dan afiliasi harus sesuai layanan nyata. Applicability definisi konsumen untuk pembeli bisnis tertentu perlu ditelaah; bukan alasan menghilangkan mekanisme keluhan. [UU Perlindungan Konsumen](https://peraturan.bpk.go.id/Download/33784/UU%20Nomor%208%20Tahun%201999.pdf).

PP80/2019 meminta mekanisme pengaduan dan kontrak elektronik berisi identitas, layanan, harga, pembayaran, pembatalan/pengembalian; kontrak untuk konsumen Indonesia menggunakan Bahasa Indonesia dan dapat disimpan. **Pasal25 mewajibkan PPMSE** menyimpan informasi PMSE finansial minimal10 tahun dan nonfinansial5 tahun. Penetapan KONEVA sebagai pedagang/PPMSE/penyelenggara perantara harus dikaji berdasarkan model riil. Jangan memperluas ini menjadi “semua chat/OTP harus disimpan5 tahun”. Pisahkan bukti transaksi langganan dan kontrak dari rahasia autentikasi sementara; harmonisasikan dengan hak hapus dan kewajiban akuntansi. [PP80/2019 naskah resmi](https://peraturan.bpk.go.id/Download/117172/PP%20Nomor%2080%20Tahun%202019.pdf).

## Checklist yang bisa dijadikan tiket

Semua berikut rekomendasi operasional PM, belum menyatakan telah diimplementasikan.

| Prioritas | Penanggung jawab | Deliverable / kriteria selesai |
|---|---|---|
| P0 sebelum jual umum | Owner + legal | Keputusan tertulis risiko Baileys; evaluasi jalur resmi; copy tidak menjanjikan anti-ban/afiliasi |
| P0 | Legal + operasional | Applicability PSE, OSS/NIB dan klasifikasi usaha; bukti registrasi jika wajib |
| P0 | Legal + PM | Terms, privacy notice, perjanjian pemrosesan, daftar vendor/lokasi, refund/cancel/keluhan dalam Bahasa Indonesia |
| P0 | Security + backend | Inventaris pesan/kontak/session/API key/log/billing; masking; akses minimum; revoke session; uji restore |
| P0 | PM + trust/safety | Larangan spam/scraping daftar kontak, bukti consent, opt-out/suppression, pelaporan abuse dan penangguhan dengan alasan |
| P0 | Security + legal | PIC insiden, template notifikasi, latihan timeline3×24; kontrak vendor memberi waktu eskalasi internal lebih singkat |
| P0 | PM + growth | Tegaskan segmen usia pilot; hentikan asumsi kartu pelajar membuktikan kapasitas hukum/persetujuan wali |
| P1 sebelum skala | Privacy + data | Retensi per kelas, penghapusan akun dan backup terjadwal, legal hold, ekspor data, bukti penghapusan |
| P1 | PM + engineering | Adapter transport resmi dan simulasi gangguan/ban; SLA hanya lingkup yang dikuasai KONEVA |
| P1 | Finance + legal | Dana cadangan refund/incident dan biaya compliance masuk unit economics; tidak membebankan biaya risiko secara tersembunyi |

## Pertanyaan terbuka yang harus diputuskan

1. Badan/usaha penjual, domisili, NIB/KBLI dan PSE aktual belum diketahui.
2. Apakah ada persetujuan tertulis WhatsApp untuk integrasi? Belum ada bukti dalam lingkup riset.
3. Di mana host utama, backup, email, monitoring, support dan log menyimpan data; siapa saja mendapat akses?
4. Berapa usia minimum, bukti usia yang proporsional, dan apakah pemasaran menarik pengguna anak?
5. Definisi skala besar/DPO dan pemrosesan berisiko tinggi perlu dinilai dari volume dan tujuan aktual.
6. Pemetaan retensi PMSE/PDP/pajak perlu legal review per tabel, terutama kontrak, billing, audit dan OTP; jangan menjalankan mass-delete dari rekomendasi umum ini.
7. Periksa ulang regulasi pelaksana PDP, kanal regulator dan versi kontrak WhatsApp sebelum tanggal peluncuran. Aturan terbaru tidak boleh disimpulkan hanya dari status crawl mesin pencari.

Tidak ada akses produksi, pengiriman pesan/email, pembacaan `.env`, migrasi atau perubahan kode pada pekerjaan ini.
