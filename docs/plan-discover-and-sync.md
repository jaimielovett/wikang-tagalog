# Plan: Discover sources and cross-device sync

Agreed decisions, in build order. Each phase ships on its own.

## Phase 1: Default sources for everyone (web) — built

Differences from the plan below:
- The scheduled refresh runs every three hours (Vercel Pro); opening Discover also refreshes a cache older than three hours.
- Seeded with Lumen's nine Tagalog YouTube channels and Bandera. Inquirer's main feed is mostly English, so the language check would leave it empty; Philstar's feed no longer answers.
- YouTube's public channel feeds give no durations, so Shorts can't be filtered out yet.
- YouTube @handles aren't accepted in the admin form yet (channel IDs and /channel/ links are); feed discovery comes with phase 2.


- New table `discover_sources`: id, name, feed or channel URL, type (news, podcast, youtube), shelf (learn, news, culture, music), enabled, created_at, retired_at.
  Everyone can read it; only admins (`public.admins`) can write it.
- Admin panel "Discover sources" on the Account page, next to the Publishing studio: add, edit, switch off, retire.
- Retiring a source hides it; rows are never deleted, so users' settings that point at it stay valid.
- Seed with Lumen's Tagalog sources.
- A scheduled Vercel job fetches every enabled source every few hours into a shared cache table `discover_items`.
  - Stores title, summary, image, link, kind, duration, published date, estimated level and detected language. **Never the full article text** (that would be republishing).
  - Each source has a timeout; a failing feed doesn't stop the rest, and its failure is shown in the admin panel.
  - Items older than 30 days are pruned.
  - Language detection per item, so English articles from Filipino outlets don't flood Discover.
  - Feed titles and summaries are cleaned of HTML before storage.
- Published lessons appear as one more source, "Wikang Tagalog lessons", on by default and shown first.
  When a published lesson and a source item are the same video, it shows once, as the ready-to-open lesson.
  Search still finds published lessons when that source is off, labelled as prepared lessons.
- Per-user toggles: one setting per source, `source_off_<id>`, so the guest-to-account merge keeps them.
  New sources appear switched on for everyone, with a "New" badge. **No reordering.**
- Articles become lessons on the web as today: full text is fetched at that moment. Very short text (a paywall teaser) offers "Read on the site" instead.
- Videos and audio: watch through the source's own player. "Make it a lesson" asks for the desktop app,
  or on a phone says to open it on a computer.

## Phase 2: Sources users add themselves — built

Differences from the plan below:
- Own sources live one per setting (`my_source_<id>`) in the learner's synced data; their items are cached on each device and read again after three hours, or when the learner presses Refresh.
- Each learner can follow up to 30 own sources; a request reads at most ten and uses one unit of the daily budget.
- Adding one of the default sources says so, and switches it back on if the learner had switched it off.


- Signed-in users only (fetching goes through the server). Guests can still switch defaults off.
- The app finds the feed behind a homepage or YouTube channel URL (port Lumen's desktop logic).
- Duplicates of a default source are matched by normalised URL.
- Fetched on demand through an authenticated, rate-limited endpoint, with the article importer's internal-address checks after every redirect.
  Limits on source count, fetch frequency and feed size.
- Items stay private to the user; they never enter the shared cache.

## Phase 3: Item-by-item sync (web) — built

Differences from the plan below:
- Records are kept per account in `learner_records` (key, data or null when deleted, change time, format version, server time); `push_learner_records` applies the newest change per record and caps each account's storage.
- Local changes are found by fingerprinting records, so the learning code is unchanged; offline edits keep the time they were first noticed.
- Lessons, playlists and chats now get clock-based ids, so two devices never create the same one.
- Browsers sync on each change, every minute while in view, and on returning to view; Realtime can replace the polling in phase 6.
- The old `save_learner_state` refuses writes once an account has records; `learner_state` is kept, read once per account to migrate.


- Replace the single learning document (`learner_state`, whole-file saves with revision checks) with one row per item:
  lessons, words, playlists, chats, reading positions, settings. Each row has `updated_at`; the latest change wins per item.
- Daily activity is stored per device and summed when shown, so time isn't counted twice.
- Existing accounts are migrated from their document on first load; the guest-to-account merge keeps its current rules.
- Every synced row carries a format version.

## Phase 4: Desktop updater

- Tauri's built-in updater with this fork's **own** signing key and release feed (e.g. GitHub Releases). Never Lumen's.
- The server tracks a minimum supported version; an older desktop app is asked to update instead of writing old-format data.
- Ships before desktop sync, so every desktop app that syncs can be updated.

## Phase 5: Desktop sync

- Desktop sign-in syncs the same rows as the web: full sync of learning, not just transcripts.
  The local SQLite database stays as the offline copy and sends only changes.
- Desktop transcripts go to a private table, one row per lesson: source URL, transcript, timings.
  The web plays them from the source (YouTube embed or the podcast's audio) in sync with the timings; user media is never hosted.
  If the source blocks embedding or disappears, the transcript remains with "Watch on YouTube".
- Admins can send **their own** transcripts to the existing review → publish queue. Never another user's.
- A `wikangtagalog://` link opens a Discover item in the desktop app; without the app installed it falls back to the download page.

## Phase 6: One active reader (Spotify-style handover)

- Opening a lesson makes that device the active reader (a heartbeat through Supabase Realtime).
- The other device pauses and shows "Continued on your desktop" (or web), with a button to take it back.
- Reading positions are synced, so the taking device resumes on the same line.
- No hard lock: a sleeping laptop can never lock someone out.

## Rules that hold throughout

- Only admins remove published lessons. Removing hides them from Discover; anyone who already added one keeps a working copy, media included.
- Published transcripts and timings are immutable.
- No service-role key in either app; roles come only from `public.admins`.
