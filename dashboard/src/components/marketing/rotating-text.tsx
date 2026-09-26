"use client";

import { useEffect, useState } from "react";

const WORDS = ["kode OTP", "notifikasi pesanan", "pengingat jadwal", "tagihan", "balasan CS"];
const TYPE_MS = 70;
const DELETE_MS = 38;
const HOLD_MS = 1500;

/** Types a word, holds, deletes, moves on. Runs regardless of OS motion settings: it is short text, not movement. */
export function RotatingText() {
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const word = WORDS[i] ?? "";

  useEffect(() => {
    let delay = deleting ? DELETE_MS : TYPE_MS;
    if (!deleting && n === word.length) delay = HOLD_MS;
    const id = setTimeout(() => {
      if (!deleting && n < word.length) setN(n + 1);
      else if (!deleting) setDeleting(true);
      else if (n > 0) setN(n - 1);
      else { setDeleting(false); setI((i + 1) % WORDS.length); }
    }, delay);
    return () => clearTimeout(id);
  }, [n, deleting, word, i]);

  // The longest phrase is laid out invisibly so the headline always occupies the same lines: no jump under the CTA.
  const longest = WORDS.reduce((a, b) => (b.length > a.length ? b : a), "");
  return (
    <span className="text-brand-gradient grid lg:inline-grid" aria-label={WORDS.join(", ")}>
      <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-nowrap select-none">{longest}</span>
      <span aria-hidden className="col-start-1 row-start-1 whitespace-nowrap">{word.slice(0, n)}
      <span aria-hidden className="caret keep-motion ml-0.5 inline-block w-[0.06em] translate-y-[0.06em] bg-current align-baseline" style={{ height: "0.9em", background: "var(--brand-to)" }} /></span>
    </span>
  );
}
