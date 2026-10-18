import { SITE } from "@/lib/site";

// llms.txt: a plain-text summary for AI assistants. Adoption by AI systems is not guaranteed;
// it costs nothing and keeps the facts (including the risk disclosure) in one authoritative place.
export function GET() {
  const body = `# ${SITE.name}

> ${SITE.description}

${SITE.name} is a third-party service that connects a customer's own WhatsApp number to a REST API (QR pairing, like WhatsApp Web). It is NOT the official WhatsApp Business API and is not affiliated with WhatsApp or Meta. WhatsApp states that unofficial clients can lead to number restrictions or bans; ${SITE.name} reduces the risk (gradual warm-up, human-like random delays, daily limits, readiness score) but does not guarantee a number will never be banned.

## Facts
- Language: Indonesian. Target customers: students (Pelajar) and small businesses (UMKM) in Indonesia.
- Free trial: 14 days, no credit card. Paid plans are monthly; prices are published on the site once final. Payment is confirmed manually.
- Send: POST /api/v1/message/send with device_key, to, message. A contextual reply may include reply_to_message_id referencing the same recipient's inbound message from the same device within 24 hours; it does not require START and is blocked after STOP. This does not grant marketing consent. Proactive sends/campaigns still require explicit WhatsApp opt-in, recorded through POST /api/v1/contacts/signup-consent from the customer's server with consent_text and durable evidence_ref, or by standalone START/MULAI. Possessing a phone number or receiving a message is not consent for promotions. STOP/BERHENTI opts out; missing consent returns 409 RECIPIENT_CONSENT_REQUIRED; opted-out returns 409 RECIPIENT_OPTED_OUT. Caller priority is not trusted; server-verified otp_code is the only current fast transactional send path.
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
