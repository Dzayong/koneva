export { cn } from "cn";

import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";
import type {
  DeviceStatus,
  HealthConfig,
  MessageStatus,
  StatusConfig,
} from "./types";

const DEVICE_STATUS_CONFIG: Record<DeviceStatus, StatusConfig> = {
  online: { label: "Online", color: "text-green-700", bgColor: "bg-green-100" },
  offline: { label: "Offline", color: "text-gray-600", bgColor: "bg-gray-100" },
  starting: { label: "Starting", color: "text-blue-600", bgColor: "bg-blue-100" },
  pending_qr: { label: "Pending QR", color: "text-amber-600", bgColor: "bg-amber-100" },
  paused: { label: "Paused", color: "text-yellow-600", bgColor: "bg-yellow-100" },
  banned: { label: "Banned", color: "text-red-700", bgColor: "bg-red-100" },
  error: { label: "Error", color: "text-orange-600", bgColor: "bg-orange-100" },
};

export function getDeviceStatusConfig(status: DeviceStatus): StatusConfig {
  return DEVICE_STATUS_CONFIG[status];
}

const MESSAGE_STATUS_CONFIG: Record<MessageStatus, StatusConfig> = {
  queued: { label: "Queued", color: "text-gray-600", bgColor: "bg-gray-100" },
  sending: { label: "Sending", color: "text-blue-600", bgColor: "bg-blue-100" },
  sent: { label: "Sent", color: "text-green-600", bgColor: "bg-green-100" },
  delivered: { label: "Delivered", color: "text-green-700", bgColor: "bg-green-100" },
  read: { label: "Read", color: "text-blue-700", bgColor: "bg-blue-100" },
  failed: { label: "Failed", color: "text-red-600", bgColor: "bg-red-100" },
  blocked: { label: "Blocked", color: "text-red-700", bgColor: "bg-red-100" },
};

export function getMessageStatusConfig(status: MessageStatus): StatusConfig {
  return MESSAGE_STATUS_CONFIG[status];
}

export function getHealthConfig(score: number): HealthConfig {
  if (score >= 80) {
    return {
      level: "excellent",
      label: "Excellent",
      color: "text-green-700",
      bgColor: "bg-green-100",
      barColor: "bg-green-500",
    };
  }
  if (score >= 60) {
    return {
      level: "good",
      label: "Good",
      color: "text-lime-600",
      bgColor: "bg-lime-100",
      barColor: "bg-lime-500",
    };
  }
  if (score >= 40) {
    return {
      level: "fair",
      label: "Fair",
      color: "text-amber-600",
      bgColor: "bg-amber-100",
      barColor: "bg-amber-500",
    };
  }
  if (score >= 20) {
    return {
      level: "poor",
      label: "Poor",
      color: "text-orange-600",
      bgColor: "bg-orange-100",
      barColor: "bg-orange-500",
    };
  }
  return {
    level: "critical",
    label: "Critical",
    color: "text-red-700",
    bgColor: "bg-red-100",
    barColor: "bg-red-500",
  };
}

export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isToday(d)) return `Today, ${format(d, "HH:mm")}`;
  if (isYesterday(d)) return `Yesterday, ${format(d, "HH:mm")}`;
  return format(d, "dd MMM yyyy, HH:mm");
}

export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatDistanceToNow(d, { addSuffix: true });
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
