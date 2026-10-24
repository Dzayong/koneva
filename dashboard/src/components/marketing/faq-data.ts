/** One source for the visible FAQ and its FAQPage structured data; the two must say the same thing. */
export const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Apa itu KONEVA?",
    a: "KONEVA menghubungkan WhatsApp dengan aplikasi lewat REST API dan menyediakan inbox bersama agar tim CS dapat membaca serta membalas percakapan dari device yang pemilik workspace hubungkan. Pemakaian pesan menggunakan saldo prabayar.",
  },
  {
    q: "Apakah ini WhatsApp API resmi dan apakah nomor bisa diblokir?",
    a: "Bukan. Layanan ini memakai koneksi tidak resmi dan tidak berafiliasi dengan WhatsApp maupun Meta. WhatsApp menyatakan penggunaan aplikasi tidak resmi dapat berujung pada pembatasan atau pemblokiran nomor. KONEVA menyediakan pencatatan izin penerima, opt-out, dan kontrol pengiriman, tetapi tidak menjamin nomor bebas blokir.",
  },
  {
    q: "Apa bedanya dengan WhatsApp Business API resmi?",
    a: "Jalur resmi lewat Meta memerlukan verifikasi bisnis, penyedia resmi, dan template pesan yang disetujui, dengan biaya per percakapan. KONEVA berjalan di nomor yang Anda miliki tanpa persetujuan template, sehingga lebih cepat dipakai dan fleksibel, tetapi memiliki risiko pembatasan nomor yang tidak ada di jalur resmi. Untuk kebutuhan yang tidak boleh berisiko, misalnya instansi dengan kewajiban kepatuhan, jalur resmi lebih tepat.",
  },
  {
    q: "Bagaimana cara menyambungkan nomor?",
    a: "Buat akun, tambahkan nomor di dashboard, lalu pindai kode QR dari WhatsApp: Perangkat tertaut, Tautkan perangkat. Sesi tersimpan sehingga tidak perlu memindai ulang setiap hari. Nomor tetap bisa dipakai di HP Anda seperti biasa.",
  },
  {
    q: "Bagaimana dengan OTP yang harus cepat?",
    a: "Pesan dengan prioritas urgent memakai antrean sendiri dan tidak menunggu jeda pengiriman biasa, sehingga cocok untuk kode OTP. Pesan OTP/transaksional hanya memperoleh perlakuan khusus jika lolos pemeriksaan sistem. Pesan biasa tetap diberi jeda untuk mengendalikan laju pengiriman. Karena jalur ini tidak resmi, jangan menjadikannya satu-satunya cara untuk login atau transaksi penting; siapkan jalur cadangan seperti SMS atau email.",
  },
  {
    q: "Bagaimana saya tahu pesan terkirim, dibaca, atau nomor bermasalah?",
    a: "Setiap pesan punya status dari antre, terkirim, sampai dibaca. Anda juga bisa memasang webhook bertanda tangan HMAC untuk menerima kabar saat pesan terkirim, dibalas, gagal, atau saat status nomor berubah, misalnya terputus atau ditolak WhatsApp.",
  },
  {
    q: "Apakah bisa mengirim ke grup atau saluran?",
    a: "Saat ini layanan mengirim dan menerima di chat pribadi. Pesan masuk dari grup tercatat, tetapi pengiriman ke grup dan saluran belum tersedia.",
  },
  {
    q: "Bagaimana biaya KONEVA dihitung?",
    a: "KONEVA menggunakan saldo prabayar tanpa paket bulanan. Tarif per pesan ditampilkan di halaman Tagihan; biaya final dikenakan untuk pesan yang terkonfirmasi berhasil, sedangkan status yang belum pasti ditahan sementara untuk diperiksa. Isi saldo ketika workspace siap digunakan.",
  },
  {
    q: "Bagaimana tim CS menggunakan KONEVA?",
    a: "Pemilik workspace menghubungkan dan mengelola nomor WhatsApp. Setelah diberi akses sebagai CS, anggota tim dapat membuka inbox, memilih percakapan dari device yang terhubung, membaca konteks chat, dan membalas lewat nomor sumbernya.",
  },
  {
    q: "Data apa yang disimpan?",
    a: "Kami menyimpan data akun, isi dan status pesan yang lewat, log webhook, serta catatan aktivitas tim agar fitur dashboard berjalan. Rincian lengkap ada di Kebijakan Privasi.",
  },
];
