# Spesifikasi Level & Misi KONEVA

Status: **disetujui Owner — 2026-10-17; deployed ke local production `:13000`**

Cakupan: T2.1 spesifikasi dan T2.2 implementasi. Migration 044–045, backend, dashboard, dan simulasi sintetis telah dibuat dan deployed. Tes backend 376 pass/2 skip/0 fail, STACK 42/42, UI 114/114, TypeScript dan ESLint bersih. Endpoint pasca-deploy merespons dan seluruh container sehat. Tidak ada uji WhatsApp/provider nyata.

## Tujuan dan batas klaim

Level membantu pemilik workspace memahami kesiapan operasional fitur KONEVA yang sudah mereka pilih. Level bukan skor kualitas nomor, prediksi penerimaan pesan, persetujuan WhatsApp/Meta, atau jaminan nomor aman dari pembatasan. Tidak ada level yang mengizinkan pengiriman lebih cepat, lebih banyak, atau ke penerima tanpa izin.

Misi tidak boleh meminta pengguna mengirim bertahap untuk “memanaskan” nomor, meniru perilaku manusia, menghindari deteksi, melakukan scraping, atau mengirim massal sebagai tes. Semua pengujian pengiriman memakai simulasi/fake transport atau penerima yang secara eksplisit mengizinkan uji tersebut. Misi pesan tidak dijalankan otomatis oleh sistem.

## Model yang diusulkan

- **Level berlaku pada workspace.** Ini cocok untuk misi operasional seperti anggota, peran, antrean, dan runbook. Setiap pemeriksaan device tetap ditampilkan per device; satu device bermasalah tidak boleh disamarkan oleh rata-rata workspace.
- Setiap level adalah kumpulan kriteria yang dapat dibuktikan. Level tertinggi yang seluruh kriteria wajibnya terpenuhi menjadi **rekomendasi level**, bukan level yang mengubah hak akses.
- **Paket/entitlement tetap sumber otoritatif fitur.** Level, badge, bypass, maupun progres misi tidak pernah menambah kuota, membuka paket, menonaktifkan consent/opt-out, mengubah rate limit, atau melewati kontrol server.
- Misi bertipe `automatic` hanya untuk fakta yang dapat dibaca sistem tanpa mengirim pesan; `manual` meminta konfirmasi/tindakan konfigurasi dari Owner; `test` memerlukan eksekusi uji eksplisit oleh pengguna.
- Progress yang belum memiliki bukti ditampilkan sebagai **Belum diverifikasi**, bukan selesai. Data yang tidak tersedia tidak dianggap lulus.
- Sumber data awal mencakup konfigurasi akun/workspace, hak anggota, status dan health device, pengaturan webhook, consent/opt-out, agregat antrean/pesan, idempotensi, rate limit, dan keberadaan runbook. Jangan menyimpan isi pesan, nomor penerima lengkap, token, QR, atau session/auth state sebagai bukti misi.

## Level dan misi

| Level | Nama | Tujuan dan kriteria naik | Misi dan jenis bukti |
|---|---|---|---|
| 0 | **Siap Disiapkan** | Workspace, pemilik, dan minimal satu device terdaftar; pemilik telah membaca pemberitahuan bahwa koneksi memakai jalur nonresmi dan dapat terkena pembatasan; halaman sesi dan langkah pemulihan dipahami. | `automatic`: workspace dan device ada, konfigurasi keamanan sesi tersedia. `manual`: Owner mengonfirmasi telah membaca risiko dan mengetahui cara memutus sesi. `test`: webhook dapat divalidasi dengan payload sintetis; kirim/terima dapat diperiksa dengan simulator tanpa WhatsApp. |
| 1 | **Siap Uji Terbatas** | Level 0 terpenuhi; kebijakan consent dan opt-out dipahami; tidak ada penerima tanpa izin yang dipakai dalam uji; tersedia cara menghentikan pengiriman dan melihat hasil/error. | `automatic`: consent/opt-out guard aktif dan statistik status tersedia. `manual`: Owner meninjau contoh consent dan STOP/START. `test`: satu skenario simulasi end-to-end; bila Owner memilih uji nyata, hanya ke nomor milik sendiri atau penerima yang memberi izin eksplisit, satu penerima, tanpa pengiriman otomatis/berulang. Simpan hasil/status teknis saja. |
| 2 | **Siap Kelola Kampanye** | Level 1 terpenuhi; daftar penerima memiliki sumber izin yang dapat ditelusuri; preview dan suppression/opt-out diperiksa sebelum jadwal dijalankan; tersedia mekanisme pembatalan. Tidak ada syarat jumlah pesan atau pertumbuhan volume. | `automatic`: scheduler, suppression check, status kampanye dan aksi cancel tersedia. `manual`: Owner memeriksa sumber consent dan preview. `test`: dry-run daftar/schedule tanpa menghubungi penerima; uji nyata opsional hanya ke satu penerima berizin dengan persetujuan Owner, tanpa loop atau batch. |
| 3 | **Siap untuk Notifikasi** | Level 1 terpenuhi; jalur notifikasi/OTP memakai antrean dan idempotency; rate limit aplikasi aktif; retry dan kegagalan dapat diamati; skenario staging/disposable lulus. Keberhasilan provider atau penerimaan inbox tidak disimpulkan dari request yang tercatat. | `automatic`: konfigurasi antrean, rate limit, idempotency, dan dashboard error tersedia. `manual`: operator meninjau runbook retry/rekonsiliasi dan batas klaim status. `test`: uji sintetis duplikasi, timeout ambigu, retry, dan pemulihan worker di staging/disposable; tidak memakai OTP pelanggan atau nomor sungguhan. |
| 4 | **Siap Operasional CS** | Level 3 terpenuhi; anggota memakai peran minimum; antrean dan kapasitas dipantau; ada pemilik eskalasi, prosedur insiden, kill switch, dan jadwal review. Semua device ditampilkan terpisah; tidak memakai nilai rata-rata untuk menutupi masalah. | `automatic`: daftar anggota/peran, metrik antrean dan status device tersedia. `manual`: Owner menetapkan PIC, mengonfirmasi kill switch, eskalasi, backup/restore, dan runbook. `test`: tabletop incident atau simulasi worker/queue failure; tidak mengirim pesan ke pelanggan. |

