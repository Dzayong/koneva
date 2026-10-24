# Catatan Arahan Produk — Pembahasan Pak Angga

**Tanggal pencatatan:** 23 Oktober 2026

**Status:** Inbox dan tiga mode auto-reply tersedia dan sudah dideploy ke local production `:13000`. Pesan grup nyata sudah tercatat dan sebagian auto-reply berhasil; satu percobaan AI masih gagal HTTP 503. Voucher kredit sudah tersedia; tarif bertingkat dan beberapa materi publik masih menunggu detail produk.

**Audit lanjutan (24 Oktober 2026):** Stack lokal dan tiga bot berstatus sehat. Log 24 jam terakhir mencatat 39 pesan grup masuk dan 8 percobaan auto-reply: 4 terkirim, 3 tertahan oleh batas harian, dan 1 gagal karena provider AI membalas HTTP 503. Jadi jalur pesan grup dan auto-reply sudah menerima lalu memproses pesan nyata; satu masalah provider AI masih terbuka. Checkout Duitku belum bisa diuji karena `DUITKU_MERCHANT_CODE` dan `DUITKU_API_KEY` di `.env.personal` kosong. `APP_PUBLIC_URL` terisi, halaman utama melalui tunnel merespons HTTP 200. Tes Duitku sintetis sebelumnya lulus 8/8; ini belum membuktikan pembayaran atau callback sandbox nyata.

**Pembaruan landing dan dokumen (24 Oktober 2026):** Copy halaman utama dan FAQ kini mengikuti saldo prabayar PAYG tanpa klaim warming-up; gambar lama yang mempromosikan paket bulanan di tur produk dihapus. File demo video belum direkam ulang. Draft pengajuan merchant tersedia di `docs/DUITKU_MERCHANT_APPLICATION_DRAFT.pdf` dan sumber editnya di `.html`; dokumen ini belum siap diajukan sampai placeholder badan usaha, domain resmi, kontak, dan dokumen legal dilengkapi.

**Sumber:** Rangkuman pemilik produk dari pembahasan dengan Pak Angga. Ini parafrasa, bukan kutipan langsung.

Dokumen ini mengumpulkan kebutuhan yang akan dibahas dan dikerjakan bertahap. Bagian “Arahan yang dicatat” mencerminkan permintaan yang disampaikan. Bagian “Referensi” hanya menunjuk dokumen pendukung; isinya tidak dianggap sebagai arahan baru sampai ditelaah dan disepakati.

## Keputusan yang sudah dikonfirmasi pemilik

- Seluruh kebutuhan akan dikerjakan bertahap.
- OTP WhatsApp diwajibkan **saat pendaftaran saja**; login tidak memerlukan OTP.
- Sediakan pilihan “Ingat saya” saat login: jika dicentang, sesi tersimpan 14 hari; jika tidak, sesi berakhir saat browser ditutup.
- Device dapat langsung digunakan setelah terhubung; tampilkan banner risiko pada halaman broadcast saja.
- Subakun CS boleh membaca dan membalas percakapan dari semua device yang terhubung.
- CS dibatasi ke Inbox: tidak mendapat akses broadcast, pengelolaan device, pengaturan, tagihan, atau API key.
- Indikator mengetik WhatsApp dapat dipilih per device; pilihan bawaan tetap aktif.

## Status pekerjaan

1. **Akun dan device — perubahan lokal tersedia; uji layanan nyata masih perlu:** alur OTP WhatsApp daftar, pemulihan sandi email, pilihan sesi “Ingat saya”, penghapusan gate *warming up*, dan banner risiko broadcast sudah disentuh. Perlu uji end-to-end dengan provider OTP/email dan device yang benar-benar tersambung.
2. **Inbox dan CS — tersedia dan dideploy ke local production `:13000`:** daftar percakapan dan panel chat mendukung pemilihan device serta balas manual; role CS dapat membaca dan membalas Inbox. Migrasi 064–068 tercatat. Perlu uji hak akses multi-device dengan akun CS dan pesan nyata.
3. **Balasan otomatis — tiga mode tersedia dan dideploy ke local production `:13000`:** pemicu saja, AI umum, dan AI dengan instruksi. Balasan AI grup kini menyimpan `chat_jid` agar tampil dalam percakapan grup yang benar. Log nyata menunjukkan balasan berhasil dan satu error HTTP 503 dari provider AI; perlu memastikan pengaturan model/kredensial provider. Mode auto-reply hanya memproses grup, bukan chat pribadi atau saluran.
4. **Saldo dan tarif:** PAYG berjalan dengan tarif dasar yang dapat diatur. Voucher kredit dan tarif bertingkat belum dibuat karena aturan rinci menunggu pemilik.
5. **Pembayaran:** alur Duitku POP sandbox dan callback diimplementasikan; migration 066 sudah tersedia dan deploy lokal terbaru selesai. Tes sintetis 8/8 pernah lulus. Checkout dan callback sandbox sungguhan belum diuji karena credential Duitku di `.env.personal` kosong. Rincian di `docs/DUITKU_MIGRATION_PLAN.md`.
6. **Pengalaman publik:** landing dan FAQ sudah diselaraskan ke PAYG; footer Privasi dan Syarat & Ketentuan tersedia. Dua tautan tambahan, rekaman video halaman utama, dan validasi batas nama profil WhatsApp masih terbuka.

