# Studio tasks — checkpoint review

Board diperbarui oleh lead (globe-lead, w4:p1), 10 Oktober 2026. **Checkpoint 1: READY — menunggu keputusan pengguna** (lihat CHECKPOINT.md).

| ID | Owner | Deliverable | Dependency | Acceptance | Status |
|---|---|---|---|---|---|
| ST-01 | Sonnet engineer | ENGINEERING_REVIEW.md | Model/readiness/brief verified | Status docs vs source/artifact, risks and actionable gaps with file evidence; no unrelated edits | **Done** (artefak 01:38; diterima lead; G-01…G-10, K1…K14, V-01…V-11) |
| ST-02 | Sol design/technical artist | DESIGN_ART_REVIEW.md | Model/readiness/brief verified | Product/UX/art/asset pipeline review with evidence and verification limits; proposals separate from approved direction | **Done** (artefak 01:37; diterima lead; DA-01…DA-08) |
| ST-03 | Opus lead | PROGRESS_MATRIX.md, GAME_CHECKLIST.md, ROADMAP.md, CHECKPOINT.md | ST-01, ST-02 | Reconciled progress and prioritized milestones, owners/dependencies/acceptance; no stale aggregate percent | **Done** (direkonsiliasi dengan ST-01/ST-02) |

Catatan lead:
- Blocker #1 engineer (konfirmasi daftar `??`) dijawab lewat `git -C … status --porcelain` milik lead ±01:36: 95 entri; `src/valley/`, `src/trade/`, `src/modes/trade/`, test dan tools QA terkait memang untracked. Tidak perlu git tambahan dari engineer.
- Blocker #2/#3 engineer (commit, rig kanonik, izin run V-01…V-11) diteruskan ke pengguna di CHECKPOINT.md.
- Tidak ada task baru yang di-dispatch. Worker standby.

Pengguna menerima checkpoint sebelum implementasi. Lead satu-satunya penulis board setelah handover. Source dan dokumen existing read-only pada milestone ini.
