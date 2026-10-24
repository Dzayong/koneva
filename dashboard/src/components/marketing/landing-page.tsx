"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { motion, useReducedMotion, useScroll, useTransform, type Variants } from "framer-motion";
import { ArrowRight, BellRing, CheckCheck, Code2, MessagesSquare, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KonevaLogo } from "@/components/brand/koneva-logo";
import { Faq } from "@/components/marketing/faq";
import { HeroDemo } from "@/components/marketing/hero-demo";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { PhotoBackdrop } from "@/components/marketing/photo-backdrop";
import { ProductTour } from "@/components/marketing/product-tour";
import { Reveal, Stagger, StaggerItem, type RevealFrom } from "@/components/marketing/reveal";
import { RotatingText } from "@/components/marketing/rotating-text";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Stage } from "@/components/marketing/stage";
import { UseCaseMarquee } from "@/components/marketing/use-case-marquee";
import { useAuth } from "@/hooks/use-auth";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";

const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] } }),
};

// Every claim maps to a shipped backend capability.
const FEATURES = [
  { icon: Code2, title: "API untuk proyek Anda", text: "Kirim pesan dari aplikasi lewat REST API, pantau status, dan terima event melalui webhook bertanda tangan.", span: "" },
  { icon: MessagesSquare, title: "Inbox bersama untuk CS", text: "Tim CS dapat membaca dan membalas percakapan dari semua device yang pemilik workspace hubungkan.", span: "" },
  { icon: Smartphone, title: "Kelola beberapa nomor", text: "Pilih nomor pengirim di dashboard dan pantau aktivitas setiap device dari satu workspace.", span: "" },
  { icon: BellRing, title: "Webhook bertanda tangan", text: "Terima pembaruan status melalui webhook HMAC yang dapat diverifikasi oleh server Anda.", span: "" },
  { icon: ShieldCheck, title: "Kendali dan transparansi", text: "Catat izin penerima, hormati permintaan berhenti, dan lihat status pengiriman. Risiko pembatasan WhatsApp tetap ada.", span: "" },
  { icon: CheckCheck, title: "Saldo prabayar", text: "Isi saldo saat siap memakai. Biaya dikenakan setelah pesan terkonfirmasi berhasil.", span: "" },
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

const AUDIENCES: Array<{ title: string; text: string; cta: string; href: string; from: RevealFrom }> = [
  { title: "Developer", text: "Hubungkan aplikasi ke WhatsApp lewat REST API, kunci berizin, status pesan, dan webhook. Mulai dari dokumentasi dan isi saldo sesuai pemakaian.", cta: "Buka dokumentasi", href: "/docs", from: "left" },
  { title: "Pelajar dan mahasiswa", text: "Uji ide proyek kuliah dengan API dan webhook. Buat akun, sambungkan nomor sendiri, lalu top up saat siap mengirim.", cta: "Lihat biaya", href: "#harga", from: "up" },
  { title: "Bisnis dan tim CS", text: "Pemilik menghubungkan nomor; CS membaca dan membalas percakapan lintas device dari satu inbox, tanpa berbagi akses ke HP pemilik.", cta: "Lihat inbox CS", href: "#tur", from: "right" },
];

export function LandingPage() {
  const reduce = useReducedMotion();
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
            <Link href="/" className="flex items-center" aria-label="KONEVA, beranda">
              <KonevaLogo markClassName="h-9 w-9 sm:h-10 sm:w-10" textClassName="text-base sm:text-lg" />
            </Link>
            <nav aria-label="Utama" className="flex items-center gap-1 sm:gap-2">
              <Button asChild variant="ghost" className="hidden sm:inline-flex"><a href="#harga">Harga</a></Button>
              <Button asChild variant="ghost" className="hidden sm:inline-flex"><Link href="/docs">Dokumentasi</Link></Button>
              <AuthLink />
            </nav>
          </header>

          <div className="relative mx-auto max-w-5xl px-6 pt-14 pb-10 text-center md:pt-24">
            <motion.h1 initial="hidden" animate="show" custom={1} variants={rise} className="font-display mt-7 text-4xl leading-[1.08] sm:text-6xl md:text-7xl">
              Satu koneksi WhatsApp untuk <RotatingText />.
            </motion.h1>
            <motion.p initial="hidden" animate="show" custom={2} variants={rise} className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
              Hubungkan aplikasi lewat API atau bantu pelanggan dari satu inbox CS. Pemilik workspace menyambungkan nomor; tim dapat membaca dan membalas percakapan dari device yang diizinkan.
            </motion.p>
            <motion.div initial="hidden" animate="show" custom={3} variants={rise} className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="h-12 px-7 text-base font-semibold"><Link href="/signup" onClick={() => track("cta_signup")}>Buat akun <ArrowRight className="ml-1" /></Link></Button>
              <Button asChild variant="outline" size="lg" className="h-12 px-7 text-base"><a href="#tur">Lihat cara kerjanya</a></Button>
            </motion.div>
            <motion.div initial="hidden" animate="show" custom={4} variants={rise} className="mt-5 space-y-1.5">
              <p className="text-sm text-muted-foreground">Mulai tanpa paket bulanan. Isi saldo saat siap mengirim. <a href="#harga" className="underline underline-offset-2 hover:text-foreground">Lihat cara kerja saldo</a></p>
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
          <Heading eyebrow="Untuk siapa" title="Dari proyek pertama sampai tim layanan pelanggan" text="Developer membangun integrasi, mahasiswa mencoba ide, dan bisnis mengelola percakapan pelanggan bersama tim CS." />
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
          <Heading eyebrow="Tampilan produk" title="Lihat alur kerja yang dipakai tim" text="Tutorial pendaftaran reguler, inbox percakapan untuk CS, saldo prabayar, dan dokumentasi API." />
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

        <Section tone="sand" label="Kontrol pengiriman" backdrop={<PhotoBackdrop src="/media/photos/seller.jpg" side="right" blend="mix-blend-multiply" className="!bottom-auto h-[560px]" />}>
          <Heading eyebrow="Kontrol pengiriman" title="Mulai gunakan device setelah terhubung" text="Tidak ada masa tunggu berdasarkan usia nomor. Tetap kirim hanya kepada penerima yang setuju; broadcast dapat membuat WhatsApp membatasi nomor pengirim." />
          <div className="mt-8 max-w-2xl rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm leading-relaxed">
            <strong>Risiko tetap ada.</strong> KONEVA bukan WhatsApp Business API resmi dan tidak dapat menjamin nomor bebas pembatasan. Sistem tetap menghormati opt-out serta menerapkan kontrol pengiriman umum.
          </div>
        </Section>

        {/* Cara kerja: cream, sticky scrollytelling */}
        <Section tone="cream" label="Cara mulai" backdrop={<PhotoBackdrop src="/media/photos/shopowner.jpg" side="left" blend="mix-blend-multiply" className="!bottom-auto h-[520px]" />}>
          <Heading eyebrow="Cara kerja" title="Satu workspace untuk tim dan aplikasi" text="Inbox CS, saldo prabayar, dan integrasi API dalam satu alur kerja." />
          <div className="mt-8"><HowItWorks /></div>
        </Section>

        {/* PAYG replaced monthly plans; price and balance are visible in billing before sending. */}
        <Section tone="sky" id="harga" label="Saldo dan tarif" backdrop={<PhotoBackdrop src="/media/photos/homeoffice.jpg" side="right" blend="mix-blend-multiply" className="!bottom-auto h-[520px]" />}>
          <Heading eyebrow="Bayar sesuai pemakaian" title="Isi saldo seperlunya" text="Tidak ada paket bulanan. Isi saldo prabayar dan gunakan beberapa device dalam satu workspace." />
          <Reveal from="pop" className="mt-10 max-w-3xl rounded-xl border bg-card p-6 shadow-card">
            <h3 className="text-xl font-semibold">Biaya mengikuti hasil pengiriman</h3>
            <p className="mt-3 text-muted-foreground">Tarif per pesan terlihat di halaman Tagihan. Biaya final dikenakan untuk pesan yang terkonfirmasi berhasil; pesan dengan status belum pasti ditahan sementara untuk diperiksa.</p>
            <p className="mt-3 text-sm text-muted-foreground">Pesan gagal tidak dikenai biaya. Saldo dan riwayat pemakaian dapat dipantau dari dashboard.</p>
          </Reveal>
        </Section>

        {/* FAQ: jawaban jujur, juga terbaca mesin pencari dan asisten AI lewat data terstruktur */}
        <Section tone="cream" id="faq" label="Pertanyaan umum">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.7fr] lg:gap-16">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <Heading eyebrow="Pertanyaan umum" title="Yang biasanya ditanyakan sebelum mulai" text="Jawaban jujur soal API, inbox CS, saldo, dan risiko. Belum ketemu? Baca dokumentasi." />
              <Reveal delay={0.1}><Button asChild variant="outline" className="mt-6"><Link href="/docs">Buka dokumentasi <ArrowRight className="ml-1" /></Link></Button></Reveal>
            </div>
            <Faq />
          </div>
        </Section>

        {/* Penutup: kembali ke ink + coral */}
        <section data-tone aria-label="Mulai sekarang" className="tone-ink">
          <div className="mx-auto max-w-4xl px-6 py-28 text-center md:py-36">
            <Reveal><h2 className="font-display text-4xl leading-[1.1] md:text-6xl">Mulai dari akun, lanjut saat siap</h2></Reveal>
            <Reveal delay={0.1}><p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">Daftar, sambungkan nomor sendiri, lalu isi saldo sebelum menggunakan API atau inbox CS.</p></Reveal>
            <Reveal from="pop" delay={0.2}><Button asChild size="lg" className="mt-9 h-12 px-8 text-base font-semibold"><Link href="/signup" onClick={() => track("cta_signup")}>Daftar dan mulai <ArrowRight className="ml-1" /></Link></Button></Reveal>
          </div>
        </section>
        <SiteFooter />
      </main>
    </Stage>
  );
}
