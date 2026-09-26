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

  return (
    <span className="text-brand-gradient" aria-label={WORDS.join(", ")}>
      <span aria-hidden>{word.slice(0, n)}</span>
      <span aria-hidden className="caret ml-0.5 inline-block w-[0.06em] translate-y-[0.06em] bg-current align-baseline" style={{ height: "0.9em", background: "var(--brand-to)" }} />
    </span>
  );
}
