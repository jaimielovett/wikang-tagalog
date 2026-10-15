# Wikang Tagalog

This is a separate Tagalog-only fork of Lumen. All edits belong in this repository.
Never edit, commit, deploy, or publish from /Users/jam/Projects/lumen.

- Wikang Tagalog is a desktop app for Windows and Mac (Tauri, backend in src-tauri). The first screen offers Create an account, Sign in, or Continue as a guest, then the welcome.
- AI is local first (models downloaded to the computer). An online model is used only with the learner's own API key; the app never uses a server-side AI key.
- Signed in, learning syncs item by item with the account (src/lib/desktop-sync.ts, src-tauri/src/sync.rs) between the learner's computers. Guests keep everything on one computer.
- Long texts and books are never split into several lessons: one text or one EPUB is one lesson, whose pages turn in the reader.
- wikangtagalog.com is only a download page (src/views/Landing.tsx, api/download.mjs). The browser backend in src/lib/web stays for its account sync engine, Discover and the browser tests (/?app, development only).
- Discover uses the admin-managed sources in Supabase (read by the Vercel functions) plus each learner's own sources. Publishing prepared lessons to Discover is paused.
- Studied language is always tl. Keep native language types for reusable tokenizer code, but expose no study-language switching.
- Admin membership is in public.admins, assigned through trusted Supabase administration. Never use user-editable metadata for roles.
- Keep uploaded drafts private until complete, reviewed and published. Published transcripts/timings are immutable.
- Do not introduce Lumen updater endpoints or signing identity into this fork. Desktop data lives under app.wikangtagalog.reader.
- Keep service keys server-only. Neither the app nor the site needs a service-role key.
- Keep attribution and GPL licence. Dictionary remains Wiktionary-derived.
- Check npm run build, npm test, npm run test:browser, and cargo check --locked --lib from src-tauri.