Semua level bersifat kumulatif. Kriteria yang berlaku hanya untuk fitur/paket yang tersedia boleh ditandai **Tidak relevan untuk paket ini** dengan alasan dan bukti entitlement; kriteria keamanan, consent, opt-out, tenant isolation, dan batas pengiriman tidak boleh dilewati sebagai “tidak relevan”.

## Progress, badge, dan perubahan level

- Tampilkan `Rekomendasi Level N`, nama level, daftar misi `Selesai`, `Perlu tindakan`, `Belum diverifikasi`, atau `Tidak relevan`, beserta alasan singkat dan sumber/tanggal bukti.
- Progress dihitung per misi, bukan satu persentase yang memberi kesan semua risiko terukur. Jika persentase dipakai, denominator dan misi manual yang belum diverifikasi harus terlihat.
- Perubahan bukti dapat menurunkan rekomendasi level. Simpan progres sebagai status misi dan bukti minimal; hitung rekomendasi lagi dari kondisi terkini. Riwayat perubahan level tidak dihapus.
- Bukti otomatis menyimpan jenis sumber, waktu observasi, status hasil, dan ID referensi internal yang tidak sensitif. Bukti manual menyimpan actor, waktu, versi teks konfirmasi, dan pilihan yang dikonfirmasi; jangan meminta atau menyimpan isi pesan/nomor tujuan sebagai bukti.
- Angka readiness per-device yang sudah ada (`src/shared/readiness.ts`) adalah sinyal terpisah. Jangan memetakan skor/tier lama langsung ke Level 0–4 dan jangan menganggap “warm-up” atau usia device sebagai syarat level. Jika dua sistem tampil bersamaan, beri label dan penjelasan cakupan berbeda. Copy pemasaran yang mengklaim perlindungan anti-ban perlu ditinjau terpisah sebelum level dipublikasikan.

## Bypass rekomendasi level

Bypass hanya mengubah level rekomendasi yang dipilih Owner; ia tidak mengubah kriteria misi menjadi lulus dan tidak membuka kontrol yang dibatasi. Bypass memerlukan Owner workspace, autentikasi/session valid, target level, alasan singkat, konfirmasi eksplisit, dan audit event. Tidak ada bypass melalui API key tenant.

Dialog wajib menampilkan ringkasan kriteria yang belum terpenuhi dan copy berikut:

> **Pilih level di atas rekomendasi?**
>
> Level ini hanya mengubah checklist kesiapan yang ditampilkan. KONEVA tidak memverifikasi bahwa nomor disetujui WhatsApp/Meta atau menjamin pengiriman berhasil maupun bebas pembatasan. Bypass tidak mengubah paket, kuota, rate limit, consent/opt-out, atau pemeriksaan penerima. Anda tetap bertanggung jawab memastikan penerima memberi izin.

Pilihan wajib: `Kembali` dan `Pilih level ini`. Tidak ada pilihan yang berbunyi “Abaikan peringatan” atau “Aktifkan pengiriman aman”. Untuk audit simpan: actor ID, workspace ID, level rekomendasi saat itu, target level, daftar kode kriteria yang belum terpenuhi, reason, versi dialog, waktu, dan request/idempotency ID. Jangan menyimpan teks pesan atau nomor penerima.

## API dan model data yang diusulkan

Nama di bawah adalah rancangan kontrak, belum final dan tidak boleh dibangun sebelum Owner menyetujui scope.

