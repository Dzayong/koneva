// Contacts live in this browser's localStorage only — there is no
// `contacts` table or endpoint in the backend yet (see dashboard/README.md
// "Known gaps"). This is a real, working feature for single-device use;
// it just doesn't sync across devices/browsers or tenants' team members.

export interface Contact {
  id: string;
  name: string;
  phone: string;
}

const STORAGE_KEY = "wa_gateway_contacts";

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function getContacts(): Contact[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as Contact[];
  } catch {
    return [];
  }
}

function persist(contacts: Contact[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
}

export function addContacts(newOnes: Array<{ name: string; phone: string }>): Contact[] {
  const existing = getContacts();
  const existingPhones = new Set(existing.map((c) => digitsOnly(c.phone)));
  const additions: Contact[] = [];

  for (const entry of newOnes) {
    const phone = digitsOnly(entry.phone);
    if (!phone || existingPhones.has(phone)) continue;
    existingPhones.add(phone);
    additions.push({ id: crypto.randomUUID(), name: entry.name.trim() || phone, phone });
  }

  const merged = [...existing, ...additions];
  persist(merged);
  return merged;
}

export function removeContact(id: string): Contact[] {
  const remaining = getContacts().filter((c) => c.id !== id);
  persist(remaining);
  return remaining;
}

export function clearContacts(): void {
  persist([]);
}

export interface ParseCsvResult {
  rows: Array<{ name: string; phone: string }>;
  skipped: number;
}

/**
 * Minimal CSV parser: expects a header row containing `name` and `phone`
 * columns (case-insensitive, any order); no quoted-comma support since
 * contact exports (name, phone) essentially never need it.
 */
export function parseContactsCsv(text: string): ParseCsvResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { rows: [], skipped: 0 };

  const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  const phoneIdx = header.indexOf("phone");

  if (phoneIdx === -1) {
    return { rows: [], skipped: lines.length - 1 };
  }

  const rows: Array<{ name: string; phone: string }> = [];
  let skipped = 0;

  for (const line of lines.slice(1)) {
    const cols = line.split(",").map((c) => c.trim());
    const phone = cols[phoneIdx] ?? "";
    if (!digitsOnly(phone)) {
      skipped += 1;
      continue;
    }
    rows.push({ name: nameIdx >= 0 ? (cols[nameIdx] ?? "") : "", phone });
  }

  return { rows, skipped };
}
