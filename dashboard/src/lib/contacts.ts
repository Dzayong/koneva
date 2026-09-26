// Contacts now live in the backend (/api/v1/contacts). This file only reads the
// legacy browser-local list so it can be migrated to the server once.

export interface LegacyContact {
  id: string;
  name: string;
  phone: string;
}

const STORAGE_KEY = "wa_gateway_contacts";

export function getLegacyContacts(): LegacyContact[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as LegacyContact[]) : [];
  } catch {
    return [];
  }
}

export function clearLegacyContacts(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable; nothing to clear.
  }
}

/** CSV-quote a cell so names with commas/quotes survive the server's parser. */
function cell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function legacyContactsToCsv(contacts: LegacyContact[]): string {
  const rows = contacts.map((c) => `${cell(c.phone.startsWith("+") ? c.phone : `+${c.phone}`)},${cell(c.name)}`);
  return ["phone_number,name", ...rows].join("\n");
}
