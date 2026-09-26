export { cn } from "cn";

import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import type {
  DeviceStatus,
  HealthConfig,
  MessageStatus,
  StatusConfig,
} from "./types";

const DEVICE_STATUS_CONFIG: Record<DeviceStatus, StatusConfig> = {
  online: { label: "Online", color: "text-green-700", bgColor: "bg-green-100" },
  offline: { label: "Offline", color: "text-gray-600", bgColor: "bg-gray-100" },
  starting: { label: "Memulai", color: "text-blue-600", bgColor: "bg-blue-100" },
  pending_qr: { label: "Menunggu QR", color: "text-amber-600", bgColor: "bg-amber-100" },
  paused: { label: "Dijeda", color: "text-yellow-600", bgColor: "bg-yellow-100" },
  banned: { label: "Ditolak WhatsApp", color: "text-red-700", bgColor: "bg-red-100" },
  error: { label: "Error", color: "text-orange-600", bgColor: "bg-orange-100" },
};

export function getDeviceStatusConfig(status: DeviceStatus): StatusConfig {
  return DEVICE_STATUS_CONFIG[status];
}

const MESSAGE_STATUS_CONFIG: Record<MessageStatus, StatusConfig> = {
  queued: { label: "Antre", color: "text-gray-600", bgColor: "bg-gray-100" },
  sending: { label: "Mengirim", color: "text-blue-600", bgColor: "bg-blue-100" },
  sent: { label: "Terkirim", color: "text-green-600", bgColor: "bg-green-100" },
  delivered: { label: "Sampai", color: "text-green-700", bgColor: "bg-green-100" },
  read: { label: "Dibaca", color: "text-blue-700", bgColor: "bg-blue-100" },
  failed: { label: "Gagal", color: "text-red-600", bgColor: "bg-red-100" },
  blocked: { label: "Ditahan", color: "text-red-700", bgColor: "bg-red-100" },
  received: { label: "Diterima", color: "text-cyan-700", bgColor: "bg-cyan-100" },
};

export function getMessageStatusConfig(status: MessageStatus): StatusConfig {
  return MESSAGE_STATUS_CONFIG[status];
}

export function getHealthConfig(score: number): HealthConfig {
  if (score >= 80) {
    return {
      level: "excellent",
      label: "Sangat baik",
      color: "text-green-700",
      bgColor: "bg-green-100",
      barColor: "bg-green-500",
    };
  }
  if (score >= 60) {
    return {
      level: "good",
      label: "Baik",
      color: "text-lime-600",
      bgColor: "bg-lime-100",
      barColor: "bg-lime-500",
    };
  }
  if (score >= 40) {
    return {
      level: "fair",
      label: "Cukup",
      color: "text-amber-600",
      bgColor: "bg-amber-100",
      barColor: "bg-amber-500",
    };
  }
  if (score >= 20) {
    return {
      level: "poor",
      label: "Kurang",
      color: "text-orange-600",
      bgColor: "bg-orange-100",
      barColor: "bg-orange-500",
    };
  }
  return {
    level: "critical",
    label: "Kritis",
    color: "text-red-700",
    bgColor: "bg-red-100",
    barColor: "bg-red-500",
  };
}

export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isToday(d)) return `Hari ini, ${format(d, "HH:mm")}`;
  if (isYesterday(d)) return `Kemarin, ${format(d, "HH:mm")}`;
  return format(d, "dd MMM yyyy, HH:mm", { locale: idLocale });
}

export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatDistanceToNow(d, { addSuffix: true, locale: idLocale });
}

export function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("62") && digits.length >= 10) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 5)}-${digits.slice(5, 9)}-${digits.slice(9)}`;
  }
  return phone;
}

export function truncate(text: string, length = 50): string {
  if (text.length <= length) return text;
  return `${text.slice(0, length)}...`;
}

/** Compact "2m ago" / "1h ago" / "3d ago" for lists. */
export function formatShortRelative(date: string | Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 45) return "baru saja";
  if (seconds < 3600) return `${Math.round(seconds / 60)} mnt lalu`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} jam lalu`;
  if (seconds < 86400 * 30) return `${Math.round(seconds / 86400)} hari lalu`;
  return formatDate(date);
}
