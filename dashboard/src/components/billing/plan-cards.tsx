"use client";

import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BillingCycle, PublicPlan } from "@/lib/types";

export const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const num = (n: number) => n.toLocaleString("id-ID");

export function CycleToggle({ value, onChange }: { value: BillingCycle; onChange: (c: BillingCycle) => void }) {
  return (
    <div role="group" aria-label="Siklus tagihan" className="inline-flex rounded-lg border bg-muted p-1 text-sm">
      {(["monthly", "yearly"] as const).map((c) => (
        <button key={c} type="button" aria-pressed={value === c} onClick={() => onChange(c)}
          className={cn("rounded-md px-3 py-1.5 font-medium transition-colors", value === c ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {c === "monthly" ? "Bulanan" : "Tahunan"}
        </button>
      ))}
    </div>
  );
}

function priceLine(plan: PublicPlan, cycle: BillingCycle) {
  const price = cycle === "monthly" ? plan.price_month_idr : plan.price_year_idr;
  if (!plan.price_is_final || price === null) return { main: "Harga segera diumumkan", sub: null as string | null };
  const per = cycle === "monthly" ? "/bulan" : "/tahun";
  const saved = cycle === "yearly" && plan.price_month_idr ? plan.price_month_idr * 12 - price : 0;
  return { main: `${rupiah(price)}${per}`, sub: saved > 0 ? `Hemat ${rupiah(saved)} dibanding bulanan` : null };
}

interface Props {
  plans: PublicPlan[];
  cycle: BillingCycle;
  currentPlanId?: string;
  onChoose?: (plan: PublicPlan) => void;
  busyPlanId?: string | null;
  ctaLabel?: string;
}

export function PlanCards({ plans, cycle, currentPlanId, onChoose, busyPlanId, ctaLabel = "Pilih paket" }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {plans.map((plan) => {
        const { main, sub } = priceLine(plan, cycle);
        const current = plan.id === currentPlanId;
        return (
          <div key={plan.id} className={cn("flex flex-col rounded-xl border bg-card p-5", current && "border-primary ring-1 ring-primary")}>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              {current && <Badge>Paket Anda</Badge>}
              {plan.requires_student_verification && <Badge variant="secondary">Perlu verifikasi pelajar</Badge>}
            </div>
            <p className="mt-3 text-2xl font-semibold tracking-tight">{main}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              {(plan.features.length > 0 ? plan.features : [
                `${num(plan.max_devices)} nomor WhatsApp`,
                `${num(plan.monthly_messages)} pesan per bulan`,
                `${num(plan.max_members)} anggota tim`,
                            ]).map((f) => (
                <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{f}</li>
              ))}
            </ul>
            {onChoose && (
              <Button className="mt-5" variant={current ? "outline" : "default"} disabled={!plan.price_is_final || busyPlanId === plan.id} onClick={() => onChoose(plan)}>
                {!plan.price_is_final ? "Belum tersedia" : current ? "Perpanjang" : ctaLabel}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
