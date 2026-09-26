"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion, useScroll, useTransform, type Variants } from "framer-motion";
import { ArrowRight, BellRing, CheckCheck, Gauge, ShieldCheck, Smartphone, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CycleToggle, PlanCards } from "@/components/billing/plan-cards";
import { Faq } from "@/components/marketing/faq";
import { HeroDemo } from "@/components/marketing/hero-demo";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { PhotoBackdrop } from "@/components/marketing/photo-backdrop";
import { ProductTour } from "@/components/marketing/product-tour";
import { ReadinessRing } from "@/components/marketing/readiness-ring";
import { Reveal, Stagger, StaggerItem, type RevealFrom } from "@/components/marketing/reveal";
import { RotatingText } from "@/components/marketing/rotating-text";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Stage } from "@/components/marketing/stage";
import { UseCaseMarquee } from "@/components/marketing/use-case-marquee";
import { WarmupFlow } from "@/components/marketing/warmup-flow";
import { useAuth } from "@/hooks/use-auth";
import { usePublicPlans } from "@/hooks/use-billing";
import { track } from "@/lib/track";
import type { BillingCycle } from "@/lib/types";
import { cn } from "@/lib/utils";

const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] } }),
};

// Every claim maps to a shipped backend capability.
const FEATURES = [
  { icon: Smartphone, title: "Banyak nomor, banyak workspace", text: "Satu workspace bisa punya beberapa nomor WhatsApp. Setiap nomor berjalan terpisah dengan sesinya sendiri.", span: "md:col-span-2" },
  { icon: ShieldCheck, title: "Perlindungan nomor", text: "Pemanasan bertahap, jeda seperti orang, batas kirim harian, dan filter isi sebelum pesan dikirim. Mengurangi risiko, tidak menjamin bebas blokir.", span: "" },
  { icon: CheckCheck, title: "Status terkirim dan dibaca", text: "Pantau tiap pesan dari antre sampai dibaca, lengkap dengan waktunya.", span: "" },
  { icon: BellRing, title: "Webhook bertanda tangan", text: "Kabar dikirim ke server Anda dengan tanda tangan HMAC yang bisa diverifikasi, termasuk saat nomor bermasalah.", span: "" },
  { icon: Gauge, title: "Skor kesiapan nomor", text: "Lihat sekilas nomor mana yang sehat, sebelum WhatsApp yang memberi tahu Anda.", span: "" },
] as const;
const ZIGZAG: RevealFrom[] = ["left", "up", "right"];

function Heading({ eyebrow, title, text, as: Tag = "h2" }: { eyebrow: string; title: string; text?: string; as?: "h1" | "h2" }) {
  return (
    <Reveal className="max-w-3xl">
      <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">{eyebrow}</p>
      <Tag className="font-display mt-3 text-4xl leading-[1.1] md:text-5xl">{title}</Tag>
      {text && <p className="mt-4 text-lg text-muted-foreground">{text}</p>}
    </Reveal>
  );
}

function Section({ tone, id, className, backdrop, children, label }: { tone: string; id?: string; className?: string; backdrop?: React.ReactNode; children: React.ReactNode; label?: string }) {
  return (
    <section id={id} aria-label={label} data-tone className={cn(`tone-${tone} relative scroll-mt-4 overflow-hidden`, className)}>
      {backdrop}
      <div className="relative mx-auto max-w-7xl px-6 py-24 md:py-32">{children}</div>
    </section>
  );
}

/** "Masuk" for visitors, "Buka dashboard" for people who are already signed in. */
function AuthLink() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated === true
    ? <Button asChild><Link href="/dashboard">Buka dashboard</Link></Button>
    : (
      <>
        <Button asChild variant="ghost" className="px-2 sm:px-4"><Link href="/login" onClick={() => track("cta_login")}>Masuk</Link></Button>
        <Button asChild className="px-3 sm:px-4"><Link href="/signup" onClick={() => track("cta_signup")}>Daftar gratis</Link></Button>
      </>
    );
}

