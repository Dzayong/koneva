"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import {
  ArrowRight,
  BellRing,
  CheckCheck,
  Gauge,
  KeyRound,
  ShieldCheck,
  Smartphone,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroDemo } from "@/components/marketing/hero-demo";
import { ReadinessRing } from "@/components/marketing/readiness-ring";
import { UseCaseMarquee } from "@/components/marketing/use-case-marquee";
import { WarmupFlow } from "@/components/marketing/warmup-flow";
import { CycleToggle, PlanCards } from "@/components/billing/plan-cards";
import { usePublicPlans } from "@/hooks/use-billing";
import type { BillingCycle } from "@/lib/types";
import { cn } from "@/lib/utils";

const entrance: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.24, ease: "easeOut" },
  }),
};

// Bento tiles — every claim maps to a shipped backend capability.
const FEATURES = [
  {
    icon: Smartphone,
    title: "Banyak nomor, banyak workspace",
    text: "Satu workspace bisa punya beberapa nomor WhatsApp. Setiap nomor berjalan terpisah dengan sesinya sendiri.",
    span: "md:col-span-2",
  },
  {
    icon: ShieldCheck,
    title: "Perlindungan nomor",
    text: "Pemanasan bertahap, jeda seperti orang, batas kirim harian, dan filter isi sebelum pesan dikirim. Mengurangi risiko, tidak menjamin bebas blokir.",
    span: "",
  },
  {
    icon: CheckCheck,
    title: "Status terkirim dan dibaca",
    text: "Pantau tiap pesan dari antre sampai dibaca, lengkap dengan waktunya.",
    span: "",
  },
  {
    icon: BellRing,
    title: "Webhook bertanda tangan",
    text: "Kabar dikirim ke server Anda dengan tanda tangan HMAC yang bisa diverifikasi, termasuk saat nomor bermasalah.",
    span: "",
  },
  {
    icon: Gauge,
    title: "Skor kesiapan nomor",
    text: "Lihat sekilas nomor mana yang sehat, sebelum WhatsApp yang memberi tahu Anda.",
    span: "md:col-span-2",
  },
] as const;

const STEPS = [
  { icon: KeyRound, title: "Buat akun", text: "Daftar dengan email dan langsung mendapat workspace uji coba." },
  { icon: Smartphone, title: "Sambungkan nomor", text: "Tambahkan nomor lalu pindai kode QR dari WhatsApp." },
  { icon: Zap, title: "Kirim pesan", text: "Panggil POST /api/v1/message/send dan pantau statusnya langsung." },
] as const;

