import { Badge } from "@/components/ui/badge";
import type { InvoiceStatus, StudentStatus } from "@/lib/operator/types";

const INVOICE: Record<InvoiceStatus, { label: string; variant: "default" | "secondary" | "outline" }> = {
  unpaid: { label: "Belum dibayar", variant: "secondary" }, paid: { label: "Lunas", variant: "default" }, void: { label: "Dibatalkan", variant: "outline" },
};
const STUDENT: Record<StudentStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pending: { label: "Menunggu", variant: "secondary" }, approved: { label: "Disetujui", variant: "default" },
  rejected: { label: "Ditolak / ditangguhkan", variant: "destructive" }, correction_required: { label: "Perlu perbaikan", variant: "secondary" },
  expired: { label: "Tenggat lewat", variant: "outline" }, superseded: { label: "Digantikan", variant: "outline" },
};

export const InvoiceStatusBadge = ({ status }: { status: InvoiceStatus }) => <Badge variant={INVOICE[status].variant}>{INVOICE[status].label}</Badge>;
export const StudentStatusBadge = ({ status }: { status: StudentStatus }) => <Badge variant={STUDENT[status].variant}>{STUDENT[status].label}</Badge>;
export const studentStatusLabel = (s: StudentStatus): string => STUDENT[s].label;