/** The question everyone asks first. Shows the lowest published monthly price, or says plainly that it is not set yet. */
function PriceHint() {
  const plans = usePublicPlans();
  const prices = (plans.data ?? []).filter((p) => p.price_is_final && p.price_month_idr !== null).map((p) => p.price_month_idr as number);
  const from = prices.length ? Math.min(...prices) : null;
  return (
    <p className="text-sm text-muted-foreground">
      {from !== null
        ? <>Paket berbayar mulai <strong className="text-foreground">Rp {from.toLocaleString("id-ID")}/bulan</strong>. </>
        : <>Harga paket Pelajar dan UMKM diumumkan sebentar lagi; sekarang Anda bisa mencoba dulu. </>}
      <a href="#harga" className="underline underline-offset-2 hover:text-foreground">Lihat paket</a>
    </p>
  );
}

const AUDIENCES: Array<{ title: string; text: string; cta: string; href: string; from: RevealFrom }> = [
  { title: "Pemilik usaha dan UMKM", text: "Kirim info pesanan, pengingat, dan promo ke pelanggan dari nomor WhatsApp toko Anda. Ada dashboard untuk kontak, kirim massal, dan balasan otomatis, tanpa perlu coding.", cta: "Coba gratis", href: "/signup", from: "left" },
  { title: "Developer dan freelancer", text: "Satu API untuk mengirim dan menerima pesan, status waktu nyata, webhook bertanda tangan, dan kunci API berizin. Contoh kode Node.js, Python, dan PHP.", cta: "Baca dokumentasi", href: "/docs", from: "up" },
  { title: "Pelajar dan proyek kuliah", text: "Paket khusus pelajar dengan verifikasi email kampus. Cocok untuk tugas akhir, bot pengingat, atau proyek kecil yang butuh WhatsApp.", cta: "Lihat paket", href: "#harga", from: "right" },
];

