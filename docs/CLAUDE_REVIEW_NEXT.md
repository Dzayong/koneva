# Review PM/Codex untuk Claude — outbound controls

Tanggal: 2026-09-27. Tugas berikutnya: perbaiki temuan di bawah sebelum menambah fitur atau menganggap outbound controls lolos review. Baca AGENTS.md dan HANDOFF.md terlebih dahulu. Dokumen ini ditulis agar pemilik tidak perlu menyalin laporan antar-chat.

## Bukti dan batas review

Laporan Claude ditemukan langsung di `docs/OUTBOUND_CONTROLS.md`, `docs/CONSENT_OPTOUT_DESIGN.md`, HANDOFF, dan memory. Perubahan guard pada antrean, auto-reply, runner dan commands memang ada. Review ini menggunakan graph Tier 2 (generation 2026-09-27T06:12:45Z), coverage untuk file terkait, pembacaan diff/source, dan reproduksi fungsi terisolasi. Dependency Baileys di node_modules dikecualikan indeks sehingga bagian relevan dibaca langsung.

Tidak menjalankan suite PostgreSQL/Redis, tidak membuat socket WhatsApp, tidak membaca .env, tidak mengirim email, dan tidak mengubah kode aplikasi. Reproduksi memakai ekstraksi AST fungsi sumber aktual lalu transpile TypeScript dengan dependency palsu; itu bukan tes integrasi penuh. Klaim hasil suite Claude belum dijalankan ulang oleh reviewer.

## 1. P1 — pengiriman dapat terulang bila pencatatan setelah transport gagal

Lokasi: `src/bot-container/queue.ts`, `processJobBody`, terutama pemanggilan transport sekitar baris 495 dan `updateMessageStatus(...sent...)` sekitar 522. Jalur error uncertain juga menunggu update DB sebelum melempar UnrecoverableError, sekitar 510–517.

Transport sudah sukses, lalu update status DB gagal: fungsi melempar error biasa dan row tetap queued. Re-eksekusi memanggil transport lagi. Ini bisa terpicu retry worker saat DB pulih. Perlindungan baru hanya menangani error dari blok pemanggilan transport, belum seluruh kegagalan setelah kemungkinan side effect.

Reproduksi reviewer: ekstrak `processJobBody` aktual; transport palsu mencatat sukses; update status pertama sengaja gagal; row tetap queued; re-eksekusi fungsi mengirim lagi. Hasil: `sends = 2`, status akhir sent. Reproduksi ini tidak menjalankan scheduler BullMQ, tetapi membuktikan perilaku handler pada re-eksekusi.

Perbaikan: rancang state/attempt pengiriman tahan restart agar job yang mungkin sudah diserahkan ke transport tidak dianggap aman dikirim ulang. Bedakan retry sebelum transport dari retry pencatatan hasil. Jangan cukup membungkus error dengan UnrecoverableError setelah DB gagal, karena restart/stalled-job perlu dipikirkan. Dokumentasikan tradeoff kemungkinan pengiriman tidak selesai vs duplikasi; jangan menjanjikan exactly-once jaringan.

Tes penerimaan: transport sukses + update DB gagal; transport hasil uncertain + update status uncertain gagal; replay/stalled job setelah proses berhenti; proses pencatatan gagal tidak menyebabkan send kedua. Gunakan DB/Redis sementara dan transport palsu. Jika skema baru dibutuhkan, file migrasi boleh dibuat dan diuji hanya di DB sementara, bukan database panel.

## 2. P1 — update profil memeriksa guard hanya sekali untuk beberapa operasi tulis

Lokasi: `src/bot-container/commands.ts:139` (`updateProfile`). Guard di baris 142 diikuti perubahan nama, About dan bisnis. Ada await operasi jaringan di antara perubahan itu, termasuk `requireBusiness` sebelum penulisan bisnis.

Reproduksi reviewer: perubahan nama palsu menandai workspace suspended; payload juga berisi About. Hasil: guard dipanggil 1 kali; About tetap ditulis setelah suspend. Ini bukan sekadar celah beberapa milidetik antara guard dan send pertama: operasi berikutnya memulai write baru tanpa pemeriksaan ulang.

Perbaikan: periksa ulang tepat sebelum setiap operasi tulis, setelah semua lookup/wait sebelumnya. Pertahankan penjelasan bahwa operasi yang sudah berjalan tidak dapat ditarik kembali. Jika perintah telah mengubah sebagian profil lalu diblokir, hasil dan dokumentasi harus menjelaskan potensi perubahan parsial.

