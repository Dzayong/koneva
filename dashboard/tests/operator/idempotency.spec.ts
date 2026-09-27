import { expect, test } from "@playwright/test";
import { canonicalJson, IdempotencyGuard } from "../../src/lib/operator/idempotency";

// Pure logic: no browser involved.
test.describe("idempotency key rules", () => {
  const counter = () => { let n = 0; return () => `key-${++n}`; };

  test("canonical JSON ignores key order and undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] }, u: undefined })).toBe(canonicalJson({ a: { c: [1, { y: 2, z: 1 }], d: 2 }, b: 1 }));
  });

  test("same payload keeps the same key (safe retry)", () => {
    const g = new IdempotencyGuard(counter());
    const k1 = g.keyFor({ a: 1, b: { c: 2 } });
    expect(g.keyFor({ b: { c: 2 }, a: 1 })).toBe(k1);
  });

  test("a changed payload never reuses the old key", () => {
    const g = new IdempotencyGuard(counter());
    const k1 = g.keyFor({ reference: "A" });
    const k2 = g.keyFor({ reference: "B" });
    expect(k2).not.toBe(k1);
    expect(g.holds({ reference: "B" })).toBe(true);
    expect(g.holds({ reference: "A" })).toBe(false);
  });

  test("only an explicit reset discards the key", () => {
    const g = new IdempotencyGuard(counter());
    const k1 = g.keyFor({ x: 1 });
    expect(g.keyFor({ x: 1 })).toBe(k1);
    g.reset();
    expect(g.holds({ x: 1 })).toBe(false);
    expect(g.keyFor({ x: 1 })).not.toBe(k1);
  });
});