export function LandingPage() {
  const reduce = useReducedMotion();
  const plans = usePublicPlans();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const demoY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -70]);
  const glowScale = useTransform(scrollYProgress, [0, 1], [1, reduce ? 1 : 1.5]);

  useEffect(() => { track("view"); }, []);

  return (
    <Stage>
      <main className="relative overflow-x-clip">
        {/* Hero: ink navy = authority; the coral action is the one warm complement */}
        <section ref={heroRef} data-tone aria-label="Pengantar" className="tone-ink relative overflow-hidden">
          <PhotoBackdrop src="/media/photos/skyline-night.jpg" side="full" className="!top-auto h-[70%]" />
          <motion.div aria-hidden style={{ scale: glowScale }} className="pointer-events-none absolute top-[38%] left-1/2 h-[620px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(37,99,235,0.38),rgba(6,182,212,0.12)_55%,transparent)] blur-2xl" />
          <div aria-hidden className="absolute inset-x-0 top-0 h-[560px] [background-image:radial-gradient(rgba(148,163,255,0.22)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_at_top,black_25%,transparent_70%)]" />
          <header className="relative mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
            <Link href="/" className="flex items-center gap-2 sm:gap-3" aria-label="WA Gateway, beranda">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#2563eb] to-[#06b6d4] shadow-md sm:h-10 sm:w-10"><Zap className="h-5 w-5 text-white" /></span>
              <span className="text-base font-semibold whitespace-nowrap sm:text-lg">WA Gateway</span>
            </Link>
            <nav aria-label="Utama" className="flex items-center gap-1 sm:gap-2">
              <Button asChild variant="ghost" className="hidden sm:inline-flex"><a href="#harga">Harga</a></Button>
              <Button asChild variant="ghost" className="hidden sm:inline-flex"><Link href="/docs">Dokumentasi</Link></Button>
              <AuthLink />
            </nav>
          </header>

          <div className="relative mx-auto max-w-5xl px-6 pt-14 pb-10 text-center md:pt-24">
            <motion.p initial="hidden" animate="show" variants={rise} className="mx-auto inline-flex items-center gap-2 rounded-full border bg-card/60 px-3.5 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-[#67e8f9]" />Untuk UMKM, developer, dan pelajar
            </motion.p>
            <motion.h1 initial="hidden" animate="show" custom={1} variants={rise} className="font-display mt-7 text-4xl leading-[1.08] sm:text-6xl md:text-7xl">
              Kirim <span className="hidden lg:inline"> </span><RotatingText />
              {" "}lewat WhatsApp API.
            </motion.h1>
            <motion.p initial="hidden" animate="show" custom={2} variants={rise} className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
              Sambungkan nomor WhatsApp Anda dengan memindai QR, lalu kirim pesan dari aplikasi atau dashboard. Nomor dijaga otomatis: dilatih bertahap, dijeda seperti manusia, dan dipantau kesehatannya.
            </motion.p>
            <motion.div initial="hidden" animate="show" custom={3} variants={rise} className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="h-12 px-7 text-base font-semibold"><Link href="/signup" onClick={() => track("cta_signup")}>Coba gratis 14 hari <ArrowRight className="ml-1" /></Link></Button>
              <Button asChild variant="outline" size="lg" className="h-12 px-7 text-base"><a href="#tur">Lihat cara kerjanya</a></Button>
            </motion.div>
            <motion.div initial="hidden" animate="show" custom={4} variants={rise} className="mt-5 space-y-1.5">
              <PriceHint />
              <p className="text-xs text-muted-foreground">Tanpa kartu kredit. Ini layanan tidak resmi, jadi WhatsApp bisa membatasi nomor; <a href="#faq" className="underline underline-offset-2 hover:text-foreground">baca risikonya</a>.</p>
            </motion.div>
          </div>

          <motion.div style={{ y: demoY }} initial="hidden" animate="show" custom={5} variants={rise} className="relative mx-auto max-w-2xl px-6 pb-20">
            <HeroDemo />
          </motion.div>
          <UseCaseMarquee />
          <div aria-hidden className="h-24" />
        </section>

        {/* Untuk siapa: sky = jelas dan tepercaya; juga menyebut untuk siapa layanan ini BUKAN */}
        <Section tone="sky" id="untuk-siapa" label="Untuk siapa">
          <Heading eyebrow="Untuk siapa" title="Dibuat untuk yang ingin mulai cepat, tanpa urusan rumit" />
          <Stagger className="mt-12 grid gap-5 md:grid-cols-3" step={0.1}>
            {AUDIENCES.map((a) => (
              <StaggerItem key={a.title} from={a.from} className="flex flex-col rounded-2xl border bg-card p-7 shadow-card">
                <h3 className="font-display text-2xl">{a.title}</h3>
                <p className="mt-3 flex-1 text-muted-foreground">{a.text}</p>
                <Button asChild variant="outline" className="mt-6 self-start"><Link href={a.href}>{a.cta} <ArrowRight className="ml-1" /></Link></Button>
              </StaggerItem>
            ))}
          </Stagger>
          <Reveal delay={0.1}>
            <p className="mt-8 max-w-3xl rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              <strong className="text-foreground">Bukan untuk:</strong> kebutuhan yang tidak boleh berisiko sama sekali, misalnya instansi dengan kewajiban kepatuhan, atau login yang hanya bergantung pada WhatsApp. Untuk itu, jalur resmi dari Meta lebih tepat.
            </p>
          </Reveal>
        </Section>

        {/* Tur produk: cream = tenang, manusiawi */}
        <Section tone="cream" id="tur" label="Tampilan produk" backdrop={<PhotoBackdrop src="/media/photos/florist.jpg" side="right" blend="mix-blend-multiply" className="!bottom-auto h-[560px]" />}>
          <Heading eyebrow="Tampilan asli" title="Dari daftar sampai siap kirim, sekitar 5 menit" text="Bukan mockup. Anda dituntun satu langkah demi satu langkah, tanpa perlu membaca dokumentasi dulu." />
          <div className="mt-12"><ProductTour /></div>
        </Section>

        {/* Perlindungan: mint = rasa aman. Kartu masuk zig-zag dari kiri, bawah, kanan. */}
        <Section tone="mint" id="features" label="Fitur" backdrop={<PhotoBackdrop src="/media/photos/support.jpg" side="right" blend="mix-blend-multiply" className="!bottom-auto h-[520px]" />}>
          <Heading eyebrow="Keamanan nomor" title="Dibuat untuk keandalan, bukan sekadar kecepatan" />
          <Stagger className="mt-12 grid gap-5 md:grid-cols-3" step={0.09}>
            {FEATURES.map((f, i) => (
              <StaggerItem key={f.title} from={ZIGZAG[i % 3]} className={cn("group rounded-2xl border bg-card p-7 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-elevated", f.span)}>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary transition-transform duration-300 group-hover:scale-110"><f.icon className="h-5 w-5 text-primary" /></div>
                <h3 className="font-display mt-6 text-2xl">{f.title}</h3>
                <p className="mt-2 text-muted-foreground">{f.text}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </Section>

        {/* Pemanasan: sand = hangat, sabar, bertahap */}
        <Section tone="sand" label="Pemanasan nomor" backdrop={<PhotoBackdrop src="/media/photos/seller.jpg" side="right" blend="mix-blend-multiply" className="!bottom-auto h-[560px]" />}>
          <Heading eyebrow="Pemanasan" title="Nomor baru dilatih dulu, bukan langsung dipakai penuh" text="Batas kirim naik bertahap. Balasan ke orang yang menulis lebih dulu selalu diperbolehkan sejak hari pertama." />
          <div className="mt-12"><WarmupFlow /></div>
        </Section>

        {/* Skor: indigo = analitis, wawasan */}
        <Section tone="indigo" label="Skor kesiapan" backdrop={<PhotoBackdrop src="/media/photos/analytics.jpg" side="right" blend="mix-blend-luminosity" className="!bottom-auto h-[520px]" />}>
          <Heading eyebrow="Skor kesiapan" title="Lihat kesehatan nomor, bukan menebak" text="Lima faktor dengan bobot yang jelas. Kalau datanya belum cukup, skor bilang belum yakin, bukan berpura-pura pasti." />
          <Reveal from="pop" className="mt-12"><ReadinessRing /></Reveal>
        </Section>

        {/* Cara kerja: cream, sticky scrollytelling */}
        <Section tone="cream" label="Cara mulai" backdrop={<PhotoBackdrop src="/media/photos/shopowner.jpg" side="left" blend="mix-blend-multiply" className="!bottom-auto h-[520px]" />}>
          <Heading eyebrow="Mulai" title="Aktif dalam tiga langkah" />
          <div className="mt-8"><HowItWorks /></div>
        </Section>

        {/* Harga: sky = kepercayaan untuk keputusan uang. Angka muncul setelah operator menetapkan final. */}
        {plans.data && plans.data.length > 0 && (
          <Section tone="sky" id="harga" label="Paket dan harga" backdrop={<PhotoBackdrop src="/media/photos/homeoffice.jpg" side="right" blend="mix-blend-multiply" className="!bottom-auto h-[520px]" />}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <Heading eyebrow="Paket" title="Harga yang jelas, tanpa kejutan" text="Percobaan gratis 14 hari saat mendaftar. Pembayaran dikonfirmasi manual oleh penyedia layanan." />
              <Reveal from="left"><CycleToggle value={cycle} onChange={setCycle} /></Reveal>
            </div>
            <Reveal from="pop" className="mt-10"><PlanCards plans={plans.data} cycle={cycle} /></Reveal>
          </Section>
        )}

        {/* FAQ: jawaban jujur, juga terbaca mesin pencari dan asisten AI lewat data terstruktur */}
        <Section tone="cream" id="faq" label="Pertanyaan umum">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.7fr] lg:gap-16">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <Heading eyebrow="Pertanyaan umum" title="Yang biasanya ditanyakan sebelum mendaftar" text="Jawaban jujur, termasuk soal risiko. Belum ketemu? Baca dokumentasi API." />
              <Reveal delay={0.1}><Button asChild variant="outline" className="mt-6"><Link href="/docs">Buka dokumentasi <ArrowRight className="ml-1" /></Link></Button></Reveal>
            </div>
            <Faq />
          </div>
        </Section>

        {/* Penutup: kembali ke ink + coral */}
        <section data-tone aria-label="Mulai sekarang" className="tone-ink">
          <div className="mx-auto max-w-4xl px-6 py-28 text-center md:py-36">
            <Reveal><h2 className="font-display text-4xl leading-[1.1] md:text-6xl">Siap mengirim pesan pertama?</h2></Reveal>
            <Reveal delay={0.1}><p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">Buat akun, sambungkan nomor, dan mulai mengirim dalam hitungan menit.</p></Reveal>
            <Reveal from="pop" delay={0.2}><Button asChild size="lg" className="mt-9 h-12 px-8 text-base font-semibold"><Link href="/signup" onClick={() => track("cta_signup")}>Buat akun gratis <ArrowRight className="ml-1" /></Link></Button></Reveal>
          </div>
        </section>
        <SiteFooter />
      </main>
    </Stage>
  );
}
