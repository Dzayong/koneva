/** One source for the visible FAQ and its FAQPage structured data; the two must say the same thing. */
export const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Apa itu WA Gateway?",
    a: "WA Gateway adalah layanan API untuk mengirim dan menerima pesan WhatsApp memakai nomor Anda sendiri. Anda memindai kode QR seperti membuka WhatsApp Web, mengambil kunci API, lalu mengirim pesan dari aplikasi Anda. Ada juga dashboard untuk memantau status, tim, dan webhook.",
  },
  {
    q: "Apakah ini WhatsApp API resmi dan apakah nomor bisa diblokir?",
    a: "Bukan. Layanan ini memakai koneksi tidak resmi dan tidak berafiliasi dengan WhatsApp maupun Meta. WhatsApp menyatakan penggunaan aplikasi tidak resmi dapat berujung pada pembatasan atau pemblokiran nomor. Kami mengurangi risikonya lewat pemanasan bertahap, jeda acak seperti manusia, batas kirim, dan pemantauan kesehatan nomor, tetapi kami tidak menjamin nomor bebas blokir.",
  },
  {
    q: "Apa bedanya dengan WhatsApp Business API resmi?",
    a: "Jalur resmi lewat Meta memerlukan verifikasi bisnis, penyedia resmi, dan template pesan yang disetujui, dengan biaya per percakapan. WA Gateway berjalan di nomor yang Anda miliki tanpa persetujuan template, sehingga lebih cepat dipakai dan fleksibel, tetapi memiliki risiko pembatasan nomor yang tidak ada di jalur resmi. Untuk kebutuhan yang tidak boleh berisiko, misalnya instansi dengan kewajiban kepatuhan, jalur resmi lebih tepat.",
  },
  {
    q: "Bagaimana cara menyambungkan nomor?",
    a: "Buat akun, tambahkan nomor di dashboard, lalu pindai kode QR dari WhatsApp: Perangkat tertaut, Tautkan perangkat. Sesi tersimpan sehingga tidak perlu memindai ulang setiap hari. Nomor tetap bisa dipakai di HP Anda seperti biasa.",
  },
  {
    q: "Apa itu pemanasan nomor?",
    a: "Nomor yang baru disambungkan dilatih bertahap. Pada hari 1 sampai 2 nomor hanya membalas orang yang menulis lebih dulu, lalu batas kirim naik dari 5, 10, 20, hingga 50 pesan per hari. Tujuannya membuat pola pemakaian terlihat wajar.",
  },
  {
    q: "Bagaimana dengan OTP yang harus cepat?",
    a: "Pesan dengan prioritas urgent memakai antrean sendiri dan tidak menunggu jeda pengiriman biasa, sehingga cocok untuk kode OTP. Pesan biasa tetap diberi jeda agar pola pengiriman tidak terlihat seperti mesin. Karena jalur ini tidak resmi, jangan menjadikannya satu-satunya cara untuk login atau transaksi penting; siapkan jalur cadangan seperti SMS atau email.",
  },
  {
    q: "Bagaimana saya tahu pesan terkirim, dibaca, atau nomor bermasalah?",
    a: "Setiap pesan punya status dari antre, terkirim, sampai dibaca. Anda juga bisa memasang webhook bertanda tangan HMAC untuk menerima kabar saat pesan terkirim, dibalas, gagal, atau saat status nomor berubah, misalnya terputus atau ditolak WhatsApp. Skor kesiapan nomor menunjukkan kondisinya sebelum WhatsApp yang memberi tahu.",
  },
  {
    q: "Apakah bisa mengirim ke grup atau saluran?",
    a: "Saat ini layanan mengirim dan menerima di chat pribadi. Pesan masuk dari grup tercatat, tetapi pengiriman ke grup dan saluran belum tersedia.",
  },
  {
    q: "Berapa harga dan apakah ada uji coba?",
    a: "Setiap akun baru mendapat uji coba gratis 14 hari tanpa kartu kredit. Paket awal ditujukan untuk pelajar dan UMKM, dengan pilihan bulanan atau tahunan. Harga akan tertera di halaman ini setelah ditetapkan. Pembayaran saat ini dikonfirmasi manual oleh penyedia layanan.",
  },
  {
    q: "Data apa yang disimpan?",
    a: "Kami menyimpan data akun, isi dan status pesan yang lewat, log webhook, serta catatan aktivitas tim agar fitur dashboard berjalan. Rincian lengkap ada di Kebijakan Privasi.",
  },
];
