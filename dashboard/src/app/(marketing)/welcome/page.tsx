"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion, useScroll, useTransform, type Variants } from "framer-motion";
import { ArrowRight, BellRing, CheckCheck, Gauge, ShieldCheck, Smartphone, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CycleToggle, PlanCards } from "@/components/billing/plan-cards";
import { HeroDemo } from "@/components/marketing/hero-demo";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { ProductTour } from "@/components/marketing/product-tour";
import { ReadinessRing } from "@/components/marketing/readiness-ring";
import { RotatingText } from "@/components/marketing/rotating-text";
import { Stage } from "@/components/marketing/stage";
import { UseCaseMarquee } from "@/components/marketing/use-case-marquee";
import { WarmupFlow } from "@/components/marketing/warmup-flow";
import { usePublicPlans } from "@/hooks/use-billing";
import type { BillingCycle } from "@/lib/types";
import { cn } from "@/lib/utils";

const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.4, ease: "easeOut" } }),
};

// Every claim maps to a shipped backend capability.
const FEATURES = [
  { icon: Smartphone, title: "Banyak nomor, banyak workspace", text: "Satu workspace bisa punya beberapa nomor WhatsApp. Setiap nomor berjalan terpisah dengan sesinya sendiri.", span: "md:col-span-2" },
  { icon: ShieldCheck, title: "Perlindungan nomor", text: "Pemanasan bertahap, jeda seperti orang, batas kirim harian, dan filter isi sebelum pesan dikirim. Mengurangi risiko, tidak menjamin bebas blokir.", span: "" },
  { icon: CheckCheck, title: "Status terkirim dan dibaca", text: "Pantau tiap pesan dari antre sampai dibaca, lengkap dengan waktunya.", span: "" },
  { icon: BellRing, title: "Webhook bertanda tangan", text: "Kabar dikirim ke server Anda dengan tanda tangan HMAC yang bisa diverifikasi, termasuk saat nomor bermasalah.", span: "" },
  { icon: Gauge, title: "Skor kesiapan nomor", text: "Lihat sekilas nomor mana yang sehat, sebelum WhatsApp yang memberi tahu Anda.", span: "" },
] as const;

function Heading({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <motion.div initial="hidden" whileInView="show" viewport={{ once: true, margin: "-80px" }} variants={rise} className="max-w-3xl">
      <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">{eyebrow}</p>
      <h2 className="font-display mt-3 text-4xl leading-[1.1] md:text-5xl">{title}</h2>
      {text && <p className="mt-4 text-lg text-muted-foreground">{text}</p>}
    </motion.div>
  );
}

function Section({ tone, id, className, children }: { tone: string; id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} data-tone className={cn(`tone-${tone} scroll-mt-4`, className)}>
      <div className="mx-auto max-w-7xl px-6 py-24 md:py-32">{children}</div>
    </section>
  );
}

