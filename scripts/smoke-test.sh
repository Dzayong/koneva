#!/usr/bin/env bash
# Laptop/LAN smoke test for the KONEVA API: health/auth check -> (optional) one real send -> poll
# that same message's status. Safe by default: it NEVER sends unless you pass --confirm-send.
#
# Credential handling:
#   - The API key is read ONLY from the KONEVA_API_KEY environment variable. There is no --api-key
#     flag (shell history / `ps` would leak it), and this script never writes it to any file.
#   - Nothing here reads .env.personal or any repo secret file. You export the key yourself, in your
#     own shell, before running this script.
#
# Usage:
#   export KONEVA_API_KEY=wgk_...            # or a tenant's legacy key, during the transition window
#   scripts/smoke-test.sh --base-url https://192.168.1.4:13000 --device WAPI-XXXXXXXX --to 62812xxxxxxxx [--confirm-send]
#
# Without --confirm-send: only the health/auth check runs (step 1). No message is sent.
# With --confirm-send: sends exactly ONE message, then polls its status a few times. No retry.
set -euo pipefail

BASE_URL=""
DEVICE_KEY=""
TO=""
MESSAGE="Tes KONEVA smoke-test $(date -u +%H:%M:%S) UTC"
CONFIRM_SEND=0
INSECURE=0

usage() {
  cat >&2 <<'EOF'
usage: scripts/smoke-test.sh --base-url URL --device DEVICE_KEY --to NUMBER [--message TEXT] [--confirm-send] [--insecure]

  --base-url     e.g. https://192.168.1.4:13000 (dashboard LAN HTTPS, proxies /api/v1) or http://127.0.0.1:18000
  --device       device_key, e.g. WAPI-XXXXXXXX
  --to           recipient, digits only, country code first (no +), e.g. 62812xxxxxxxx
  --message      text to send (default: a short timestamped smoke-test line)
  --confirm-send actually send one message (default: health/auth check only, no send)
  --insecure     pass -k to curl (self-signed/mkcert LAN certs); only use on a trusted LAN

The API key is read from $KONEVA_API_KEY only. It is never accepted as a flag, never printed,
never written to any file by this script.
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --device) DEVICE_KEY="$2"; shift 2 ;;
    --to) TO="$2"; shift 2 ;;
    --message) MESSAGE="$2"; shift 2 ;;
    --confirm-send) CONFIRM_SEND=1; shift ;;
    --insecure) INSECURE=1; shift ;;
    -h|--help) usage ;;
    *) echo "Argumen tidak dikenal: $1" >&2; usage ;;
  esac
done

[[ -n "$BASE_URL" ]] || { echo "Wajib: --base-url" >&2; usage; }
[[ -n "${KONEVA_API_KEY:-}" ]] || { echo "Wajib: export KONEVA_API_KEY=... di shell Anda sendiri (tidak lewat flag)." >&2; exit 1; }

CURL_OPTS=(-sS --max-time 20)
[[ "$INSECURE" == 1 ]] && CURL_OPTS+=(-k)

mask_number() {
  local n="$1"
  [[ ${#n} -le 4 ]] && { echo "****"; return; }
  echo "****${n: -4}"
}

api() {
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl "${CURL_OPTS[@]}" -X "$method" "$BASE_URL$path" \
      -H "apikey: $KONEVA_API_KEY" -H "Content-Type: application/json" -d "$body"
  else
    curl "${CURL_OPTS[@]}" -X "$method" "$BASE_URL$path" -H "apikey: $KONEVA_API_KEY"
  fi
}

echo "== 1/3: health/auth check (GET /api/v1/tenant) =="
tenant_resp=$(api GET /api/v1/tenant || true)
tenant_ok=$(echo "$tenant_resp" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);console.log(j.success?"ok":"fail");}catch{console.log("fail")}})' 2>/dev/null || echo fail)
if [[ "$tenant_ok" != "ok" ]]; then
  echo "GAGAL: key tidak valid atau base-url tidak bisa dihubungi." >&2
  echo "$tenant_resp" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);console.error(JSON.stringify(j.error||j));}catch{console.error("(respons bukan JSON / tidak bisa dihubungi)")}})'
  exit 1
