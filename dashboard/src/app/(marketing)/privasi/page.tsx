import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/marketing-shell";

export const metadata: Metadata = {
  title: "Kebijakan Privasi",
  description: "Data apa yang dikumpulkan KONEVA, untuk apa, dan bagaimana Anda mengendalikannya.",
  alternates: { canonical: "/privasi" },
  robots: { index: false, follow: true },
};

const TODO = "rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-900 dark:text-amber-200";

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <div role="note" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <strong>Draf untuk ditinjau.</strong> Naskah ini menggambarkan pemrosesan yang diketahui saat ini, bukan konfirmasi kepatuhan hukum, dan perlu ditinjau penasihat hukum. Rujukan utama termasuk <a className="underline" href="https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022" target="_blank" rel="noreferrer">UU Pelindungan Data Pribadi</a>. Tanggal berlaku diisi saat halaman diterbitkan.
      </div>
      <article className="mt-8 space-y-8 [&_h2]:font-display [&_h2]:text-2xl [&_li]:mt-1.5 [&_p]:mt-3 [&_p]:leading-relaxed [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
        <header>
          <h1 className="font-display text-4xl">Kebijakan Privasi</h1>
          <p className="text-sm text-muted-foreground">Berlaku sejak: <span className={TODO}>[DIISI SAAT HALAMAN DITERBITKAN]</span></p>
        </header>

        <section><h2>1. Data yang kami proses</h2>
          <ul>
            <li><strong>Akun:</strong> nama, email, dan kata sandi (disimpan hanya dalam bentuk hash), workspace, peran, dan undangan tim.</li>
            <li><strong>Pesan dan kontak:</strong> isi pesan, nomor pengirim dan penerima, status, waktu, serta data kontak yang Anda masukkan. KONEVA memprosesnya untuk meneruskan pesan dan menampilkan status kepada Anda. Isi pesan dapat memuat data pribadi yang Anda atau penerima sertakan.</li>
            <li><strong>Kunci dan sesi:</strong> kunci API dan sesi masuk (disimpan sebagai hash), serta sesi WhatsApp nomor Anda agar tidak perlu memindai QR berulang.</li>
            <li><strong>Webhook:</strong> alamat penerima dan catatan pengiriman (kejadian, status jawaban, waktu).</li>
            <li><strong>Aktivitas:</strong> catatan siapa mengubah apa di workspace, termasuk alamat IP dan waktu, untuk keamanan dan akuntabilitas tim.</li>
            <li><strong>Kunjungan situs:</strong> hitungan kunjungan dan klik tanpa cookie dan tanpa identitas pribadi (hanya nama kejadian, asal rujukan, dan utm_source).</li>
            <li><strong>Paket dan pembayaran:</strong> paket, periode, nomor tagihan, jumlah, status pembayaran, dan riwayat langganan. Pembayaran dikonfirmasi manual; bukti transfer dikirim di luar dashboard.</li>
          </ul></section>

        <section><h2>2. Untuk apa</h2>
          <p>Data digunakan untuk menjalankan dan mengamankan akun, mengirim, menerima, serta melacak pesan atas permintaan Anda, mengelola tagihan, menangani dukungan, dan memperbaiki layanan. KONEVA tidak menjual isi pesan dan tidak menggunakannya untuk iklan.</p>
          <p>Untuk pesan yang Anda kirim, Anda menentukan penerima dan isi. Anda bertanggung jawab memperoleh izin yang diperlukan, menyimpan buktinya, dan menghentikan promosi setelah penerima menarik izin atau meminta berhenti. Sistem KONEVA mengenali sejumlah kata kunci permintaan berhenti pada pesan masuk dari nomor penerima yang sama di perangkat yang sama dalam 365 hari terakhir, lalu memblokir pengiriman proaktif non-urgent ke nomor itu pada perangkat tersebut. Deteksi ini tidak mencatat bukti consent, tidak menjadi daftar blokir yang dikelola pelanggan lintas perangkat, dan tidak mencakup semua bentuk permintaan. Pesan urgent yang diperlukan untuk menjalankan layanan—termasuk OTP dan konfirmasi pembayaran—tidak diblokir oleh deteksi ini walau penerima telah meminta berhenti; promosi tetap harus dihentikan. Label urgent hanya boleh digunakan untuk keperluan layanan. Penyalahgunaan label urgent akan ditinjau dan workspace dapat ditangguhkan oleh penyedia layanan.</p>
          <p>Harga paket baru berlaku bulanan: Pelajar Rp29.000, Asisten Pribadi Rp59.000, Tim UKM Rp99.000, dan Bisnis CS Rp199.000. Batasnya berturut-turut 1.000 pesan/1 nomor/1 anggota; 5.000/1/1; 10.000/3/3; dan Bisnis CS <strong>&ldquo;Unlimited pesan*&rdquo;</strong> dengan fair-use <strong>20.000 pesan/bulan (±667/hari)</strong>/5 nomor/10 anggota. Checkout tahunan baru ditutup. OTP hanya dikecualikan jika lolos pemeriksaan kode dan batas server; prioritas pesan saja tidak memberi pengecualian. Saat batas tercapai, pesan ditahan, bukan dibuang, sampai kuota tersedia lagi.</p></section>

        <section><h2>3. Berbagi data</h2>
          <p>Data dibagikan seperlunya: (a) isi pesan dan nomor tujuan diteruskan melalui layanan WhatsApp untuk pengiriman; (b) kejadian yang Anda pilih dikirim ke endpoint webhook milik Anda; atau (c) bila diwajibkan hukum. Konfigurasi pengembangan/personal yang tercatat saat ini berjalan secara lokal menggunakan Docker dan belum menetapkan vendor hosting produksi. Informasi vendor serta lokasi pemrosesan dan penyimpanan akan diperbarui saat migrasi produksi. Penanganan data oleh WhatsApp/Meta tunduk pada ketentuan mereka sendiri. KONEVA tidak menjual data pribadi.</p>
          <p>Tujuan dan kendali berbeda menurut jenis data: untuk akun, keamanan, dan tagihan KONEVA mengelola proses layanan; untuk isi pesan dan penerima, pelanggan menentukan tujuan pengiriman dan KONEVA memproses pesan untuk menjalankan instruksi pelanggan. Pembagian peran hukum dan perjanjian pemrosesan masih perlu dikaji sebelum layanan dipublikasikan.</p></section>

        <section><h2>4. Penyimpanan</h2>
          <p>Kami menerapkan masa simpan berbeda menurut kategori berikut. Penghapusan terjadwal untuk kategori ini belum tersedia secara menyeluruh dan akan dikerjakan pada tahap retensi berikutnya; sampai mekanisme itu diterapkan dan diverifikasi, masa di bawah ini adalah kebijakan yang ditetapkan, bukan bukti bahwa penghapusan otomatis sudah berjalan.</p>
          <ul>
            <li>Isi dan status pesan: 90 hari.</li>
            <li>Catatan pengiriman webhook: 30 hari.</li>
            <li>Log keamanan: 12 bulan.</li>
            <li>Data akun setelah penutupan akun: 30 hari.</li>
            <li>Invoice: 10 tahun.</li>
            <li>Backup: 30 hari.</li>
          </ul>
          <p>Permintaan penghapusan akan ditinjau menurut tujuan pemrosesan dan kewajiban penyimpanan yang berlaku. Jika penghapusan dibatasi kewajiban hukum atau penyelesaian sengketa, data yang masih harus disimpan tidak digunakan untuk tujuan lain.</p></section>

        <section><h2>5. Hak Anda</h2>
          <p>Anda dapat meminta akses atau salinan, koreksi, penghentian/pembatasan pemrosesan, atau penghapusan data pribadi, serta menarik persetujuan jika pemrosesan memang didasarkan pada persetujuan. Permintaan dikirim ke kontak privasi di bawah; kami dapat meminta informasi yang wajar untuk memverifikasi identitas dan kewenangan pemohon. Kami menargetkan memberi kabar penerimaan dalam 1 hari kerja dan menyelesaikan permintaan paling lambat 7 hari kerja.</p>
          <p>Jika Anda adalah penerima pesan dari pelanggan KONEVA, sampaikan permintaan berhenti kepada pengirim pesan tersebut. Pelanggan bertanggung jawab menghentikan pengiriman promosi dari daftar dan sistemnya. Anda tetap dapat menghubungi KONEVA untuk permintaan terkait pemrosesan yang dilakukan KONEVA melalui kontak privasi di bawah.</p></section>

        <section><h2>6. Keamanan</h2>
          <p>Kata sandi, kunci API, dan token sesi disimpan sebagai hash; webhook ditandatangani; akses workspace dibatasi berdasarkan peran. Tidak ada sistem yang sepenuhnya aman. Insiden pelindungan data ditangani dan diberitahukan kepada pihak yang relevan sesuai peran dan ketentuan hukum yang berlaku. Untuk pertanyaan privasi atau insiden data, hubungi <a className="text-primary underline" href="mailto:koneva.id26@gmail.com">koneva.id26@gmail.com</a>.</p></section>

        <section><h2>7. Anak</h2>
          <p>Layanan ditujukan bagi pengguna yang cakap hukum. Pelajar yang belum dewasa sebaiknya memakai layanan dengan sepengetahuan orang tua atau wali.</p></section>

        <section><h2>8. Perubahan dan kontak</h2>
          <p>Perubahan penting diumumkan di dashboard atau lewat email. Penyedia layanan: KONEVA, Bandung, Indonesia. Kontak privasi: <a className="text-primary underline" href="mailto:koneva.id26@gmail.com">koneva.id26@gmail.com</a>.</p></section>
      </article>
    </MarketingShell>
  );
}
