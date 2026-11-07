# Fable Audit — 2026-07-05

Full launch-readiness audit-and-fix pass on branch `fable-audit-2026-07-05`.
Four parallel review agents swept the codebase (AI/voice, share/export,
editor/UI, rendering/nav/PWA); every finding below was verified against the
actual code before fixing. All fixes are committed on this branch, lint +
validation pass, and the critical flows were smoke-tested in a real browser
(Playwright): paste-import → deck boot → edit, template fork → reload
persistence, broken-slide rendering, dead-link handling, and the XSS probes.

---

## 🔴 Production-breaking (fixed — read these first)

1. **The daily cleanup cron deleted every hosted share link within 24 hours.**
   `share.js` never wrote `expiresAt` metadata, and the newly-scheduled
   `cleanup-shares` cron (netlify.toml `@daily`) treats missing expiry as
   "legacy, delete". Every `/s/…` link — the DEFAULT share path — would 404
   the morning after it was created. Shares now get a 90-day expiry that
   refreshes on every view (assets too), and cleanup never deletes anything
   it can't prove expired.

2. **Every deck-load failure left the opaque loading overlay up forever.**
   All error paths (bad share payloads, failed fetches, validation errors,
   renderer exceptions) rendered their message *underneath* the full-screen
   overlay — users saw infinite bouncing dots. Overlay dismissal now runs in
   a `.finally()` on init, and each slide renders inside a try/catch that
   swaps a broken slide for an inline "couldn't be rendered" slide instead
   of taking the deck down.

3. **Editing a starter template silently lost everything on reload.**
   The brand-new launcher template cards open path-based decks
   (`#slides=templates/…&open=edit`) whose autosaves were written to a
   localStorage key that nothing ever read back — build a whole deck, close
   the tab, gone. First edit now forks into a real local deck (`#deck=…`),
   which also shows up on the launcher shelf. (The old "built-in deck" guard
   was dead code — it compared `'guide.json'` against `'/guide.json'`.)

4. **XSS via the edit drawer's Advanced JSON textarea.** A shared deck with
   `</textarea><img onerror=…>` in any string field executed script the
   moment a recipient pressed `E`. Escaped (plus layout/theme `data-value`
   attribute sinks). Browser-verified with live payloads: nothing fires,
   editing round-trips correctly.

5. **Any recipient could destroy a share's images for everyone.**
   `delete-asset` had no auth; deleting one slide of a received deck (or
   importing JSON over it) queued the share's blob ids for deletion —
   killing images in the original share and, via global dedup, in *other
   users'* shares. The endpoint now refuses share-externalized assets, and
   local copies of shares drop the `assetId` ownership markers entirely.

6. **The edit drawer's Delete button corrupted decks.** It fell back to an
   inline handler that spliced the data array without touching the DOM,
   indices, or persistence — ghost slide left behind, later edits hit the
   wrong slide, delete reappeared on reload. Now routed through the real
   `removeSlideAt`.

7. **The V-key voice flow recorded with zero visible feedback** (its HUD
   buttons no longer exist in deck.html — surprise hot mic), and a
   double-press could leak a second live mic stream. Recording state now
   falls back to sticky toasts, a synchronous start-flag closes the race,
   recordings cap at 5 minutes, and empty blobs skip the API call.

8. **AI decks / degraded shares were rejected wholesale by the validator.**
   `validateSlides` threw on image slides without `src` — but the AI deck
   prompt *instructs* the model to leave `src` empty, and the share server
   blanks oversized images. One such slide discarded the entire deck. The
   renderer handles empty src fine (placeholder + search button), so the
   validator now allows it.

## 🟠 Should-fix (fixed)

- **Gemini proxy CORS reflected any Origin** — other websites could use the
  endpoint (and the server-side app key) as a free Gemini proxy from their
  visitors' browsers. Now only slideomatic.app + localhost get CORS headers.
  (The app itself only ever calls same-origin.)
- **PWA offline was broken**: the fetch handler never read the precached
  shell, error responses were cached forever, and one 404 in the shell list
  would kill SW install. All fixed; cache version bumped to v1.0.2.
  **Deploy rule: bump `CACHE_VERSION` in sw.js on every deploy.**
