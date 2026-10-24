import type { Role } from "@/lib/types";

/**
 * Customer access model: Owner, Developer, and inbox-only Customer Service. `admin` and `viewer` remain legacy roles.
 */
export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  developer: "Developer",
  admin: "Admin (lama)",
  viewer: "Viewer (lama)",
  cs: "Customer Service",
};

export const ROLE_HELP: Record<Role, string> = {
  owner: "Pemilik workspace (satu per workspace). Mengurus paket, tagihan, tim, dan semua yang bisa dilakukan Developer.",
  developer: "Mengurus integrasi teknis: menambah, mengatur, menghubungkan, menjeda, dan menghapus nomor, memakai API, kunci, dan webhook. Tidak bisa mengurus tagihan atau tim.",
  admin: "Peran lama: akses historis tetap berlaku (semua kecuali tagihan), tidak bisa lagi diberikan atau mengundang.",
  viewer: "Peran lama: hanya melihat nomor dan pesan. Tidak bisa lagi diberikan.",
  cs: "Hanya dapat membaca dan membalas percakapan dari semua device yang terhubung. Tidak dapat mengirim broadcast atau mengubah pengaturan.",
};

export const isLegacyRole = (role: Role): boolean => role === "admin" || role === "viewer";

/** Only Owner can act on the team. */
export const canManageTeam = (actor: Role | undefined): boolean => actor === "owner";
