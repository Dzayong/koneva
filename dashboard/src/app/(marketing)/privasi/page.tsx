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
        <strong>Draf untuk ditinjau.</strong> Naskah ini menggambarkan data yang memang diproses sistem saat ini, tetapi belum ditinjau ahli hukum, termasuk kesesuaiannya dengan UU Pelindungan Data Pribadi (UU No. 27 Tahun 2022). Bagian <span className={TODO}>[DIISI]</span> menunggu keputusan pemilik layanan.
      </div>
      <article className="mt-8 space-y-8 [&_h2]:font-display [&_h2]:text-2xl [&_li]:mt-1.5 [&_p]:mt-3 [&_p]:leading-relaxed [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
        <header>
          <h1 className="font-display text-4xl">Kebijakan Privasi</h1>
          <p className="text-sm text-muted-foreground">Berlaku sejak: <span className={TODO}>[DIISI]</span></p>
        </header>

        <section><h2>1. Data yang kami proses</h2>
          <ul>
            <li><strong>Akun:</strong> nama, email, dan kata sandi (disimpan hanya dalam bentuk hash), workspace, peran, dan undangan tim.</li>
            <li><strong>Pesan:</strong> isi, nomor pengirim dan penerima, status, dan waktu pesan yang dikirim atau diterima lewat nomor Anda. Data ini milik Anda dan penerima Anda; kami memprosesnya agar layanan berjalan.</li>
            <li><strong>Kunci dan sesi:</strong> kunci API dan sesi masuk (disimpan sebagai hash), serta sesi WhatsApp nomor Anda agar tidak perlu memindai QR berulang.</li>
            <li><strong>Webhook:</strong> alamat penerima dan catatan pengiriman (kejadian, status jawaban, waktu).</li>
            <li><strong>Aktivitas:</strong> catatan siapa mengubah apa di workspace, termasuk alamat IP dan waktu, untuk keamanan dan akuntabilitas tim.</li>
            <li><strong>Kunjungan situs:</strong> hitungan kunjungan dan klik tanpa cookie dan tanpa identitas pribadi (hanya nama kejadian, asal rujukan, dan utm_source).</li>
            <li><strong>Pembayaran:</strong> nomor tagihan, jumlah, dan status. Bukti transfer dikirim di luar sistem.</li>
          </ul></section>

        <section><h2>2. Untuk apa</h2>
          <p>Untuk menjalankan layanan (mengirim, menerima, dan melacak pesan), menjaga keamanan dan mencegah penyalahgunaan, menagih dan mengelola paket, memberikan dukungan, dan memperbaiki layanan. Kami tidak menjual data Anda dan tidak memakainya untuk iklan.</p>
          <p>Setiap paket berlangganan punya batas pesan per bulan yang ditegakkan sistem. Paket Bisnis CS menampilkan <strong>&ldquo;Unlimited pesan*&rdquo;</strong> dengan batas fair-use terlihat jelas <strong>20.000 pesan/bulan (±667/hari)</strong>. Kode OTP dan pesan transaksional lain, yang diverifikasi otomatis oleh sistem, tidak dihitung dalam batas ini. Saat batas tercapai, pesan ditahan sementara (tidak dibuang) sampai kuota tersedia lagi.</p></section>

        <section><h2>3. Berbagi data</h2>
          <p>Data tidak dibagikan kepada pihak lain kecuali: (a) ke server Anda sendiri lewat webhook; (b) ke penyedia infrastruktur yang menjalankan layanan (<span className={TODO}>[DIISI: penyedia hosting dan lokasi server]</span>); (c) bila diwajibkan hukum. Pesan diteruskan ke WhatsApp sebagaimana layaknya pengiriman pesan.</p></section>

        <section><h2>4. Penyimpanan</h2>
          <p>Data disimpan selama akun aktif. Setelah akun ditutup, data dihapus dalam <span className={TODO}>[DIISI: jangka waktu]</span>, kecuali yang wajib disimpan menurut hukum. Lama penyimpanan isi pesan: <span className={TODO}>[DIISI]</span>.</p></section>

        <section><h2>5. Hak Anda</h2>
          <p>Anda dapat meminta akses, koreksi, atau penghapusan data pribadi Anda, dan menarik persetujuan, dengan menghubungi kontak di bawah. Kami menanggapi dalam <span className={TODO}>[DIISI: jangka waktu]</span>.</p></section>

        <section><h2>6. Keamanan</h2>
          <p>Kata sandi, kunci API, dan token sesi disimpan sebagai hash; webhook ditandatangani; akses dalam workspace dibatasi peran. Tidak ada sistem yang sepenuhnya aman, dan bila terjadi kebocoran data pribadi kami akan memberi tahu pihak terdampak sesuai hukum.</p></section>

        <section><h2>7. Anak</h2>
          <p>Layanan ditujukan bagi pengguna yang cakap hukum. Pelajar yang belum dewasa sebaiknya memakai layanan dengan sepengetahuan orang tua atau wali.</p></section>

        <section><h2>8. Perubahan dan kontak</h2>
          <p>Perubahan penting diumumkan di dashboard atau lewat email. Kontak pelindungan data: <span className={TODO}>[DIISI: nama, email]</span></p></section>
      </article>
    </MarketingShell>
  );
}