- **Launcher import was dead UI** — the redesign removed every trigger for
  the paste modal and file input while shipping all their handlers. "Import
  JSON" / "Paste JSON" buttons now live on the Your Decks shelf.
- **Keyboard shortcuts hijacked browser shortcuts** (Cmd+D → JSON download,
  Ctrl+U → file picker, Cmd+S → settings). Modifier combos now pass through.
- **`_schema` slides desynced every edit/delete/note index by one** (state
  kept them, DOM filtered them). Stripped at the `setSlides` choke point;
  README documents that app-saved decks don't carry them forward.
- **Pinch-zoom fired phantom slide swipes** on mobile — whole gesture now
  flagged multi-touch.
- **Links from an `/s/…` page dead-ended** (`index.html` → `/s/index.html`;
  fallback share links kept the `/s/` path so the stale share always won),
  and **every reload of a share URL minted a new localStorage copy**,
  orphaning edits. Share URLs now rewrite to `/deck.html#deck=…` once
  materialized.
- **A corrupt saved deck was silently overwritten with a blank one.** The
  payload is now stashed under `slideomatic_corrupt_backup:*` first.
- **`extendAssetExpiry` corrupted asset metadata on every dedup reuse**
  (spread the `{etag, metadata}` wrapper) — broke content-type and dedup.
- **The AI Theme button was a visual no-op** — Gemini's `{primary, accent…}`
  keys aren't theme tokens; nothing on screen changed while it toasted
  success. Now mapped onto real tokens (bg/ink/surface/accent/badge +
  background gradient).
- **Dictation demanded a personal API key** while every other AI feature
  used the shared proxy key. Gates removed; Settings copy now says the key
  is optional.
- **The cheat console's image generation targeted the wrong slides** if you
  navigated during the 20–30s deck generation (index captured before the
  await), and reported "Done! 8 images generated" even when all 8 failed.
  Both fixed.
- **JSON-editor image tokens** (`{{BASE64_IMAGE:…}}`) restored positionally —
  reordering gallery items saved the literal token string as `src`. Now
  matched by content; unmatched tokens are blanked, never persisted.
- **Sad-path polish**: `?url=` accepts the app's own export shape (and
  applies its theme); dead `?slides=` links toast instead of silently
  showing a blank deck; upload failures surface; quota failures on theme
  save / API-key save report honestly; non-JSON proxy errors no longer
  surface as `Unexpected token '<'`; popup-blocked image search says so;
  drawer autosaves flush on close instead of firing 3s later at the wrong
  slide; Escape in a drawer field blurs the field instead of closing the
  drawer; corrupt theme-library entries can't crash the editor;
  `verifySharePassword` refuses corrupt stored hashes.

## ✂️ Dead code removed (~350 lines)

- Voice-edit and voice-theme pipelines in `voice-modes.js` — provably
  unreachable since the HUD rebuild removed their buttons (grep-verified: no
  wire-ups anywhere). The V-key voice-to-slide flow is untouched. If you
  want voice-edit/theme back, they're one `git revert` away.
- `requireGeminiApiKey` (zero callers), write-only init flags in main.js,
  the broken built-in-deck guard, the shipped plaintext admin password
  comment.

## 🟡 Deliberately left (ranked by launch impact)

1. **Netlify function timeout for image/deck generation — VERIFY IN UI.**
   Synchronous functions default to 10s; image generation and 8-slide deck
   generation can exceed that (clients allow 45–60s). This is a dashboard
   setting, not code — check Site settings → Functions before launch and
   raise it (26s max on most plans), or plan a background-function refactor
   if generations still get cut off. **This is the #1 remaining risk and it
   can only be tested against the real deployment.**
2. **Live AI smoke test with the real `GEMINI_API_KEY`** (the pre-existing
   open thread): Test Connection, V-key voice, cheat-console deck + images,
   PDF export on a real deck. Everything else here was browser-verified
   locally, but the proxy needs `netlify dev`/production to run.
