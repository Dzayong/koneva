import type { Role } from "@/lib/types";

/**
 * Customer access model: Owner and Developer. `admin` and `viewer` exist only in old data (kept with their historical access,
 * never offered or assigned any more). The KONEVA system administrator is a separate operator account, not a role here.
 */
export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  developer: "Developer",
  admin: "Admin (lama)",
  viewer: "Viewer (lama)",
};

export const ROLE_HELP: Record<Role, string> = {
  owner: "Pemilik workspace (satu per workspace). Mengurus paket, tagihan, tim, dan semua yang bisa dilakukan Developer.",
  developer: "Mengurus integrasi teknis: menambah, mengatur, menghubungkan, menjeda, dan menghapus nomor, memakai API, kunci, dan webhook. Tidak bisa mengurus tagihan atau tim.",
  admin: "Peran lama: akses historis tetap berlaku (semua kecuali tagihan), tidak bisa lagi diberikan atau mengundang.",
  viewer: "Peran lama: hanya melihat nomor dan pesan. Tidak bisa lagi diberikan.",
};

export const isLegacyRole = (role: Role): boolean => role === "admin" || role === "viewer";

/** Only Owner can act on the team, and the only thing to assign is Developer. */
export const canManageTeam = (actor: Role | undefined): boolean => actor === "owner";
