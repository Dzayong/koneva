import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock, type CodeTab } from "@/components/developers/code-block";
import { EVENTS, EXAMPLE_PAYLOADS, VERIFY_SNIPPETS } from "@/components/developers/webhook-snippets";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { TrackView } from "@/components/marketing/track-view";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Dokumentasi API WhatsApp: kirim pesan, status, dan webhook",
  description: "Panduan API KONEVA: autentikasi, mengirim pesan dan OTP, membaca status, aturan pemanasan nomor, serta webhook bertanda tangan dengan contoh Node.js, Python, dan PHP.",
  alternates: { canonical: "/docs" },
  openGraph: { url: "/docs", title: "Dokumentasi API KONEVA", description: "Kirim pesan, baca status, dan pasang webhook." },
};

const BASE = "https://api.domain-anda.com";
const SEND: CodeTab[] = [
  { id: "curl", label: "cURL", code: `curl -X POST ${BASE}/api/v1/message/send \\
  -H "Authorization: Bearer wgk_KUNCI_ANDA" \\
  -H "Content-Type: application/json" \\
  -d '{"device_key":"WAPI-XXXXXXXX","to":"6281234567890","message":"Halo dari API"}'` },
  { id: "node", label: "Node.js", code: `const res = await fetch("${BASE}/api/v1/message/send", {
  method: "POST",
  headers: { Authorization: "Bearer wgk_KUNCI_ANDA", "Content-Type": "application/json" },
  body: JSON.stringify({ device_key: "WAPI-XXXXXXXX", to: "6281234567890", message: "Halo dari API" }),
});
console.log(await res.json()); // { success: true, data: { message_id, status: "queued" } }` },
  { id: "python", label: "Python", code: `import requests

res = requests.post(
    "${BASE}/api/v1/message/send",
    headers={"Authorization": "Bearer wgk_KUNCI_ANDA"},
    json={"device_key": "WAPI-XXXXXXXX", "to": "6281234567890", "message": "Halo dari API"},
)
print(res.json())` },
];

const TOC = [["mulai", "Mulai"], ["autentikasi", "Autentikasi"], ["kirim", "Kirim pesan"], ["status", "Status pesan"], ["pemanasan", "Pemanasan dan batas"], ["webhook", "Webhook"], ["kesalahan", "Kode kesalahan"]];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="font-display mt-14 scroll-mt-8 text-3xl">{children}</h2>;
}