export default function WelcomePage() {
  const reduce = useReducedMotion();
  const plans = usePublicPlans();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const demoY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -70]);
  const glowScale = useTransform(scrollYProgress, [0, 1], [1, reduce ? 1 : 1.5]);

  return (
    <Stage>
      <main className="relative overflow-x-clip">
        {/* Hero: ink navy = authority; coral action = the one warm complement */}
        <section ref={heroRef} data-tone className="tone-ink relative overflow-hidden">
          <motion.div aria-hidden style={{ scale: glowScale }} className="pointer-events-none absolute top-[38%] left-1/2 h-[620px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(37,99,235,0.38),rgba(6,182,212,0.12)_55%,transparent)] blur-2xl" />
          <div aria-hidden className="absolute inset-x-0 top-0 h-[560px] [background-image:radial-gradient(rgba(148,163,255,0.22)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_at_top,black_25%,transparent_70%)]" />
          <header className="relative mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#2563eb] to-[#06b6d4] shadow-md"><Zap className="h-5 w-5 text-white" /></div>
              <span className="text-lg font-semibold">WA Gateway</span>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" className="hidden sm:inline-flex"><a href="#harga">Harga</a></Button>
              <Button asChild variant="outline"><Link href="/login">Masuk</Link></Button>
            </div>
          </header>

          <div className="relative mx-auto max-w-5xl px-6 pt-14 pb-10 text-center md:pt-24">
            <motion.p initial="hidden" animate="show" variants={rise} className="mx-auto inline-flex items-center gap-2 rounded-full border bg-card/60 px-3.5 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-[#67e8f9]" />Jalur non-resmi, risikonya kami jelaskan terbuka
            </motion.p>
            <motion.h1 initial="hidden" animate="show" custom={1} variants={rise} className="font-display mt-7 text-5xl leading-[1.06] sm:text-6xl md:text-7xl">
              Kirim <RotatingText />
              <br />lewat WhatsApp API.
            </motion.h1>
            <motion.p initial="hidden" animate="show" custom={2} variants={rise} className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
              Pindai QR dengan nomor Anda sendiri, ambil kunci API, kirim. Nomor dijaga dengan pemanasan bertahap, jeda seperti orang, dan skor kesiapan, supaya Anda tahu kondisinya sebelum WhatsApp yang memberi tahu.
            </motion.p>
            <motion.div initial="hidden" animate="show" custom={3} variants={rise} className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="h-12 px-7 text-base font-semibold"><Link href="/signup">Coba gratis 14 hari <ArrowRight className="ml-1" /></Link></Button>
              <Button asChild variant="outline" size="lg" className="h-12 px-7 text-base"><a href="#tur">Lihat cara kerjanya</a></Button>
            </motion.div>
            <motion.p initial="hidden" animate="show" custom={4} variants={rise} className="mt-4 text-xs text-muted-foreground">Tanpa kartu kredit. Tidak ada jaminan bebas blokir, dan kami tidak menjanjikannya.</motion.p>
          </div>

          <motion.div style={{ y: demoY }} initial="hidden" animate="show" custom={5} variants={rise} className="relative mx-auto max-w-2xl px-6 pb-20">
            <HeroDemo />
          </motion.div>
          <UseCaseMarquee />
        </section>

        {/* Tur produk: cream = tenang, manusiawi */}
        <Section tone="cream" id="tur">
          <Heading eyebrow="Tampilan asli" title="Dari daftar sampai siap kirim, sekitar 5 menit" text="Bukan mockup. Anda dituntun satu langkah demi satu langkah, tanpa perlu membaca dokumentasi dulu." />
          <div className="mt-12"><ProductTour /></div>
        </Section>

        {/* Perlindungan: mint = rasa aman */}
        <Section tone="mint" id="features">
          <Heading eyebrow="Keamanan nomor" title="Dibuat untuk keandalan, bukan sekadar kecepatan" />
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div key={f.title} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} custom={i} variants={rise}
                className={cn("group rounded-2xl border bg-card p-7 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-elevated", f.span)}>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary"><f.icon className="h-5 w-5 text-primary" /></div>
                <h3 className="font-display mt-6 text-2xl">{f.title}</h3>
                <p className="mt-2 text-muted-foreground">{f.text}</p>
              </motion.div>
            ))}
          </div>
        </Section>

        {/* Pemanasan: sand = hangat, sabar, bertahap */}
        <Section tone="sand">
          <Heading eyebrow="Pemanasan" title="Nomor baru dilatih dulu, bukan langsung dipakai penuh" text="Batas kirim naik bertahap. Balasan ke orang yang menulis lebih dulu selalu diperbolehkan sejak hari pertama." />
          <div className="mt-12"><WarmupFlow /></div>
        </Section>

        {/* Skor: indigo = analitis, wawasan */}
        <Section tone="indigo">
          <Heading eyebrow="Skor kesiapan" title="Lihat kesehatan nomor, bukan menebak" text="Lima faktor dengan bobot yang jelas. Kalau datanya belum cukup, skor bilang belum yakin, bukan berpura-pura pasti." />
          <div className="mt-12"><ReadinessRing /></div>
        </Section>

        {/* Cara kerja: cream lagi, sticky scrollytelling */}
        <Section tone="cream">
          <Heading eyebrow="Mulai" title="Aktif dalam tiga langkah" />
          <div className="mt-8"><HowItWorks /></div>
        </Section>

        {/* Harga: sky = kepercayaan untuk keputusan uang. Angka muncul setelah operator menetapkan final. */}
        {plans.data && plans.data.length > 0 && (
          <Section tone="sky" id="harga">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <Heading eyebrow="Paket" title="Harga yang jelas, tanpa kejutan" text="Percobaan gratis 14 hari saat mendaftar. Pembayaran dikonfirmasi manual oleh penyedia layanan." />
              <CycleToggle value={cycle} onChange={setCycle} />
            </div>
            <div className="mt-10"><PlanCards plans={plans.data} cycle={cycle} /></div>
          </Section>
        )}

        {/* Penutup: kembali ke ink + coral */}
        <section data-tone className="tone-ink">
          <div className="mx-auto max-w-4xl px-6 py-28 text-center md:py-36">
            <motion.h2 initial="hidden" whileInView="show" viewport={{ once: true }} variants={rise} className="font-display text-4xl leading-[1.1] md:text-6xl">Siap mengirim pesan pertama?</motion.h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">Buat akun, sambungkan nomor, dan mulai mengirim dalam hitungan menit.</p>
            <Button asChild size="lg" className="mt-9 h-12 px-8 text-base font-semibold"><Link href="/signup">Buat akun gratis <ArrowRight className="ml-1" /></Link></Button>
          </div>
          <footer className="mx-auto max-w-7xl border-t px-6 py-8 text-sm text-muted-foreground">© {new Date().getFullYear()} WA Gateway</footer>
        </section>
      </main>
    </Stage>
  );
}
