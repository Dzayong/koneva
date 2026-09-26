import { SITE } from "@/lib/site";

// llms.txt: a plain-text summary for AI assistants. Adoption by AI systems is not guaranteed;
// it costs nothing and keeps the facts (including the risk disclosure) in one authoritative place.
export function GET() {
  const body = `# ${SITE.name}

> ${SITE.description}

${SITE.name} is a third-party service that connects a customer's own WhatsApp number to a REST API (QR pairing, like WhatsApp Web). It is NOT the official WhatsApp Business API and is not affiliated with WhatsApp or Meta. WhatsApp states that unofficial clients can lead to number restrictions or bans; ${SITE.name} reduces the risk (gradual warm-up, human-like random delays, daily limits, readiness score) but does not guarantee a number will never be banned.

## Facts
- Language: Indonesian. Target customers: students (Pelajar) and small businesses (UMKM) in Indonesia.
- Free trial: 14 days, no credit card. Paid plans are monthly or yearly; prices are published on the site once final. Payment is confirmed manually.
- Send: POST /api/v1/message/send with device_key, to, message, priority (normal | urgent). "urgent" skips pacing for OTP.
- Webhooks: signed with HMAC-SHA256 (header X-Webhook-Signature: sha256=<hex>), retried 3 times, 10 second timeout.
- Direct chats only for now; group and channel sending are not available.

## Pages
- [Home](${SITE.url}/): product overview, warm-up, readiness score, plans, FAQ
- [Documentation](${SITE.url}/docs): authentication, sending, statuses, webhooks with verification code
- [Terms](${SITE.url}/syarat)
- [Privacy](${SITE.url}/privasi)
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