Tes penerimaan: suspend/pause setelah perubahan nama mencegah About dan bisnis; suspend saat lookup bisnis mencegah write bisnis; tindakan pertama yang sudah sukses tidak diklaim rollback. Gunakan fungsi asli dan transport palsu dalam suite.

## 3. P1 — harness belum menjamin larangan membaca .env

Lokasi: `scripts/test-outbound-local.sh:5,19,24,25`; `src/shared/config.ts:4`; jalur impor `src/shared/database/connection.ts`.

Skrip berpindah ke root repo dan test mengimpor connection -> config -> `dotenv.config()` tanpa opsi. Mengisi env test dan `DOTENV_CONFIG_QUIET=true` tidak mencegah pembacaan berkas .env; quiet hanya menyangkut keluaran. Ini temuan jalur kode, bukan bukti forensik berkas apa yang dibaca pada eksekusi Claude terdahulu.

Perbaiki isolasi konfigurasi sebelum menjalankan kembali suite. Buat cara eksplisit dan terbatas untuk menonaktifkan pemuatan dotenv dalam harness, atau pemisahan config test yang tidak membaca dotenv; pastikan startup non-test tidak berubah diam-diam. Jangan menganggap DOTENV_CONFIG_PATH saja memengaruhi pemanggilan langsung dotenv.config() tanpa memverifikasinya.

Tes penerimaan: canary sintetis/penjagaan pembacaan file membuktikan proses tes dan migrasi tidak mencoba membaca .env proyek; kredensial hanya sintetis; email tetap none dan semua konfigurasi Gmail dikosongkan. Audit skrip yang dipakai tahap ini, termasuk subprocess. Tidak perlu membuka .env untuk membuktikan proteksi.

## 4. P1 — asumsi semua error 428 berarti pasti belum terkirim belum terbukti

Lokasi: `src/bot-container/send-guard.ts:47` (`isDefinitelyNotSent`) dan `queue.ts:502`.

Classifier menerima setiap error status 428 ATAU teks Connection Closed/not connected sebagai pasti belum terkirim. Di dependency lokal `node_modules/@whiskeysockets/baileys/lib/Socket/socket.js`, 428 bukan hanya preflight `sendRawMessage` sekitar 58–60: `waitForMessage` sekitar 86–103 juga menghasilkannya ketika menunggu respons dan socket ditutup; close handler sekitar 690 memakai 428 untuk Connection Terminated. `query` sekitar 125–136 mengirim sebelum menunggu hasil. Jadi kode/status generik tidak membawa bukti fase pengiriman.

Reproduksi classifier: `Error('Connection Terminated')` dengan `output.statusCode=428` menghasilkan true. Ini membuktikan classifier luas; reviewer belum mereproduksi jalur end-to-end sendMessage tertentu yang mengirim pesan pelanggan lalu mengembalikan 428. Jangan menyatakan duplikasi live sudah terbukti, tetapi jangan mempertahankan jaminan aman tanpa bukti fase.

Perbaikan konservatif: error setelah masuk transport dianggap uncertain kecuali ada bukti eksplisit bahwa belum ada side effect; pemeriksaan socket sebelum transport dapat tetap memakai retry yang sesuai. Tambahkan tes disconnect sebelum transport vs setelah penyerahan, dan selaraskan komentar/dokumentasi. Tes yang hanya membuat Error('Connection Closed') tidak memvalidasi asumsi upstream.

## Batas dan laporan balik

- Perbaiki isolasi .env terlebih dahulu sebelum menjalankan suite lain.
- Jangan membaca .env, mengirim email/WhatsApp, restart panel, migrasi DB panel, menyentuh produksi/nomor asli, mengubah harga/engine, atau commit.
- Jangan menimpa pekerjaan agent lain. Perubahan kode harus dibatasi pada temuan review dan tes/dokumentasi yang dibutuhkan.
- Retensi pause tanpa batas, presence/read receipts, consent/opt-out dan idempotensi API tetap backlog terpisah; jangan melebar ke implementasi seluruh rancangan sekaligus.
- Jalankan tes yang relevan dan laporkan hasil sebenarnya, termasuk skip dan prasyarat. Pisahkan fungsi terisolasi, STACK-local dan LIVE.
- Simpan laporan perbaikan ke `docs/OUTBOUND_REVIEW_RESPONSE.md`: tiap temuan -> perubahan -> tes/bukti -> batas yang tersisa. Perbarui HANDOFF dengan tautannya. Dengan begitu PM dapat membaca langsung tanpa meminta pemilik copy-paste.