fi
echo "OK — key valid, tenant terautentikasi."

if [[ "$CONFIRM_SEND" != 1 ]]; then
  echo
  echo "Tidak mengirim apa pun (default). Tambahkan --confirm-send untuk mengirim satu pesan uji ke $(mask_number "${TO:-----}")."
  exit 0
fi

[[ -n "$DEVICE_KEY" ]] || { echo "Wajib: --device (untuk kirim nyata)" >&2; exit 1; }
[[ -n "$TO" ]] || { echo "Wajib: --to (untuk kirim nyata)" >&2; exit 1; }

echo
echo "== 2/3: mengirim SATU pesan nyata ke $(mask_number "$TO") lewat $DEVICE_KEY =="
echo "Isi: $MESSAGE"
send_body=$(node -e 'console.log(JSON.stringify({device_key:process.argv[1],to:process.argv[2],message:process.argv[3]}))' "$DEVICE_KEY" "$TO" "$MESSAGE")
send_resp=$(api POST /api/v1/message/send "$send_body")
send_json=$(echo "$send_resp" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{console.log(JSON.stringify(JSON.parse(d)))}catch{console.log("null")}})')

if [[ "$send_json" == "null" ]]; then
  echo "GAGAL: respons tidak bisa diparse." >&2
  exit 1
fi

error_code=$(echo "$send_json" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);console.log((j.error&&j.error.code)||"")})')
message_id=$(echo "$send_json" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);console.log((j.data&&j.data.message_id)||j.message_id||"")})')

case "$error_code" in
  RECIPIENT_CONSENT_REQUIRED)
    echo "DITOLAK (409 RECIPIENT_CONSENT_REQUIRED): penerima belum pernah mengirim MULAI/START ke nomor ini." >&2
    echo "Langkah: minta penerima kirim MULAI atau START ke nomor bisnis, lalu ulangi; atau catat consent" >&2
    echo "manual di menu Kontak (butuh source_note, hanya bisa lewat sesi login, bukan API key)." >&2
    echo "Skrip ini TIDAK mencoba melewati guard consent." >&2
    exit 2
    ;;
  RECIPIENT_OPTED_OUT)
    echo "DITOLAK (409 RECIPIENT_OPTED_OUT): penerima pernah kirim BERHENTI/STOP." >&2
    echo "Langkah: hanya penerima sendiri yang bisa kirim ulang MULAI/START untuk opt-in lagi." >&2
    exit 2
    ;;
  "")
    ;; # no error_code: either success or a shape we don't special-case below
  *)
    echo "DITOLAK ($error_code):" >&2
    echo "$send_json" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);console.error(JSON.stringify(j.error||j))})' >&2
    exit 2
    ;;
esac

if [[ -z "$message_id" ]]; then
  echo "GAGAL: tidak ada message_id dalam respons sukses." >&2
  echo "$send_json" >&2
  exit 1
fi
echo "Diterima ke antrean: message_id=$message_id"

echo
echo "== 3/3: poll status pesan yang sama (maks 6x, 3 detik, tanpa retry kirim) =="
for i in $(seq 1 6); do
  sleep 3
  detail=$(api GET "/api/v1/messages/$message_id")
  status=$(echo "$detail" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);console.log((j.data&&j.data.status)||"?")}catch{console.log("?")}})')
  err=$(echo "$detail" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);console.log((j.data&&j.data.error_message)||"")}catch{console.log("")}})')
  echo "  [$i/6] status=$status${err:+ error=$err}"
  case "$status" in sent|delivered|read|failed|blocked) break ;; esac
done
echo "Selesai. Lihat juga di dashboard: Pesan > cari message_id di atas."
