# Cost-meter KONEVA: penemuan dan rancangan

Tanggal rancangan: 2026-09-27. **Status 2026-10-17: fondasi implementasi lokal tersedia; rancangan biaya dan angka masih belum tervalidasi.** Device Manager memiliki snapshot CPU/RAM cgroup Docker untuk bot KONEVA per-device dan layanan bersama Compose yang dikenali di jaringan KONEVA (`postgres`, `redis`, `api-gateway`, `device-manager`, `dashboard`, serta layanan opsional). Endpoint `/resources` memerlukan admin key; respons menandai tiap sampel sebagai `device` atau `shared` agar biaya layanan bersama tidak dibebankan ke satu device. Kubernetes menyatakan metrik unavailable tanpa Metrics Server. Belum ada sampling historis, rollup, benchmark sintetis, invoice aktual, ataupun perubahan harga/paket. Merujuk brief PM di `docs/research/2026-09-27-koneva/README.md` ("Brief pekerjaan berikutnya untuk Claude") dan `pricing.md` (asumsi biaya yang belum diukur).

## 1. Metrik yang sudah ada (inventarisasi, tanpa membangun ulang)

### 1.1 Prometheus di bot container (`src/bot-container/metrics.ts`)
Satu registry per proses bot (satu bot = satu device_key = satu container), diambil lewat `GET /metrics` (`bot-container/api.ts`, tanpa API key).

| Metrik | Label | Berguna untuk |
|---|---|---|
| `wa_bot_*` default Node (CPU, heap, event loop, dsb., prefix `wa_bot_`) | — | RAM/CPU proses (**bukan** RAM/CPU cgroup container; lihat gap 2.1) |
| `wa_bot_messages_sent_total`, `wa_bot_messages_failed_total` | `device_key`, `type`/`reason` | Volume pengiriman per device |
| `wa_bot_message_duration_seconds` | `device_key`, `outcome` | Latensi antrean sampai status akhir |
| `wa_bot_active_connections` | `device_key` | Waktu online (dasar biaya "sesi aktif") |
| `wa_bot_anti_ban_denials_total` | `device_key`, `reason` | Berapa sering pacing menahan kirim (bukan biaya, tapi indikasi beban) |
| `wa_bot_webhook_dispatch_total` | `event`, `outcome` | Volume webhook keluar |
| `wa_bot_queue_job_duration_seconds` | `device_key` | Waktu proses per job (CPU-time proxy) |

### 1.2 Kesehatan koneksi (`bot-container/health.ts`, `device-manager`)
`GET /health` per bot: status DB/Redis/WhatsApp (`healthy`/`degraded`/`unhealthy`), tapi **bukan** deret waktu reconnect — hanya snapshot kini. `device_events` (migrasi 008) menyimpan riwayat perubahan status (online/offline/banned/logged_out/error) per device dengan waktu, jadi frekuensi reconnect **bisa dihitung dari tabel ini tanpa metrik baru** (`COUNT(*) WHERE status IN ('offline','error') GROUP BY device_id, hari`).

### 1.3 Ukuran alokasi container (bukan pemakaian nyata)
- Docker (`device-manager/docker.ts`): `--memory 512m --memory-swap 512m --pids-limit 256`, **tanpa batas CPU**.
- Kubernetes (`device-manager/kubernetes.ts`): requests `cpu:100m, memory:256Mi`; limits `cpu:1, memory:1Gi`; storage sesi = `BOT_SESSION_STORAGE_SIZE` (default `1Gi`), satu PVC per device (StatefulSet).
- Ini adalah **batas atas yang dikonfigurasi**, tidak sama dengan pemakaian aktual — bedanya adalah inti pengukuran biaya nyata (lihat gap 2.1).

### 1.4 Yang bisa dihitung dari database tanpa metrik baru dan tanpa isi pesan
Semua ini hanya `COUNT(*)`, `pg_total_relation_size`, atau agregasi kolom non-konten, per `tenant_id`/`device_id`:

| Sumber | Apa yang didapat |
|---|---|
| `messages` (COUNT per status/direction/hari, per device) | Volume kirim/terima, tanpa membaca `content` |
| `pg_total_relation_size('messages')`, dst per tabel | Perkiraan storage; per-tenant butuh estimasi baris × ukuran rata-rata (lihat 2.2) |
| `webhook_logs` (COUNT, `retry_count`, `response_status`) | Volume dan tingkat gagal webhook |
| `device_commands` (COUNT per type/status) | Volume perintah device (status/profil) |
| `message_status_history` (COUNT per message_id) | Berapa kali status berubah — proxy jumlah update DB per pesan |
| `status_views` (COUNT) | Volume view status |
| `device_events` (COUNT per status, per device, per hari) | **Frekuensi reconnect/pause/banned tanpa metrik baru** |
| BullMQ (`Queue.getJobCounts()` di `queue.ts`/`message.service.ts`) | Panjang antrean saat ini (waiting/active/delayed/failed) per device — **belum dipanggil oleh siapa pun untuk observability**, tapi API-nya sudah dipakai untuk enqueue, jadi memanggilnya untuk baca saja adalah gap kecil, bukan fitur baru |
| Redis `INFO memory`, `DBSIZE` | Storage Redis keseluruhan (tidak per-tenant secara langsung; BullMQ key berisi `device_key`, bisa dihitung per prefix dengan `SCAN`) |

