import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/marketing-shell";

export const metadata: Metadata = {
  title: "Syarat dan Ketentuan",
  description: "Syarat dan ketentuan penggunaan KONEVA.",
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
          <p className="text-sm text-muted-foreground">Berlaku sejak: <span className={TODO}>[DIISI SAAT HALAMAN DITERBITKAN]</span></p>
        </header>

        <section><h2>1. Tentang layanan</h2>
          <p>KONEVA menyambungkan nomor WhatsApp milik Anda ke API agar aplikasi Anda dapat mengirim dan menerima pesan. Layanan ini adalah <strong>pihak ketiga</strong>, memakai koneksi <strong>tidak resmi</strong>, dan tidak berafiliasi, disponsori, atau didukung oleh WhatsApp maupun Meta.</p></section>

        <section><h2>2. Risiko pembatasan dan pemblokiran nomor</h2>
          <p><a className="text-primary underline" href="https://www.whatsapp.com/legal/terms-of-service" target="_blank" rel="noreferrer">Ketentuan WhatsApp</a> membatasi akses atau penggunaan layanan yang tidak diizinkan, termasuk cara otomatis tertentu. KONEVA memakai koneksi pihak ketiga yang tidak resmi dan tidak disediakan atau disetujui WhatsApp/Meta; penggunaannya dapat bertentangan dengan ketentuan WhatsApp dan berisiko membuat nomor dibatasi atau dinonaktifkan. Kontrol izin penerima dan pengiriman tidak menghilangkan risiko tersebut; kami <strong>tidak menjamin</strong> nomor aman atau layanan selalu tersedia. Anda bertanggung jawab menilai apakah cara koneksi ini sesuai untuk penggunaan Anda. WhatsApp dan Meta bukan pihak yang mendukung atau menjamin KONEVA.</p></section>

        <section><h2>3. Akun dan keamanan</h2>
          <ul>
            <li>Anda bertanggung jawab atas kerahasiaan kata sandi dan kunci API. Kunci hanya tampil sekali; segera cabut kunci yang bocor.</li>
            <li>Pemilik workspace bertanggung jawab atas anggota tim yang diundangnya dan peran yang diberikan.</li>
            <li>Anda harus memiliki hak atas nomor yang disambungkan.</li>
          </ul></section>

        <section><h2>4. Penggunaan yang dilarang</h2>
          <p>Dilarang memakai layanan untuk:</p>
          <ul>
            <li>mengirim pesan massal atau promosi kepada orang yang belum memberi izin untuk menerimanya (spam);</li>
            <li>penipuan, phishing, atau menyamar sebagai pihak lain;</li>
            <li>konten yang melanggar hukum Indonesia, termasuk perjudian, kekerasan, dan eksploitasi anak;</li>
            <li>mengakali batas layanan, atau mengganggu keamanan dan kinerja layanan.</li>
          </ul>
          <p>Sebelum mengirim, Anda harus memastikan penerima memang mengharapkan pesan tersebut, menyimpan bukti izin yang relevan, menjelaskan identitas pengirim, dan menyediakan cara yang jelas untuk berhenti menerima pesan. Jika penerima meminta berhenti atau menarik izinnya, keluarkan penerima itu dari daftar kirim dan hentikan pesan berikutnya.</p>
          <p>Sistem KONEVA mengenali sejumlah kata kunci permintaan berhenti pada pesan masuk dari nomor penerima yang sama di perangkat yang sama dalam 365 hari terakhir, lalu memblokir pengiriman proaktif non-urgent ke nomor itu pada perangkat tersebut. Pesan urgent hanya boleh digunakan untuk keperluan yang diperlukan menjalankan layanan, seperti OTP dan konfirmasi pembayaran; jangan gunakan label urgent untuk promosi atau untuk menghindari permintaan berhenti. Deteksi ini bukan pencatatan consent atau daftar blokir yang dikelola pelanggan, tidak mencakup semua bentuk permintaan berhenti, dan tidak berlaku untuk pesan urgent. Anda tetap bertanggung jawab menghentikan promosi setelah penerima meminta berhenti serta memenuhi permintaan itu di semua perangkat, daftar, dan integrasi Anda. Penyalahgunaan label urgent akan ditinjau dan workspace dapat ditangguhkan oleh penyedia layanan. Kami dapat membatasi atau menghentikan akun yang melanggar, dengan atau tanpa pemberitahuan lebih dulu bila diperlukan untuk melindungi layanan atau pihak lain.</p></section>

        <section><h2>5. Paket, kuota, uji coba, dan pembayaran</h2>
          <ul>
            <li>Akun baru mendapat uji coba gratis 14 hari dengan batas yang tertera di dashboard.</li>
            <li>Paket dan harga baru ditagih per bulan: Pelajar Rp29.000 (1 nomor, 1.000 pesan/bulan, 1 anggota; perlu verifikasi pelajar); Asisten Pribadi Rp59.000 (1 nomor, 5.000 pesan/bulan, 1 anggota); Tim UKM Rp99.000 (3 nomor, 10.000 pesan/bulan, 3 anggota); dan Bisnis CS Rp199.000 (5 nomor, 10 anggota, serta <strong>&ldquo;Unlimited pesan*&rdquo;</strong> dengan fair-use <strong>20.000 pesan/bulan (±667/hari)</strong>). Batas fair-use Bisnis CS ditampilkan di sini dengan jelas, bukan sebagai catatan kaki.</li>
            <li>Checkout tahunan ditutup untuk pesanan baru. Langganan tahunan lama tetap mengikuti masa dan nilai yang tercatat pada tagihannya.</li>
            <li>Pesan dengan kode OTP yang benar-benar ada di isi pesan hanya dikecualikan jika lolos pemeriksaan dan rate-limit server; pesan transaksi lain tidak otomatis dikecualikan. Label prioritas saja tidak membuat pesan dikecualikan.</li>
            <li>Saat kuota bulanan habis, pesan berikutnya <strong>ditahan, tidak dibuang</strong>, dan otomatis terkirim begitu kuota tersedia lagi (naik paket, atau reset periode berikutnya); dashboard menawarkan naik paket saat itu terjadi.</li>
            <li>Untuk pelanggan Pelajar lama yang memiliki harga khusus, pemesanan Pelajar berikutnya tetap memakai Rp19.000/bulan selama catatan langganannya masih berada pada paket Pelajar. Status aktif atau jeda tidak mengubah harga khusus itu; jika beralih ke paket lain, harga paket tujuan berlaku. Harga ini tidak berlaku untuk pendaftaran Pelajar baru.</li>
            <li>Pembayaran saat ini dikonfirmasi manual oleh penyedia layanan; paket aktif setelah pembayaran dikonfirmasi.</li>
            <li>Bila pembayaran terlambat, pengiriman tetap berjalan selama masa tenggang 7 hari. Jika pembayaran belum diterima sampai masa tenggang berakhir, layanan berakhir otomatis tanpa pengembalian dana; data akun tetap dapat dilihat.</li>
            <li>Anda dapat membatalkan kapan saja dengan menghubungi KONEVA melalui kontak yang tercantum di bagian 10. Layanan tetap berjalan sampai akhir periode yang sudah dibayar; tagihan untuk periode berikutnya dihentikan.</li>
            <li>Biaya untuk sisa periode berbayar tidak dikembalikan. Jika terjadi pembayaran ganda atau kesalahan sistem, KONEVA wajib mengembalikan 100% pembayaran yang keliru paling lambat 7 hari kerja setelah kesalahan dikonfirmasi.</li>
          </ul></section>

        <section><h2>6. Ketersediaan</h2>
          <p>Layanan diberikan apa adanya. Kami berusaha menjaganya tetap berjalan, tetapi belum ada jaminan tingkat layanan (SLA) tertulis. Pemeliharaan atau gangguan dari WhatsApp dapat menghentikan pengiriman sementara.</p></section>

        <section><h2>7. Data</h2>
          <p>Pengelolaan data pribadi dijelaskan di <a className="text-primary underline" href="/privasi">Kebijakan Privasi</a>. Anda bertanggung jawab memiliki dasar yang sah (misalnya persetujuan) untuk mengirim pesan kepada penerima Anda.</p></section>

        <section><h2>8. Batas tanggung jawab</h2>
          <p>Sejauh diizinkan hukum, tanggung jawab kami atas kerugian yang timbul dari penggunaan layanan dibatasi paling banyak sebesar biaya langganan yang Anda bayarkan dalam 3 bulan terakhir. Kami tidak bertanggung jawab atas kerugian tidak langsung, kehilangan keuntungan, atau kehilangan data.</p></section>

        <section><h2>9. Perubahan dan hukum yang berlaku</h2>
          <p>Syarat ini dapat diperbarui; perubahan penting diumumkan di dashboard atau lewat email. Syarat ini tunduk pada hukum Republik Indonesia. Sengketa yang tidak dapat diselesaikan melalui musyawarah diselesaikan melalui Pengadilan Negeri Bandung.</p></section>

        <section><h2>10. Kontak</h2>
          <p>Penyedia layanan: KONEVA, Bandung, Indonesia. Kontak privasi: <a className="text-primary underline" href="mailto:koneva.id26@gmail.com">koneva.id26@gmail.com</a>.</p></section>
      </article>
    </MarketingShell>
  );
}
