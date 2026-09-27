import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

// Public marketing and docs pages are open to search engines and AI crawlers on purpose; the app is not.
const PRIVATE = ["/dashboard", "/devices", "/messages", "/broadcast", "/contacts", "/analytics", "/settings", "/developers", "/team", "/activity", "/billing", "/invite", "/login", "/signup", "/operator", "/api", "/auth"];
const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Google-Extended", "Applebot-Extended", "CCBot"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      ...AI_BOTS.map((userAgent) => ({ userAgent, allow: ["/", "/llms.txt"], disallow: PRIVATE })),
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