**Tidak ada isi pesan atau nomor pribadi yang dibutuhkan untuk semua ukuran di atas** — hanya count, status, dan ukuran baris.

## 2. Gap (yang belum ada, dan hanya ini yang perlu dibangun)

### 2.1 RAM/CPU **nyata per container**, bukan alokasi
`docker stats --no-stream` (atau `/sys/fs/cgroup/.../memory.current`, `cpu.stat`) per nama container (`wa-bot-<device_key>`) tidak pernah dikumpulkan. Metrik Prometheus bot mengukur proses Node di dalam container, bukan cgroup dari luar — dua hal berbeda (RSS Node vs total container termasuk V8, native libs, tmpfs). Ini satu-satunya observability infra yang benar-benar hilang; sisanya (1.1–1.4) sudah cukup untuk komponen volume/queue/storage.

### 2.2 Storage per tenant, bukan per tabel
`pg_total_relation_size` memberi ukuran tabel keseluruhan, bukan per `tenant_id` (tidak ada partisi/tablespace per tenant). Perkiraan per tenant harus dihitung: `(baris tenant / total baris) × ukuran tabel`, cukup akurat untuk model biaya kasar, tidak untuk invoice yang presisi per byte.

### 2.3 Tidak ada agregasi/rollup
Semua di atas adalah data mentah atau snapshot; belum ada job yang meringkas "per device per hari" ke satu tabel kecil untuk laporan cepat tanpa scan tabel besar berulang.

### 2.4 Tidak ada percobaan menit dukungan
"Menit dukungan per device" (disebut di riset PM) sama sekali tidak terekam di sistem manapun — itu proses manusia (tiket, chat), bukan metrik aplikasi. Ini murni operasional, tidak butuh kode.

### 2.5 Retensi tak terbatas pada beberapa tabel (ditemukan saat audit ini, relevan untuk storage)
`messages`, `message_status_history`, `webhook_logs`, `status_views`, `device_events` **tidak punya job pembersihan sama sekali** (beda dengan `device_commands`, `otp_*`, dan tabel operator yang sudah punya retensi terjadwal, lihat `docs/OUTBOUND_CONTROLS.md` dan `operator/maintenance.ts`). Ini bukan bug fungsional, tapi berarti **biaya storage per tenant akan terus naik tanpa batas** kecuali diputuskan kebijakan retensi. Keputusan pemilik dibutuhkan sebelum menyelesaikan model biaya storage.

## 3. Rancangan biaya per device (kerangka, bukan angka final)

```
biaya_per_device/bulan =
    infra_container      (RAM+CPU teralokasi × harga per-unit hosting; ATAU RAM+CPU nyata rata-rata jika 2.1 dibangun)
  + storage_db            (perkiraan bagian tenant dari messages/webhook_logs/dst, lihat 2.2, × harga per-GB)
  + storage_sesi          (ukuran folder sesi Baileys per device, dapat diukur langsung dengan `du`, bukan estimasi)
  + traffic_keluar        (webhook + fetch media eksternal; volume dari wa_bot_webhook_dispatch_total dan messages.media_url)
  + biaya_pembayaran      (1% dari nilai transaksi, sudah dipakai di pricing.md — bukan biaya teknis)
  + cadangan_gangguan     (5% omzet, kebijakan finance, bukan metrik teknis)
  + menit_dukungan × tarif_per_menit   (data manusia, lihat 2.4; TIDAK bisa diukur dari sistem)
```

Ini kerangka rumus, bukan model harga: `pricing.md` sudah punya asumsi biaya infra (Rp600rb/2,2jt/4,4jt) dan support+variabel Rp15rb/device yang **belum diukur dari sistem nyata**. Tugas benchmark di bawah adalah mengisi rumus ini dengan angka yang benar-benar diukur, bukan menerbitkannya sebagai biaya final.

## 4. Rencana benchmark sintetis (tanpa nomor nyata, tanpa produksi)

Semua di lingkungan lokal/disposable yang sama seperti tes-tes sebelumnya (Postgres+Redis sementara), **berlabel eksplisit "sintetis"** agar tidak dikutip sebagai kapasitas produksi nyata:

