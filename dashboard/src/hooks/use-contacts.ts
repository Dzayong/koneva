"use client";

import { useCallback, useState } from "react";
import { addContacts, type Contact, getContacts, removeContact } from "@/lib/contacts";

export function useContacts() {
  // Lazy initializer: getContacts() already returns [] during SSR (no
  // `window`) and the real localStorage contents on client mount — no
  // effect needed, and no hydration mismatch since this list has no
  // meaningful server-rendered value to mismatch against.
  const [contacts, setContacts] = useState<Contact[]>(() => getContacts());

  const importContacts = useCallback((entries: Array<{ name: string; phone: string }>) => {
    setContacts(addContacts(entries));
  }, []);

  const remove = useCallback((id: string) => {
    setContacts(removeContact(id));
  }, []);

  return { contacts, importContacts, remove };
}