Urutan ini rencana kerja awal, bukan janji bahwa seluruh tahap dapat digabung dalam satu perubahan. Perubahan autentikasi, pengiriman, saldo, dan pembayaran perlu diverifikasi per tahap sebelum diteruskan.

## Arahan yang dicatat

### 1. Pendaftaran, OTP, dan pemulihan akun

- Nomor WhatsApp wajib dimasukkan saat pendaftaran dan digunakan untuk OTP pendaftaran.
- Gmail digunakan untuk pemulihan kata sandi. Tautan atau kode pemulihan dikirim ke alamat Gmail yang terdaftar.
- Login tidak meminta OTP. “Ingat saya” menyimpan sesi selama 14 hari; tanpa centang, sesi disimpan sampai browser ditutup.

### 2. Penggunaan device dan peringatan broadcast

- Hapus mekanisme *warming up* dan masa tunggu sebelum nomor dapat digunakan. Arahan pemilik adalah nomor dapat langsung dipakai.
- Semua device yang terhubung dapat langsung digunakan untuk pengiriman biasa.
- Tampilkan banner informasi risiko di halaman broadcast saja; tidak menambah dialog konfirmasi risiko.
- Peringatan menjelaskan broadcast dapat membuat WhatsApp membatasi nomor pengirim dan pesan hanya boleh dikirim kepada penerima yang telah setuju.
- Penghapusan *warming up* tidak otomatis menghapus pemeriksaan persetujuan penerima, daftar opt-out, batas pengiriman, atau kontrol pengaman lain yang sudah berjalan; perubahan kontrol tersebut harus dibahas tersendiri.

### 3. Subakun dan akses CS

- Sediakan subakun untuk peran seperti CS.
- CS perlu dapat membuka percakapan dari device yang terhubung di workspace, membaca pesan, dan membalasnya.
- Batas izin yang disepakati: CS hanya membaca dan membalas Inbox; tidak mengirim pesan umum/broadcast, mengelola device, mengubah pengaturan, melihat tagihan, atau memakai API key.
- Pemilik akun/workspace tetap menjadi pihak yang menghubungkan device. Dalam satu dashboard, pengguna dapat memilih di antara banyak device; kebutuhan awalnya setidaknya 8 device dan dapat bertambah.
- Rincian izin setiap peran—misalnya akses broadcast, pengelolaan device, aturan balasan otomatis, dan tagihan—perlu disepakati.

### 4. Modul Pesan seperti aplikasi WhatsApp

- Susun ulang modul Pesan dengan pola daftar percakapan dan panel chat.
- Memilih kontak/percakapan menampilkan nomor dan isi percakapan.
- Sediakan pemilih device agar pengguna bisa melihat atau membalas melalui device yang dipilih.
- Pesan masuk, balasan AI, dan balasan manual perlu terlihat dalam konteks percakapan yang sama.
- Modul ini perlu mendukung banyak device dalam satu dashboard serta akses subakun CS sesuai izin.

### 5. Mode balasan otomatis

Sediakan pilihan cara kerja aturan balasan otomatis:

1. **Pemicu saja:** pesan cocok dengan pemicu lalu sistem mengirim balasan tetap.
2. **AI umum:** AI menyusun jawaban umum berdasarkan pesan yang cocok.
3. **AI dengan instruksi:** pemilik mengisi satu deskripsi yang menjelaskan peran AI, tugasnya, dan hal yang boleh dilakukannya.

Aturan tetap perlu memiliki pemicu yang menentukan kapan balasan dijalankan. Rincian batas penggunaan AI, konteks percakapan yang dikirim ke provider, dan biaya perlu ditetapkan dalam spesifikasi teknis.

### 6. Nama yang terlihat sebelum kontak menyimpan nomor

- Pengguna ingin dapat mengatur nama tampilan agar penerima yang belum menyimpan nomor tetap dapat mengenali pengirim.
- Perlakuan ini perlu divalidasi terhadap kemampuan profil WhatsApp dan pengaturan privasi penerima; jangan menjanjikan nama akan selalu tampil untuk semua penerima.
- Perlu ditinjau apakah pengaturan nama tampilan pada profil device yang sudah ada telah memenuhi kebutuhan ini.

### 7. Voucher kredit untuk mahasiswa

- Admin dapat membuat voucher dan menentukan nilai kredit saldo yang diberikan.
- Voucher dapat dibagikan oleh perantara/distributor (contoh: Fajar); bila diperlukan, sistem mencatat siapa yang membagikan atau menukarkan voucher.
- Saat pendaftaran, pengguna dapat memasukkan kode voucher dan menerima kredit sesuai ketentuan voucher.
- Contoh nilai yang disebut adalah “20”; satuan/nilai rupiahnya belum dipastikan.