1. **Beban idle:** satu container bot menyala tanpa mengirim apa pun, diamati `docker stats` selama 15–30 menit setelah stabil — baseline RAM/CPU tanpa transaksi.
2. **Beban aktif sintetis:** transport WhatsApp **dipalsukan** (seperti `outbound-guards.test.ts`), memutar N pesan/menit sesuai batas anti-ban asli (misal 1 pesan tiap beberapa detik, bukan burst), diamati `docker stats` selama beban berjalan vs idle — delta RAM/CPU per pesan per menit.
4. **Panjang antrean di bawah tekanan:** mengisi antrean BullMQ lebih cepat dari kapasitas kirim (memakai `enqueueMessage` langsung), memantau `getJobCounts()` — menunjukkan berapa device yang bisa menumpuk sebelum antrean menua tak wajar.
3. **Storage sesi:** ukuran folder `sessions/<device>` sesungguhnya dari QR-scan pengujian yang sudah pernah dilakukan sebelumnya di proyek ini (bukan nomor baru) — `du -sh`, angka nyata bukan estimasi.
5. **Storage DB per 1.000 pesan:** insert 1.000 baris sintetis ke `messages`+`message_status_history`, ukur delta `pg_total_relation_size` — memberi angka byte/pesan yang bisa dikalikan volume nyata nanti.

Semua langkah di atas **desain, belum dijalankan** pada eksekusi rancangan ini; menjalankannya adalah pekerjaan implementasi terpisah (lihat estimasi §6).

## 5. Data invoice yang PM/finance perlukan (daftar, bukan angka)

Untuk mengganti asumsi `pricing.md` dengan angka nyata, PM perlu memasok atau menyetujui pengambilan:
1. **Tagihan hosting aktual** (VPS/cloud) per bulan: total biaya, alokasi RAM/CPU/disk yang dibayar, jumlah device yang berjalan saat itu — untuk menurunkan biaya infra per device nyata (bukan proporsi dari 2 contoh tier di `pricing.md`).
2. **Tagihan bandwidth/traffic keluar** jika ditagih terpisah dari VPS (banyak provider membundelnya; perlu dikonfirmasi mana yang berlaku).
3. **Biaya penyimpanan** (disk/volume) per GB yang dibayar, untuk mengalikan dengan estimasi §2.2/§4.5.
4. **Waktu dukungan nyata** (jam staf per bulan, atau tiket + estimasi menit) — ini yang paling tidak bisa diambil dari sistem; butuh log manual atau tool tiket.
5. **Biaya pembayaran (payment gateway)** aktual bila sudah ada kontrak, atau tetap memakai asumsi 1% `pricing.md` sampai ada kontrak nyata.
6. **Jumlah device aktif dan mix paket** pada periode tagihan yang sama dengan data di atas, agar biaya per device bisa dihitung dari total tagihan ÷ device, bukan diasumsikan.
7. Keputusan retensi (lihat gap 2.5) sebelum finance mengunci proyeksi storage jangka panjang.

## 6. Estimasi effort implementasi (terpisah, belum dikerjakan)

| Pekerjaan | Estimasi (hari-orang, sebelum review) |
|---|---|
| Kumpulkan `docker stats`/cgroup per container, ekspos sebagai metrik Prometheus berlabel `device_key` (gap 2.1) | 2 |
| Job rollup harian "per device" ke tabel ringkas (gap 2.3), dari data yang sudah ada (1.1–1.4) | 1.5 |
| Endpoint/skrip baca-saja: agregasi biaya per tenant dari rollup (bukan UI, hanya query) | 1 |
| Kebijakan dan implementasi retensi untuk `messages`/`message_status_history`/`webhook_logs`/`status_views`/`device_events` (gap 2.5) — **butuh keputusan pemilik dulu** soal jangka waktu | 1.5 (setelah keputusan) |
| Jalankan lima benchmark sintetis di §4 dan tulis hasilnya | 1.5 |
| Dashboard/report biaya untuk PM (opsional, di luar cakupan cost-meter inti) | 2–3 (terpisah, P1) |
| **Total tanpa dashboard** | **≈ 7.5 hari** |

## 7. Yang secara sengaja TIDAK dikerjakan dalam dokumen ini
Tidak mengubah harga atau struktur paket manapun. Tidak menjalankan benchmark sungguhan (baru rencana). Tidak menyentuh `.env`, produksi, atau nomor WhatsApp asli. Tidak mengklaim kapasitas nyata dari asumsi dokumen ini — semua angka di `pricing.md` tetap berstatus hipotesis sampai §4 benar-benar dijalankan dan §5 diisi PM/finance.
