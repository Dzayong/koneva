import type { CodeTab } from "./code-block";

/** Verify against the RAW request body: re-serialising parsed JSON changes bytes and breaks the signature. */
export const VERIFY_SNIPPETS: CodeTab[] = [
  {
    id: "node", label: "Node.js (Express)",
    code: `import crypto from "node:crypto";
import express from "express";

const app = express();
const SECRET = process.env.WEBHOOK_SECRET; // whsec_...

// Penting: baca body mentah, bukan hasil parse JSON.
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const expected = crypto.createHmac("sha256", SECRET).update(req.body).digest("hex");
  const received = (req.get("X-Webhook-Signature") || "").replace("sha256=", "");

  const ok =
    received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  if (!ok) return res.status(401).send("invalid signature");

  const event = JSON.parse(req.body.toString());
  // Balas 200 dulu, kerjakan yang berat belakangan.
  res.sendStatus(200);

  if (event.event === "message.received") {
    console.log("Pesan masuk dari", event.from, ":", event.content);
  }
});

app.listen(3000);`,
  },
  {
    id: "python", label: "Python (Flask)",
    code: `import hashlib, hmac, os
from flask import Flask, request, abort

app = Flask(__name__)
SECRET = os.environ["WEBHOOK_SECRET"].encode()  # whsec_...

@app.post("/webhook")
def webhook():
    raw = request.get_data()  # body mentah
    expected = hmac.new(SECRET, raw, hashlib.sha256).hexdigest()
    received = request.headers.get("X-Webhook-Signature", "").removeprefix("sha256=")
    if not hmac.compare_digest(received, expected):
        abort(401)

    event = request.get_json()
    if event["event"] == "message.received":
        print("Pesan masuk dari", event["from"], ":", event["content"])
    return "", 200`,
  },
  {
    id: "php", label: "PHP",
    code: `<?php
$secret = getenv('WEBHOOK_SECRET'); // whsec_...
$raw = file_get_contents('php://input'); // body mentah

$expected = hash_hmac('sha256', $raw, $secret);
$received = str_replace('sha256=', '', $_SERVER['HTTP_X_WEBHOOK_SIGNATURE'] ?? '');

if (!hash_equals($expected, $received)) {
    http_response_code(401);
    exit('invalid signature');
}

$event = json_decode($raw, true);
http_response_code(200);

if ($event['event'] === 'message.received') {
    error_log('Pesan masuk dari ' . $event['from'] . ': ' . $event['content']);
}`,
  },
];

export const EXAMPLE_PAYLOADS: CodeTab[] = [
  { id: "delivered", label: "Pesan terkirim / dibaca", code: `{
  "event": "message.delivered",
  "device_key": "WAPI-XXXXXXXX",
  "message_id": "9380ccc2-9098-4c1e-8a0e-1f0f0d6f6a11",
  "whatsapp_message_id": "3EB0C767D0A1",
  "to": "6281234567890",
  "status": "delivered",
  "timestamp": "2026-09-26T10:30:00.000Z"
}` },
  { id: "received", label: "Pesan masuk", code: `{
  "event": "message.received",
  "device_key": "WAPI-XXXXXXXX",
  "message_id": "b1f0...",
  "whatsapp_message_id": "A5C1...",
  "from": "6281234567890",
  "content": "Halo, pesanan saya sudah sampai?",
  "direction": "inbound",
  "status": "received",
  "timestamp": "2026-09-26T10:31:12.000Z"
}` },
  { id: "device", label: "Nomor bermasalah", code: `{
  "event": "device.status_changed",
  "device_key": "WAPI-XXXXXXXX",
  "status": "banned",
  "previous_status": "online",
  "reason": "forbidden_403",
  "code": 403,
  "timestamp": "2026-09-26T10:42:55.254Z"
}` },
];

export const EVENTS: Array<{ name: string; when: string; todo: string }> = [
  { name: "message.sent", when: "Pesan sudah keluar dari nomor Anda", todo: "Tandai pesanan/notifikasi sebagai dikirim" },
  { name: "message.delivered", when: "Pesan sampai di HP penerima", todo: "Anggap OTP atau notifikasi tersampaikan" },
  { name: "message.read", when: "Penerima membuka pesan", todo: "Opsional: hentikan pengingat berikutnya" },
  { name: "message.failed", when: "Pesan gagal setelah dicoba ulang", todo: "Beri tahu pengguna atau kirim lewat jalur lain (SMS/email)" },
  { name: "message.received", when: "Ada yang membalas atau menulis ke nomor Anda", todo: "Simpan, balas, atau teruskan ke tim CS" },
  { name: "device.status_changed", when: "Status nomor berubah (online, offline, keluar, diblokir)", todo: "Hentikan pengiriman dan beri tahu tim jika status banned/logged_out" },
  { name: "webhook.test", when: "Anda menekan tombol Kirim tes", todo: "Cukup balas 200" },
];