3. **Share passphrases travel as GET query params** (logged by
   intermediaries; no guess rate-limit). Password-protected shares have no
   UI, so exposure is theoretical — finish the feature as POST-unlock or
   drop the server branch.
4. **No rate limiting on the Gemini proxy or share/upload endpoints.** CORS
   lockdown stops browser-embedding abuse, but curl abuse of the shared key
   is only bounded by Google-side quotas. Netlify rate-limit rules or a
   simple token bucket would be the next hardening step if the app gets
   attention.
5. **Shared themes can point CSS `url(...)` at remote hosts** (viewer-IP
   tracking pixel at worst). An allowlist of URL-free tokens would close it;
   low impact, moderate churn.
6. **Assets from `upload-asset` never expire** (no `expiresAt`, cleanup
   skips them). Conservative by design — expiring them would break local
   decks that reference them. Revisit if blob storage ever matters.
7. **`buildGlobalAssetHashMap` lists the whole asset store on every share
   POST** — O(assets) per share, fine at indie scale; dedup keys on
   truncated MD5 — swap for sha256 if it ever matters.
8. **Share modal creates a hosted record every time it opens** — bounded now
   that expiry exists; consider generate-on-click later.
9. **Onboarding hints are a deliberate no-op** (`showKeyboardHintsIfFirstVisit`
   body is commented out) — left as found, flagged so it's a choice not a
   surprise.
10. **A re-shared copy of a share doesn't register inherited asset ids** in
    its own record (consequence of stripping ownership markers in fix #5) —
    those images stay alive via the original share's 90-day refresh; edge
    case accepted.

## ✅ Verification

- `npm run lint` — clean. `npm run check` — validation passes.
- Browser smoke (Playwright against `npx serve`): launcher renders, paste
  import creates + opens a deck, edit drawer opens, template fork-on-edit
  rewrites URL + survives reload with the edit intact, malformed slide
  renders as an inline error slide between two healthy ones, dead `#slides=`
  link falls back with the overlay cleared, XSS payloads in title/subtitle
  are inert on-slide and in the drawer textarea, `_schema` slides are
  stripped. Zero console errors in every scenario.
- Not verifiable locally (needs functions/deploy): gemini proxy + shared
  key, hosted share create/load lifecycle, cleanup cron, PDF export with a
  real deck, PWA install on device.

## Commits on this branch

| Commit | What |
| --- | --- |
| `05e6f49` | Share expiry lifecycle — stops the daily cron nuking all shares |
| `7ff6709` | Gemini proxy CORS lockdown |
| `3cc10c2` | Fork path-loaded decks on first edit (template data-loss) |
| `2edf444` | Overlay lifecycle + per-slide render guard + `_schema` strip |
| `8dfc220` | Editor hardening — XSS, real delete, drawer/theme/settings guards |
| `632a904` | Share integrity — asset deletion, metadata corruption, validator |
| `2c57189` | Input/URL sanity — modifiers, pinch, `/s/` links, corrupt backup |
| `358e1b8` | Voice/AI — visible recording, races, honest statuses, dead code |
| `5ee36c6` | PWA cache correctness + launcher import restored |
| *(this)* | Docs truth pass + this report |

---

## Addendum — second pass (2026-07-06)

- **"Slideshow showing HTML code"**: what Pablo saw was the leftover XSS
  test tab (a slide deliberately titled with markup, rendering inert —
  correct behavior). No bundled deck contains raw HTML.
- **Fixed: overview-mode brick.** Pressing Home/End — or any HUD nav
  button/slider — while the overview grid was open tore the deck into a
  dead thumbnail layout (tiny slide, pointer-events off). Home/End now move
  the grid cursor; `setActiveSlide()` routes through `exitOverview()` when
  the grid is up. Browser-verified both paths.
- **Docs: README no longer claims "basic HTML" in slides** — the renderer
  escapes HTML by design (share links = stranger content); markdown
  bold/italic/code/links are the supported rich text.
- Visual pass: guide deck, markdown rendering, mobile (390×844) deck
  layout, overview enter/exit — all clean, zero console errors.
- Remaining work handed off in `docs/NEXT-STEPS.md`.
