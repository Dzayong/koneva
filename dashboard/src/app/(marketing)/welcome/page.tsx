"use client";

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
    title: "Multi-device, multi-tenant",
    text: "One API key per tenant, many WhatsApp numbers each. Every device runs isolated with its own session.",
    span: "md:col-span-2",
  },
  {
    icon: ShieldCheck,
    title: "Anti-ban protection",
    text: "Warm-up schedule, per-minute and per-hour rate limits, and content filtering before anything is sent.",
    span: "",
  },
  {
    icon: CheckCheck,
    title: "Delivery & read receipts",
    text: "Track every message from queued to read, with timestamps.",
    span: "",
  },
  {
    icon: BellRing,
    title: "Signed webhooks",
    text: "Events pushed to your server with an HMAC signature you can verify.",
    span: "",
  },
  {
    icon: Gauge,
    title: "Device health score",
    text: "See which numbers are healthy at a glance, before WhatsApp does it for you.",
    span: "md:col-span-2",
  },
] as const;

const STEPS = [
  { icon: KeyRound, title: "Get your API key", text: "Sign in to the dashboard with your tenant key." },
  { icon: Smartphone, title: "Add a device", text: "Create a device and scan the QR from WhatsApp." },
  { icon: Zap, title: "Send messages", text: "Call POST /api/v1/message/send and watch delivery live." },
] as const;

export default function WelcomePage() {
  const reduceMotion = useReducedMotion();
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
          <Link href="/login">Sign in</Link>
        </Button>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-6 pt-16 pb-24 md:pt-28 md:pb-36">
        <motion.h1
          initial="hidden"
          animate="show"
          variants={rise}
          className="max-w-4xl text-5xl leading-[1.05] font-semibold tracking-tight sm:text-6xl md:text-7xl"
        >
          <span className="text-primary">WhatsApp API</span>
          <br />
          for modern business.
        </motion.h1>
        <motion.p
          initial="hidden"
          animate="show"
          custom={2}
          variants={rise}
          className="mt-6 max-w-2xl text-lg font-medium leading-relaxed text-muted-foreground md:text-xl"
        >
          Multi-device sending, anti-ban protection, delivery tracking and a dashboard that stays out
          of your way. Scale your messaging without babysitting it.
        </motion.p>
        <motion.div
          initial="hidden"
          animate="show"
          custom={4}
          variants={rise}
          className="mt-10 flex flex-wrap gap-4"
        >
          <Button asChild size="lg" className="h-11 px-6 text-base">
            <Link href="/login">
              Open dashboard <ArrowRight className="ml-1" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="h-11 px-6 text-base">
            <a href="#features">See features</a>
          </Button>
        </motion.div>
      </section>

      {/* Features — bento */}
      <section id="features" className="mx-auto max-w-7xl scroll-mt-8 px-6 pb-24">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Built for reliability</h2>
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

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Live in three steps</h2>
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
            Ready to send your first message?
          </h2>
          <p className="mt-4 max-w-xl text-white/80">
            Sign in with your API key, connect a device and you&apos;re sending in minutes.
          </p>
          <Button asChild size="lg" className="mt-8 h-11 bg-white px-6 text-base text-black hover:bg-white/90">
            <Link href="/login">
              Get started <ArrowRight className="ml-1" />
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
