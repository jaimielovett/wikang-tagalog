# Wikang Tagalog

A Tagalog-only web and desktop learning app, forked from [Lumen by Ulysse Rives](https://github.com/LivingTwice/lumen). The reader, vocabulary, playlists, progress, theme, keyboard controls and desktop import/transcription engine are shared. The studied language is fixed to `tl`.

This is an independent repository. The original Lumen checkout and its data are unchanged. Desktop data uses `app.wikangtagalog.reader`; Lumen's release feed and signing keys are not used.

## Run locally

```sh
npm install
npm run dev                     # website: http://localhost:1430
npm run app:dev                 # desktop: builds Whisper sidecar, then Tauri
npm run app:build -- --bundles app,dmg    # Mac installer
```

Use either development command: desktop development also serves the web preview at the same URL. Stop a separately running web dev server before starting `app:dev`.

Desktop development needs Rust, CMake and Apple developer tools on Mac, or Microsoft's build tools and Vulkan SDK on Windows. Install FFmpeg (`brew install ffmpeg` on Mac) for preparing browser-compatible publication media. Desktop transcription and AI model downloads are still local.

The website starts without external credentials: guest reading, the bundled Tagalog–English dictionary, text/document imports, vocabulary, playlists, progress, settings and backup export/restore work on the device. Accounts and public discovery have a clear unconnected state until Supabase is configured. No mock lessons, sample videos or simulated AI responses are shipped.

## Connect Supabase

1. Create a new project in the [Supabase dashboard](https://supabase.com/dashboard).
2. Run [supabase/migrations/202610120001_wikang_tagalog.sql](supabase/migrations/202610120001_wikang_tagalog.sql) in its SQL editor. This creates private learner data, the shared catalogue, protected admin roles, the private media bucket, publication checks and online-service quotas.
3. Copy `.env.example` to `.env`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the project URL and public publishable/anon key. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the same values for server functions.
4. Configure the site's URL and allowed redirect URLs under Authentication. Password sign-in and email-confirmed sign-up are implemented. For local development allow `http://localhost:1430`.
5. Create your account in the app. Copy its UUID from Authentication → Users and grant admin membership in the trusted SQL editor:

   ```sql
   insert into public.admins(user_id) values ('YOUR_ACCOUNT_UUID');
   ```

6. Restart both apps after changing their build-time connection values. A distributed desktop build embeds only public Supabase configuration; every admin signs in with their own account. No service-role key is required by either app.

Supabase row-level security isolates each account's learning data. Cloud saves compare revisions so two devices cannot silently overwrite one another. A conflict keeps the local copy and stops writes; export it in Settings, then sign in on a clean browser to obtain the cloud copy. Exported guest backups can be restored into a signed-in account. Desktop learning remains local; desktop accounts currently provide catalogue access and admin publication, while web learning syncs across web devices.

## Online features

Set optional **server-only** variables on Vercel:

- `AI_API_URL`: an HTTPS OpenAI-compatible endpoint, default `https://api.openai.com/v1`.
- `AI_MODEL` and `AI_API_KEY`: the configured model and private provider key.
- `GOOGLE_TTS_API_KEY`: Google Cloud Text-to-Speech key for `fil-PH` natural voice.

These enable contextual translation, chat, simplification, custom Tagalog podcasts, pronunciation and generated lesson audio. Device speech synthesis also works with installed Filipino/Tagalog voices. Generated browser audio uses estimated word timings; precise Whisper alignment runs on desktop. Private provider keys never go into `VITE_` variables or learner backups. Online endpoints require a verified Supabase session and enforce a daily request budget.

## Publish a lesson

1. In the desktop app, import a Tagalog video/audio file or supported source link. Lumen's existing downloader and local Whisper pipeline produce the transcript and timings.
2. Sign in as an admin, open Account → Publishing studio, choose the lesson and select **Prepare for review**.
3. The app converts the audio to AAC and video to H.264 MP4, then streams files directly from disk to Supabase Storage. Media does not pass through a Vercel function. Original local files are preserved.
4. Preview the prepared lesson, choose its level and shelf, and confirm permission to share its transcript/media.
5. Select **Publish to Discover**. Publication is rejected unless the lesson was prepared, its required media exists and its tokens/timings are present. Drafts remain private. Published content is immutable so existing reading anchors and timings stay aligned.

Web learners open the prepared lesson from Discover; no downloading/transcription of the original source is needed. They get independent vocabulary and progress. The shared record never contains someone's local filesystem paths, private terms or personal reading state.

If preparation fails, the draft and any completed uploads remain in the review queue. Delete that unpublished draft before retrying. This avoids orphaned media and half-published lessons. Signed media links are resolved when a lesson opens and last 24 hours.

## Deploy the web app to Vercel

Import this repository as a Vite project and set the variables above. `vercel.json` supplies the build, API routes and SPA fallback. Vercel builds only the web app; it does not compile the Rust desktop app. Rebuild after changing `VITE_` values.

```sh
npm run build                   # production frontend
npm test                        # API checks + real PostgreSQL permission tests
npm run test:browser             # Chrome learning-flow and mobile checks
cd src-tauri && cargo check --locked --lib
```

`npm run dev` serves the frontend. For local testing of configured server endpoints, use `vercel dev` with the same environment variables. The browser checks need Google Chrome installed; the database tests use PGlite, not a live account.

## Source layout

- `src/`: shared React screens and reader.
- `src/lib/web/`: real browser learning backend, IndexedDB, account sync, dictionary, catalogue and publishing.
- `api/`: authenticated Vercel AI, voice and article-import endpoints.
- `src-tauri/`: desktop SQLite, local AI, Whisper, downloaders and streamed admin publication.
- `supabase/migrations/`: schema, RLS, storage permissions and publication validation.
- `scripts/export-tagalog-dictionary.py`: reproducible export from the bundled dictionary.

## Attribution and licence

App code is **GPL-3.0-or-later**, inherited from Lumen; see [LICENSE](LICENSE). Ulysse Rives remains credited as the original author. Wikang Tagalog adaptations were created in October 2026.

Dictionary entries/forms are Wiktionary-derived data exported via [kaikki.org](https://kaikki.org/dictionary/Tagalog/), under **CC BY-SA 4.0**. Both `src-tauri/resources/dicts/tl.db.gz` and `public/tagalog-dictionary.json.gz` retain that licence. Changes to this export are described in `scripts/export-tagalog-dictionary.py`. Other inherited assets and dependencies retain their own licences.

Live Supabase connection, provider credentials, desktop distribution signing and production deployment must be configured before public launch. Native import, local models, media compression and LingQ migration remain available in the desktop app. Browser imports support text, articles, PDF, EPUB, HTML and subtitle documents; audio/video preparation and alignment belong to desktop.