export default function WelcomePage() {
  const reduceMotion = useReducedMotion();
  const plans = usePublicPlans();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const rise: Variants = reduceMotion
    ? { hidden: { opacity: 1, y: 0 }, show: { opacity: 1, y: 0, transition: { duration: 0 } } }
    : entrance;
  return (
    <main className="relative min-h-screen overflow-hidden">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center bg-primary rounded-xl shadow-md">
            <Zap className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-semibold">WA Gateway</span>
        </div>
        <Button asChild variant="outline">
          <Link href="/login">Masuk</Link>
        </Button>
      </header>

      {/* Hero */}
      <section className="relative mx-auto max-w-7xl px-6 pt-12 pb-16 md:pt-20 md:pb-24">
        <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[520px] [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_72%)]" />
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <motion.p initial="hidden" animate="show" variants={rise} className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />Jalur non-resmi, risikonya kami jelaskan terbuka
            </motion.p>
            <motion.h1 initial="hidden" animate="show" custom={1} variants={rise} className="mt-5 text-5xl leading-[1.04] font-semibold tracking-tight sm:text-6xl">
              Kirim WhatsApp lewat API,<br /><span className="text-primary">dengan nomor Anda sendiri.</span>
            </motion.h1>
            <motion.p initial="hidden" animate="show" custom={2} variants={rise} className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Pindai QR, ambil kunci API, kirim pesan. Nomor dijaga dengan pemanasan bertahap, jeda seperti orang, dan skor kesiapan, supaya Anda tahu kondisinya sebelum WhatsApp yang memberi tahu.
            </motion.p>
            <motion.div initial="hidden" animate="show" custom={3} variants={rise} className="mt-9 flex flex-wrap gap-3">
              <Button asChild size="lg" className="h-11 px-6 text-base"><Link href="/signup">Coba gratis 14 hari <ArrowRight className="ml-1" /></Link></Button>
              <Button asChild variant="outline" size="lg" className="h-11 px-6 text-base"><a href="#features">Lihat cara kerjanya</a></Button>
            </motion.div>
            <motion.p initial="hidden" animate="show" custom={4} variants={rise} className="mt-4 text-xs text-muted-foreground">Tanpa kartu kredit. Tidak ada jaminan bebas blokir, dan kami tidak menjanjikannya.</motion.p>
          </div>
          <motion.div initial="hidden" animate="show" custom={3} variants={rise}><HeroDemo /></motion.div>
        </div>
      </section>

      <UseCaseMarquee />

      {/* Features — bento */}
      <section id="features" className="mx-auto max-w-7xl scroll-mt-8 px-6 pt-24 pb-24">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Dibuat untuk keandalan</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-60px" }}
              custom={i}
              variants={rise}
                            className={cn(
                "group relative overflow-hidden rounded-2xl border bg-card p-7 shadow-card transition-all hover:shadow-elevated hover:border-primary/20",
                f.span,
              )}
            >
              <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="relative mt-6 text-xl font-semibold">{f.title}</h3>
              <p className="relative mt-2 text-muted-foreground">{f.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Nomor aman: pemanasan */}
      <section className="mx-auto max-w-7xl px-6 pt-24 pb-24">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Nomor baru dilatih dulu, bukan langsung dipakai penuh</h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">Batas kirim naik bertahap. Balasan ke orang yang menulis lebih dulu selalu diperbolehkan sejak hari pertama.</p>
        <div className="mt-10"><WarmupFlow /></div>
      </section>

      {/* Skor kesiapan */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Lihat kesehatan nomor, bukan menebak</h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">Lima faktor dengan bobot yang jelas. Kalau datanya belum cukup, skor bilang belum yakin, bukan berpura-pura pasti.</p>
        <div className="mt-10"><ReadinessRing /></div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Aktif dalam tiga langkah</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.title}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              custom={i}
              variants={rise}
              className="rounded-2xl border p-7"
            >
              <span className="text-figure text-primary">0{i + 1}</span>
              <h3 className="mt-4 flex items-center gap-2 text-lg font-semibold">
                <s.icon className="h-5 w-5 text-primary" />
                {s.title}
              </h3>
              <p className="mt-2 text-muted-foreground">{s.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Harga: hanya paket yang dipublikasikan; angka muncul setelah operator menetapkannya final */}
      {plans.data && plans.data.length > 0 && (
        <section id="harga" className="mx-auto max-w-7xl scroll-mt-8 px-6 pb-24">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Paket</h2>
              <p className="mt-1 text-muted-foreground">Percobaan gratis 14 hari saat mendaftar. Pembayaran dikonfirmasi manual oleh penyedia layanan.</p>
            </div>
            <CycleToggle value={cycle} onChange={setCycle} />
          </div>
          <div className="mt-6"><PlanCards plans={plans.data} cycle={cycle} /></div>
        </section>
      )}

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          variants={rise}
          className="relative overflow-hidden rounded-3xl bg-sidebar p-10 text-sidebar-accent-foreground md:p-16"
        >
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight md:text-5xl">
            Siap mengirim pesan pertama?
          </h2>
          <p className="mt-4 max-w-xl text-white/80">
            Buat akun, sambungkan nomor, dan mulai mengirim dalam hitungan menit.
          </p>
          <Button asChild size="lg" className="mt-8 h-11 bg-white px-6 text-base text-black hover:bg-white/90">
            <Link href="/signup">
              Buat akun <ArrowRight className="ml-1" />
            </Link>
          </Button>
        </motion.div>
      </section>

      <footer className="mx-auto max-w-7xl border-t px-6 py-8 text-sm text-muted-foreground">
        © {new Date().getFullYear()} WA Gateway
      </footer>
    </main>
  );
}