### 8. Tautan kebijakan di footer

- Sediakan empat tautan kebijakan/informasi pada footer di seluruh halaman.
- Yang disebut secara eksplisit: Kebijakan Privasi dan Syarat & Ketentuan. Dua tautan lainnya belum dipastikan.
- Implementasi lokal kini menampilkan dua tautan yang sudah disepakati pada footer halaman pemasaran, autentikasi, workspace pengguna, dan panel operator.
- Kandidat untuk dibahas (belum disepakati): Kebijakan Penggunaan yang Dapat Diterima serta Kebijakan Pembayaran/Pengembalian Dana.

### 9. Pembaruan halaman utama

- Perbarui informasi halaman utama karena konten dan video yang ada sudah lama.
- Rekam ulang video agar sesuai dengan produk dan alur terbaru.
- Konten, naskah, aset, dan penanggung jawab pembaruan belum ditentukan.

### 10. Tarif bertingkat yang dapat diatur admin

- Admin perlu dapat mengatur tarif berdasarkan tingkat pemakaian.
- Contoh: setelah pemakaian mencapai 50.000, tarif turun menjadi Rp90 per pesan.
- Belum dipastikan apakah ambang dihitung dari jumlah pesan berhasil atau nilai belanja, periode akumulasi, cakupan tarif per workspace, dan apakah tingkat baru berlaku untuk pemakaian berikutnya saja.

### 11. Persiapan migrasi pembayaran ke Duitku

- Siapkan perubahan dari integrasi pembayaran yang sekarang menuju Duitku.
- Dua PDF yang disebutkan dicatat sebagai bahan referensi untuk menelaah alur dan panduan pembayaran sebelum spesifikasi migrasi ditetapkan.
- Detail teknis, kredensial, lingkungan sandbox/produksi, callback, rekonsiliasi, dan penanganan status pembayaran perlu ditinjau saat pembahasan migrasi.
- Implementasi checkout/callback Duitku sandbox tersedia lokal dan tes sintetis 8/8 lulus. Belum ada migrasi database atau deploy; credential sandbox dan pembayaran nyata belum diverifikasi.

## Hal yang masih menunggu keputusan atau input

1. Pada mode AI, apa sumber konteks dan batas percakapan yang boleh dipakai?
2. Apakah nama tampilan yang dimaksud adalah nama profil WhatsApp pada masing-masing device?
3. Apa satuan kredit voucher, masa berlaku, kuota, penggunaan berulang, dan aturan penggabungannya dengan saldo?
4. Apa dua tautan footer selain Kebijakan Privasi dan Syarat & Ketentuan?
5. Apa isi, target pengguna, dan materi yang perlu ditampilkan pada halaman utama baru?
6. Bagaimana ambang dan periode tarif bertingkat dihitung, dan apakah tarif berlaku per workspace atau global?
7. Materi/naskah video dan konten halaman utama yang baru.
8. Konfirmasi pemilik sebelum perubahan apa pun diarahkan ke Duitku produksi.

Keputusan sandbox Duitku POP dan penutupan top-up DOKU yang belum dibayar sudah dicatat pada `docs/DUITKU_MIGRATION_PLAN.md`; keduanya bukan lagi keputusan terbuka.

## Referensi pembayaran yang disebut

- `PANDUAN-PELANGGAN.pdf`
- `alur-pembayaran.pdf`

**Pembedaan sumber:** kedua PDF adalah dokumentasi sistem NES Billing milik PT Nuansa Teknologi Informasi untuk pembayaran tagihan internet ISP; keduanya bukan spesifikasi KONEVA dan bukan instruksi produk dari Pak Angga.

- `PANDUAN-PELANGGAN.pdf` menjelaskan halaman pembayaran publik NES: pelanggan mencari tagihan dengan nomor pelanggan, memilih VA/QRIS/e-wallet, membayar, lalu status diperbarui otomatis. Dokumen menyebut beberapa gateway yang dapat digunakan, termasuk Duitku.
- `alur-pembayaran.pdf` menjelaskan integrasi Duitku pada NES: pembuatan transaksi berdasarkan nilai tagihan dari database, credential di server, callback dengan verifikasi HMAC-SHA256, dan pemrosesan callback idempoten.
- KONEVA memilih Duitku POP/Create Invoice untuk checkout redirect; sandbox tetap terpisah dari produksi dan belum boleh dianggap siap produksi.
- Yang relevan untuk kajian KONEVA adalah pola integrasi gateway dan kontrol callback/credential. Halaman publik tanpa login, pencarian nomor pelanggan, tabel/status NES, endpoint NES, dan daftar channel pada PDF **tidak otomatis berlaku** untuk top-up saldo PAYG KONEVA.
- Sebelum migrasi, cocokkan protokol dan callback dengan dokumentasi resmi Duitku terkini serta model invoice/top-up KONEVA. Jangan salin endpoint atau alur NES mentah-mentah.