- `GET /api/v1/readiness/levels`: level rekomendasi workspace, daftar misi/status, bukti aman, dan waktu hitung. Perlu permission baca workspace.
- `POST /api/v1/readiness/levels/bypass`: Owner-only; body berisi target level, reason, versi konfirmasi, dan idempotency key. Server memvalidasi ulang permission dan kriteria pada saat request.
- `POST /api/v1/readiness/missions/:missionId/confirm`: Owner-only untuk misi manual; tidak dapat menandai misi otomatis atau test seolah lulus.
- `POST /api/v1/readiness/missions/:missionId/run`: hanya untuk test non-messaging yang aman/simulasi. Uji pengiriman nyata tidak disediakan sebagai job otomatis.
- Kandidat tabel: `workspace_mission_state` untuk status/evidence metadata terkini; `workspace_level_events` append-only untuk perubahan/bypass. Keduanya tenant-scoped, FK jelas, actor nullable hanya untuk event sistem, dan tanpa PII pesan/nomor. Hindari menyimpan snapshot payload penuh.
- Respons API tidak boleh membocorkan device credentials, QR, session state, isi pesan, nomor lengkap, atau data tenant lain. Perubahan bypass/konfirmasi harus audit dan idempotent.

## Acceptance criteria implementasi

1. Level adalah checklist kesiapan operasional; tidak pernah disebut approval/score WhatsApp atau jaminan bebas blokir.
2. Kriteria otomatis menunjuk sumber data dan timestamp; jika sumber hilang/stale, status menjadi `Belum diverifikasi` atau `Perlu tindakan`, bukan lulus.
3. Kriteria consent/opt-out ditegakkan server-side di seluruh jalur outbound yang relevan dan tidak dapat dilewati level/bypass.
4. Bypass tidak mengubah hard quota, plan entitlement, rate limit, consent, suppression list, atau payload pengiriman; dicatat actor/waktu/target/alasan/version dan idempotent.
5. Progres dan bukti terisolasi antar-tenant; anggota non-owner tidak dapat bypass atau mengonfirmasi misi yang Owner-only.
6. Uji pesan sintetis memakai fake transport; hasil simulasi selalu diberi label simulasi. Tidak ada tes yang mengirim pesan/OTP sungguhan tanpa persetujuan eksplisit dan skenario uji yang ditetapkan.
7. Perubahan status device, consent, membership, atau konfigurasi dapat membuat rekomendasi berubah/menurun tanpa menghapus event historis.
8. Semua UI menampilkan empty/loading/error state, alasan misi belum lulus, aksesibilitas keyboard, dan layout mobile.
9. Migrasi diuji pada PostgreSQL disposable fresh dan existing; tests mencakup isolation, permission, bypass denial, duplicate requests, evidence freshness, and downgrade/recompute.

## Kasus uji minimum

- Workspace baru tanpa device → Level 0 belum direkomendasikan; bukti null tidak lulus.
- Device offline/error/banned atau health data stale → status teknis tampil apa adanya dan tidak tertutup nilai agregat workspace.
- Consent hilang/opt-out → misi terkait belum lulus; request outbound tetap ditolak meski level dibypass.
- Plan tidak memiliki fitur kampanye → kampanye ditandai tidak tersedia untuk paket, tanpa membuka fitur lewat level/bypass.
- Bypass valid oleh Owner menghasilkan satu audit event; key tenant, staff, atau viewer ditolak; replay idempotency key tidak menggandakan event.
- Request bypass dengan tenant lain, target di luar rentang, reason kosong/terlalu panjang, versi copy lama, atau level downgrade/upgrade invalid ditolak.
- Simulasi fake transport selesai tanpa koneksi WhatsApp; status hasil UI jelas menyebut “Simulasi”.
- Error/timeout ambigu tidak memicu pengiriman ulang otomatis dan tidak mengklaim delivered.
- Perubahan status consent, anggota, antrean, atau device menghitung ulang rekomendasi dan mempertahankan event historis.
- API tidak menyertakan nomor lengkap, isi pesan, secret, QR, atau session/auth state.

## Keputusan Owner sebelum T2.2

1. Setujui scope level pada **workspace** (rekomendasi dokumen ini) atau pilih per-device.
2. Setujui nama 5 level dan apakah level boleh diturunkan otomatis saat bukti berubah.
3. Setujui apakah bypass rekomendasi level tetap tersedia; default rancangan: tersedia untuk Owner saja dengan dialog dan audit, tanpa mem-bypass guard server.
4. Setujui batas uji pesan nyata: default tidak ada uji pesan otomatis; uji manual opsional hanya ke nomor sendiri/penerima yang memberi izin eksplisit.
5. Setujui wording risiko dan peninjauan ulang copy yang saat ini menggunakan istilah anti-ban/warm-up sebelum fitur ini tampil ke pelanggan.

Tinjauan hukum/ketentuan platform dan persetujuan pilot adalah pekerjaan terpisah; lulus level bukan bukti kelayakan legal atau status production.

## Keputusan Owner

Owner menyetujui seluruh rekomendasi pada 2026-10-17: level workspace-scoped; downgrade rekomendasi otomatis saat bukti berubah; bypass hanya untuk Owner dengan dialog/audit dan tanpa melewati guard; tidak ada tes pesan otomatis dan tes nyata hanya manual ke nomor sendiri/penerima yang memberi izin; copy risiko ditinjau ulang sebelum fitur dipublikasikan.
