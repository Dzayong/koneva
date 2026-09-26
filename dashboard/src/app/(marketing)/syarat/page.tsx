import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/marketing-shell";

export const metadata: Metadata = {
  title: "Syarat dan Ketentuan",
  description: "Syarat dan ketentuan penggunaan WA Gateway.",
  alternates: { canonical: "/syarat" },
  robots: { index: false, follow: true }, // draft: not for search until reviewed
};

const TODO = "rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-900 dark:text-amber-200";

export default function TermsPage() {
  return (
    <MarketingShell>
      <div role="note" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <strong>Draf untuk ditinjau.</strong> Naskah ini ditulis sesuai cara kerja layanan, tetapi belum ditinjau ahli hukum. Bagian bertanda <span className={TODO}>[DIISI]</span> menunggu keputusan pemilik layanan.
      </div>
      <article className="mt-8 space-y-8 [&_h2]:font-display [&_h2]:text-2xl [&_li]:mt-1.5 [&_p]:mt-3 [&_p]:leading-relaxed [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
        <header>
          <h1 className="font-display text-4xl">Syarat dan Ketentuan</h1>
          <p className="text-sm text-muted-foreground">Berlaku sejak: <span className={TODO}>[DIISI]</span></p>
        </header>

        <section><h2>1. Tentang layanan</h2>
          <p>WA Gateway menyambungkan nomor WhatsApp milik Anda ke API agar aplikasi Anda dapat mengirim dan menerima pesan. Layanan ini adalah <strong>pihak ketiga</strong>, memakai koneksi <strong>tidak resmi</strong>, dan tidak berafiliasi, disponsori, atau didukung oleh WhatsApp maupun Meta.</p></section>

        <section><h2>2. Risiko pembatasan dan pemblokiran nomor</h2>
          <p>WhatsApp menyatakan bahwa penggunaan aplikasi tidak resmi dapat berujung pada pembatasan sementara atau pemblokiran permanen nomor. Kami mengurangi risikonya (pemanasan bertahap, jeda acak, batas kirim, skor kesiapan), tetapi <strong>tidak menjamin</strong> nomor Anda aman. Dengan memakai layanan ini Anda menerima risiko tersebut. Kami tidak bertanggung jawab atas hilangnya akses ke nomor, kontak, atau percakapan akibat tindakan WhatsApp.</p></section>

        <section><h2>3. Akun dan keamanan</h2>
          <ul>
            <li>Anda bertanggung jawab atas kerahasiaan kata sandi dan kunci API. Kunci hanya tampil sekali; segera cabut kunci yang bocor.</li>
            <li>Pemilik workspace bertanggung jawab atas anggota tim yang diundangnya dan peran yang diberikan.</li>
            <li>Anda harus memiliki hak atas nomor yang disambungkan.</li>
          </ul></section>

        <section><h2>4. Penggunaan yang dilarang</h2>
          <p>Dilarang memakai layanan untuk:</p>
          <ul>
            <li>mengirim pesan massal atau promosi kepada orang yang belum menyetujui menerimanya (spam);</li>
            <li>penipuan, phishing, atau menyamar sebagai pihak lain;</li>
            <li>konten yang melanggar hukum Indonesia, termasuk perjudian, kekerasan, dan eksploitasi anak;</li>
            <li>mengakali batas layanan, atau mengganggu keamanan dan kinerja layanan.</li>
          </ul>
          <p>Kami dapat membatasi atau menghentikan akun yang melanggar, dengan atau tanpa pemberitahuan lebih dulu bila diperlukan untuk melindungi layanan atau pihak lain.</p></section>

        <section><h2>5. Paket, uji coba, dan pembayaran</h2>
          <ul>
            <li>Akun baru mendapat uji coba gratis 14 hari dengan batas yang tertera di dashboard.</li>
            <li>Paket berbayar tersedia bulanan atau tahunan. Harga tertera di halaman utama setelah ditetapkan.</li>
            <li>Pembayaran saat ini dikonfirmasi manual oleh penyedia layanan; paket aktif setelah pembayaran dikonfirmasi.</li>
            <li>Bila pembayaran terlambat, pengiriman tetap berjalan selama masa tenggang 7 hari, lalu dihentikan sementara. Data tetap dapat dilihat.</li>
            <li>Paket Pelajar memerlukan verifikasi.</li>
            <li>Kebijakan pengembalian dana: <span className={TODO}>[DIISI]</span></li>
          </ul></section>

        <section><h2>6. Ketersediaan</h2>
          <p>Layanan diberikan apa adanya. Kami berusaha menjaganya tetap berjalan, tetapi belum ada jaminan tingkat layanan (SLA) tertulis. Pemeliharaan atau gangguan dari WhatsApp dapat menghentikan pengiriman sementara.</p></section>

        <section><h2>7. Data</h2>
          <p>Pengelolaan data pribadi dijelaskan di <a className="text-primary underline" href="/privasi">Kebijakan Privasi</a>. Anda bertanggung jawab memiliki dasar yang sah (misalnya persetujuan) untuk mengirim pesan kepada penerima Anda.</p></section>

        <section><h2>8. Batas tanggung jawab</h2>
          <p>Sejauh diizinkan hukum, tanggung jawab kami atas kerugian yang timbul dari penggunaan layanan dibatasi paling banyak sebesar biaya yang Anda bayarkan dalam <span className={TODO}>[DIISI: jumlah bulan]</span> terakhir. Kami tidak bertanggung jawab atas kerugian tidak langsung, kehilangan keuntungan, atau kehilangan data.</p></section>

        <section><h2>9. Perubahan dan hukum yang berlaku</h2>
          <p>Syarat ini dapat diperbarui; perubahan penting diumumkan di dashboard atau lewat email. Syarat ini tunduk pada hukum Republik Indonesia. Penyelesaian sengketa: <span className={TODO}>[DIISI: musyawarah, lalu pengadilan/arbitrase di …]</span></p></section>

        <section><h2>10. Kontak</h2>
          <p>Penyedia layanan: <span className={TODO}>[DIISI: nama badan/pemilik, alamat, email]</span></p></section>
      </article>
    </MarketingShell>
  );
}
