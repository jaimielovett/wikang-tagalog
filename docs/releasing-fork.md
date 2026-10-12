# Wikang Tagalog distribution

This fork has a distinct desktop identifier and no configured automatic updater. Never use Lumen's release feed or updater key to publish Wikang Tagalog.

Web deployments use Vercel. Desktop packages are built with `npm run app:build -- --bundles app,dmg` on Mac or the Windows workflow on Windows. Public Supabase connection values must be provided at build time so web and desktop connect to the same catalogue.

Configure a dedicated signing identity, release repository and updater feed before enabling automatic desktop updates. Until then, new desktop builds are distributed and installed manually.
