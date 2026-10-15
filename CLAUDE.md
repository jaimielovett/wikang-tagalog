# Wikang Tagalog

This is a separate Tagalog-only fork of Lumen. All edits belong in this repository.
Never edit, commit, deploy, or publish from /Users/jam/Projects/lumen.

- Shared React interface; browser backend in src/lib/web, desktop backend in src-tauri.
- Studied language is always tl. Keep native language types for reusable tokenizer code, but expose no study-language switching.
- Web: Vite frontend and Vercel functions in api. Supabase auth, private learner_state, published_lessons and lesson-media storage.
- The desktop app is a companion to the website (src/views/Companion.tsx, src/lib/companion.ts): sign in only (no sign-up, no welcome), then import. It transcribes locally and sends each lesson to the learner's account, then deletes its own copy; it mirrors none of the site's learning.
- A learner's own recording (a file from their computer) keeps its sound in the private learner-media bucket, under their user id, readable only by them. YouTube and podcast lessons play from their source and upload nothing.
- Only server-authorized admins can prepare/upload/publish media for the shared catalogue (lesson-media).
- Admin membership is in public.admins, assigned through trusted Supabase administration. Never use user-editable metadata for roles.
- Keep uploaded drafts private until complete, reviewed and published. Published transcripts/timings are immutable.
- Do not introduce Lumen updater endpoints or signing identity into this fork. Desktop data lives under app.wikangtagalog.reader.
- Keep service keys server-only. Neither app needs a service-role key.
- Keep attribution and GPL licence. Dictionary remains Wiktionary-derived.
- Check npm run build, npm test, npm run test:browser, and cargo check --locked --lib from src-tauri.
