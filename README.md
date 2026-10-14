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
2. Run [supabase/migrations/202610120001_wikang_tagalog.sql](supabase/migrations/202610120001_wikang_tagalog.sql) in its SQL editor. This creates private learner data, the shared catalogue, protected admin roles, the private media bucket, publication checks and online-service quotas. Then run [supabase/migrations/202610140001_discover_sources.sql](supabase/migrations/202610140001_discover_sources.sql) for Discover's sources and their shared cache (see [Discover sources](#discover-sources)), [supabase/migrations/202610140002_learner_records.sql](supabase/migrations/202610140002_learner_records.sql) for item-by-item sync, and [supabase/migrations/202610140003_app_requirements.sql](supabase/migrations/202610140003_app_requirements.sql) for the oldest app versions allowed to sync, then [supabase/migrations/202610140004_discover_refresh_where.sql](supabase/migrations/202610140004_discover_refresh_where.sql). Run every migration in date order.
3. Copy `.env.example` to `.env`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the project URL and public publishable/anon key. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the same values for server functions.
4. Under Authentication → URL Configuration, set the Site URL to the address the app is served from (here `https://www.wikangtagalog.com`): confirmation emails link there. Add redirect URLs for every address the app runs at, e.g. `https://www.wikangtagalog.com/**`, `https://wikangtagalog.com/**`, `https://wikang-tagalog.vercel.app/**` and, for local development, `http://localhost:1430/**`. Password sign-in and email-confirmed sign-up are implemented.
5. Create your account in the app. Copy its UUID from Authentication → Users and grant admin membership in the trusted SQL editor:

   ```sql
   insert into public.admins(user_id) values ('YOUR_ACCOUNT_UUID');
   ```

6. Restart both apps after changing their build-time connection values. A distributed desktop build embeds only public Supabase configuration; every admin signs in with their own account. No service-role key is required by either app.

Supabase row-level security isolates each account's learning data. Signed-in learning syncs item by item: each setting, lesson, word, playlist and chat is its own record, and the newest change to a record wins, so two browsers can be used side by side and offline changes keep the time they were made. Each device's daily activity is its own record and the totals add up. Browsers sync on every change, every minute while open, and when they come back into view. Accounts saved the earlier way (one document) become records the first time they sign in, and older copies of the app can no longer overwrite them. Learning done as a guest joins the account automatically the first time you sign in on that browser. Restoring a backup while signed in replaces your learning on all your devices. Desktop learning remains local; desktop accounts currently provide catalogue access and admin publication, while web learning syncs across web devices.

## Branded account email

The confirmation email template and Supabase setup instructions are in [supabase/templates/README.md](supabase/templates/README.md). Apply it in the Auth dashboard; website deployment alone does not change Supabase email templates. A custom SMTP provider and verified sender address are needed to replace the default Supabase sender.

## Online features

Set optional **server-only** variables on Vercel:

- `AI_API_URL`: an HTTPS OpenAI-compatible endpoint, default `https://api.openai.com/v1`.
- `AI_MODEL` and `AI_API_KEY`: the configured model and private provider key.
- `GOOGLE_TTS_API_KEY`: Google Cloud Text-to-Speech key for `fil-PH` natural voice.

These enable contextual translation, chat, simplification, custom Tagalog podcasts, pronunciation and generated lesson audio. Device speech synthesis also works with installed Filipino/Tagalog voices. Generated browser audio uses estimated word timings; precise Whisper alignment runs on desktop. Private provider keys never go into `VITE_` variables or learner backups. Online endpoints require a verified Supabase session and enforce a daily request budget.

## Discover sources

Discover draws on default sources that admins choose: YouTube channels, podcasts and article feeds. The server reads them into a shared cache of titles, summaries, images and links. An article's full text is fetched only when a learner turns it into a lesson, and only Tagalog articles are kept. Learners can switch any source off for themselves under Discover → Sources; published lessons appear there as "Wikang Tagalog lessons". Signed-in learners can also add their own sources there by pasting a site, feed, podcast or YouTube channel link (handles included); the server finds the feed, reads it on request within the learner's daily budget (ten sources per request, up to 30 sources each), and the items stay on their device rather than in the shared cache. On the web, videos and audio play from their source, and the desktop app turns them into transcribed lessons.

To enable refreshing:

1. Generate a long random secret (for example `openssl rand -hex 32`).
2. Store its hash in the Supabase SQL editor:

   ```sql
   update public.discover_refresh set secret_hash=encode(sha256(convert_to('YOUR_SECRET','UTF8')),'hex') where id;
   ```

3. Set the same value as the server-only `DISCOVER_SECRET` on Vercel, and set `CRON_SECRET` to another random value so the scheduled refresh is recognised.

The cache refreshes every three hours (a Vercel cron job; Vercel Pro or above), and whenever someone opens Discover after it is three hours old; it never runs twice at once. Admins manage sources under Account → Discover sources: add, edit, switch off for everyone, or retire, and see each source's item count and last error. **Refresh now** reads them immediately. Retired sources are hidden, never deleted, so learners' settings stay valid.

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

## Desktop releases and updates

The desktop app updates itself from this repository's published GitHub releases, signed with this fork's own updater key; it never uses Lumen's. Installed apps check at launch and every six hours.

One-time setup:

1. Generate the updater key once, outside the repository, and keep the key file and its password backed up: losing either means installed apps can no longer be updated.

   ```bash
   npx tauri signer generate -w ~/.tauri/wikang-tagalog-updater.key
   ```

   Its public key goes in `plugins.updater.pubkey` in [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json).
2. In GitHub → Settings → Secrets and variables → Actions, add the secrets `TAURI_SIGNING_PRIVATE_KEY` (the key file's contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and the variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the public values).

To release:

1. Set the new version in [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) (and `package.json`), commit, and push a matching tag, e.g. `git tag v0.2.0` then `git push origin v0.2.0`.
2. [.github/workflows/release.yml](.github/workflows/release.yml) builds the Windows and macOS apps, signs their update packages and attaches them, with `latest.json`, to a **draft** release.
3. Review the draft: its description already has download instructions for the new version; add what changed. Then publish it. Only then do installed apps offer the update, and Discover's "Get the desktop app" link serves it.

Local `npm run app:build` also signs update packages: set `TAURI_SIGNING_PRIVATE_KEY` to the key file's path and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` first, or build with `--config '{"bundle":{"createUpdaterArtifacts":false}}'`.

When a release changes how learning is stored, raise the minimums in Supabase so older apps are asked to update instead of syncing data in the old format:

```sql
update public.app_requirements set min_record_version=2, min_desktop_version='0.2.0' where id;
```

Outdated web tabs are asked to reload; an outdated desktop app shows an update card that cannot be dismissed. Builds are not code-signed with an Apple or Microsoft certificate yet, so first installs show a macOS Gatekeeper or Windows SmartScreen warning.

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