export default function DocsPage() {
  return (
    <MarketingShell wide>
      <TrackView event="view_docs" />
      <div className="grid gap-12 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Daftar isi" className="hidden lg:block">
          <ul className="sticky top-8 space-y-2 text-sm">
            {TOC.map(([id, label]) => <li key={id}><a href={`#${id}`} className="text-muted-foreground hover:text-primary">{label}</a></li>)}
          </ul>
        </nav>
        <article className="max-w-3xl [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_p]:mt-3 [&_p]:leading-relaxed [&_table]:mt-4 [&_table]:w-full [&_table]:text-sm [&_td]:border-b [&_td]:py-2 [&_td]:pr-4 [&_td]:align-top [&_th]:border-b [&_th]:py-2 [&_th]:pr-4 [&_th]:text-left [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
          <h1 className="font-display text-4xl md:text-5xl">Dokumentasi API</h1>
          <p className="text-lg text-muted-foreground">Kirim dan terima pesan WhatsApp dari aplikasi Anda memakai nomor Anda sendiri. Layanan ini memakai koneksi tidak resmi, jadi baca juga <Link className="text-primary underline" href="/#faq">risiko dan batasannya</Link>.</p>

          <H2 id="mulai">Mulai</H2>
          <ul>
            <li>Buat akun dan tambahkan nomor di dashboard, lalu pindai kode QR dari WhatsApp (Perangkat tertaut).</li>
            <li>Buat kunci API di menu <strong>Kunci API</strong>. Kunci diawali <code>wgk_</code> dan hanya tampil sekali.</li>
            <li>Semua alamat di bawah relatif terhadap alamat API Anda; contoh memakai <code>{BASE}</code>.</li>
          </ul>

          <H2 id="autentikasi">Autentikasi</H2>
          <p>Kirim kunci di header <code>Authorization: Bearer wgk_...</code>. Kunci punya izin (misalnya hanya kirim pesan), bisa diganti kuncinya, dan bisa dicabut. Jangan menaruh kunci di aplikasi yang dilihat pengguna (browser atau aplikasi HP); panggil API dari server Anda.</p>

          <H2 id="kirim">Kirim pesan</H2>
          <p><code>POST /api/v1/message/send</code> menaruh pesan ke antrean dan langsung menjawab <code>202</code>. Itu berarti <em>diterima</em>, belum <em>terkirim</em>; pantau statusnya lewat webhook atau endpoint status. Pesan promosi hanya dapat dikirim kepada penerima yang sudah opt-in.</p>
          <table>
            <thead><tr><th>Isian</th><th>Keterangan</th></tr></thead>
            <tbody>
              <tr><td><code>device_key</code></td><td>Kode nomor pengirim, misalnya <code>WAPI-XXXXXXXX</code> (lihat di dashboard).</td></tr>
              <tr><td><code>to</code></td><td>Nomor tujuan dengan kode negara, tanpa spasi, misalnya <code>6281234567890</code>.</td></tr>
              <tr><td><code>message</code></td><td>Isi pesan, sampai 4096 karakter. Bila ada <code>media_url</code>, ini menjadi keterangan gambar dan boleh kosong. Tautan (https://…) di dalamnya bisa diketuk penerima.</td></tr>
              <tr><td><code>media_url</code></td><td>Opsional. Alamat publik <code>https</code> untuk gambar, video, atau dokumen. Alamat lokal ditolak.</td></tr>
              <tr><td><code>media_type</code></td><td><code>image</code> (bawaan), <code>video</code>, atau <code>document</code>. Nomor yang masih masa pemanasan belum boleh mengirim media sampai hari ke-5.</td></tr>
              <tr><td><code>priority</code></td><td>Nilai dari pemanggil tidak memberi pengecualian atau jalur khusus. OTP yang lolos pemeriksaan server memakai antrean cepat secara otomatis.</td></tr>
              <tr><td><code>external_id</code></td><td>Opsional, penanda dari sistem Anda (maks 64 karakter).</td></tr>
            </tbody>
          </table>
          <div className="mt-4"><CodeBlock tabs={SEND} /></div>
          <p className="mt-4">Penerima dapat mengirim pesan mandiri <code>START</code> atau <code>MULAI</code> untuk opt-in, dan <code>STOP</code> atau <code>BERHENTI</code> untuk berhenti. Tanpa consent tersimpan, API mengembalikan <code>409 RECIPIENT_CONSENT_REQUIRED</code>; setelah opt-out, API mengembalikan <code>409 RECIPIENT_OPTED_OUT</code>. Broadcast melaporkan penolakan per penerima.</p>

          <H2 id="status">Status pesan</H2>
          <p><code>GET /api/v1/messages/&#123;id&#125;</code> mengembalikan status dan riwayatnya. Urutan normal: <code>queued</code> → <code>sending</code> → <code>sent</code> → <code>delivered</code> → <code>read</code>. Status akhir gagal: <code>failed</code> atau <code>blocked</code> (ditolak aturan keamanan nomor). <code>POST /api/v1/messages/&#123;id&#125;/retry</code> mencoba ulang pesan yang gagal.</p>
          <p>Centang biru (<code>read</code>) hanya muncul jika penerima mengaktifkan tanda baca di WhatsApp-nya.</p>

          <H2 id="pemanasan">Pemanasan dan batas</H2>
          <p>Nomor baru dilatih bertahap. Pesan masuk tidak otomatis menjadi consent promosi; balasan otomatis dan pesan promosi tetap memerlukan opt-in tercatat.</p>
          <table>
            <thead><tr><th>Hari</th><th>Batas kirim per hari</th><th>Catatan</th></tr></thead>
            <tbody>
              <tr><td>1–2</td><td>5</td><td>Hanya membalas, belum memulai percakapan</td></tr>
              <tr><td>3–4</td><td>10</td><td>Pesan pertama ke kontak baru mulai boleh</td></tr>
              <tr><td>5–7</td><td>20</td><td>Media mulai boleh</td></tr>
              <tr><td>8+</td><td>50</td><td>Batas normal</td></tr>
            </tbody>
          </table>
          <p>Ada juga batas per menit dan kuota pesan bulanan sesuai paket. Hanya OTP dengan <code>otp_code</code> yang diverifikasi server yang memakai jalur transactional cepat; nilai <code>priority: &quot;urgent&quot;</code> dari pemanggil tidak mengaktifkannya.</p>

          <H2 id="webhook">Webhook</H2>
          <p>Webhook adalah panggilan dari kami ke server Anda saat ada kejadian, sehingga Anda tidak perlu menanyakan status terus-menerus. Simpan alamat di dashboard menu <strong>Webhook</strong>, buat kunci tanda tangan, lalu tekan <em>Kirim tes</em>.</p>
          <p>Setiap kiriman membawa header <code>X-Webhook-Event</code> dan <code>X-Webhook-Signature: sha256=&lt;hex&gt;</code>, yaitu HMAC-SHA256 dari <strong>body mentah</strong> dengan kunci Anda. Hitung ulang dan bandingkan:</p>
          <div className="mt-4"><CodeBlock tabs={VERIFY_SNIPPETS} /></div>
          <h3 className="mt-8 text-lg font-semibold">Kejadian</h3>
          <table>
            <thead><tr><th>Kejadian</th><th>Kapan</th></tr></thead>
            <tbody>{EVENTS.map((e) => <tr key={e.name}><td><code>{e.name}</code></td><td>{e.when}</td></tr>)}</tbody>
          </table>
          <div className="mt-4"><CodeBlock tabs={EXAMPLE_PAYLOADS} /></div>
          <h3 className="mt-8 text-lg font-semibold">Aturan pengiriman</h3>
          <ul>
            <li>Balas <strong>2xx dalam 10 detik</strong>; selain itu dianggap gagal.</li>
            <li>Dicoba ulang 3 kali (setelah 1, 5, dan 15 detik), lalu dicatat gagal.</li>
            <li>Pengalihan (redirect) tidak diikuti.</li>
            <li>Bisa terkirim dobel dan urutan tidak dijamin: buat proses Anda aman diulang dan pakai <code>timestamp</code>.</li>
          </ul>

          <H2 id="kesalahan">Kode kesalahan</H2>
          <table>
            <thead><tr><th>Kode</th><th>Artinya</th></tr></thead>
            <tbody>
              <tr><td><code>401</code></td><td>Kunci API tidak ada, salah, atau sudah dicabut.</td></tr>
              <tr><td><code>402 PLAN_INACTIVE</code></td><td>Paket tidak aktif (masa percobaan atau paket berakhir). Pengiriman dan penambahan nomor dihentikan.</td></tr>
              <tr><td><code>402 PLAN_MEMBER_LIMIT</code></td><td>Batas anggota tim paket tercapai.</td></tr>
              <tr><td><code>404 DEVICE_NOT_FOUND</code></td><td><code>device_key</code> tidak ada di workspace ini.</td></tr>
              <tr><td><code>429 QUOTA_EXCEEDED</code></td><td>Kuota pesan bulanan habis; jawaban menyebut tanggal reset.</td></tr>
              <tr><td><code>failed</code> / <code>blocked</code></td><td>Pesan ditolak aturan keamanan nomor (batas harian, pemanasan) atau nomor bermasalah; alasan ada di detail pesan.</td></tr>
            </tbody>
          </table>
          <p className="mt-10 text-sm text-muted-foreground">{SITE.name} adalah layanan pihak ketiga, tidak berafiliasi dengan WhatsApp atau Meta.</p>
        </article>
      </div>
    </MarketingShell>
  );
}
