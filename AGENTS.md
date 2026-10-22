# AGENTS.md

Navigation only. Conventions, commands, and testing rules live in [CONTRIBUTING.md](CONTRIBUTING.md).

- `lib/` — Node service layer (HTTP API, attribution, translation, LLM); entry point `server.js`.
- `public/` — shared web UI, zero build; used by both the Node server and the desktop shell.
- `desktop/` — Tauri 2 shell; `desktop/src/` mirrors `lib/` in Rust. Change both sides together.
- `site/` — marketing site: Chinese at the root, English under `site/en/`; build checks in `test/site.test.js`.
- `test/` — black-box API suite (`api.test.js`) and site checks (`site.test.js`).
- `seeds/summaries.json` — hand-written summaries; `lib/llm/presets.json` — LLM presets.
- `.scratch/` — local-only working notes (gitignored; do not commit or push), including the v1.1.0 PRD (`prd-seo-geo-i18n.md`).
