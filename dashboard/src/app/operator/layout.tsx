import type { Metadata } from "next";

// Operator pages are never for search engines or shared caches. (noindex is not access control: the server decides who may see data.)
export const metadata: Metadata = { title: "Panel Operator", robots: { index: false, follow: false } };

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
