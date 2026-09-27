"use client";

import { OperatorShell } from "@/components/operator/operator-shell";

export default function OperatorPanelLayout({ children }: { children: React.ReactNode }) {
  return <OperatorShell>{children}</OperatorShell>;
}
