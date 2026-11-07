# NEXT-STEPS — handoff checklist (post Fable audit, 2026-07-06)

Everything on branch `fable-audit-2026-07-05` is done, lint-clean, and
browser-verified locally. What remains either **needs Pablo** (dashboard /
real key / device) or is **well-scoped work a smaller model can execute**.
Full context on every item: `docs/FABLE-AUDIT.md`.

## 🧑‍🎤 Pablo-only (can't be done from code)

1. **Merge the branch** — review `git log main..fable-audit-2026-07-05`,
   merge to main, deploy. **Before deploying anything, always bump
   `CACHE_VERSION` in `sw.js`** (already bumped to v1.0.2 for this batch).
2. **Netlify dashboard: check the function timeout** (Site config →
   Functions). Default 10s will cut off image/deck generation (clients
   allow 45–60s). Raise to 26s. If generations still fail, file the
   background-function refactor below.
3. **Live AI smoke test on the deployed site** (needs real GEMINI_API_KEY):
   Settings → Test Connection · V-key voice-to-slide · `666` cheat deck +
   images · ✨ image button · PDF export of the guide · create + open a
   hosted share link · confirm the share still opens the next day (cron).
4. **Install the PWA on your phone** once deployed; flip airplane mode and
   confirm the deck shell still opens.

## 🤖 Safe to hand to a cheaper model (scoped, with acceptance criteria)

Work on a fresh branch off `fable-audit-2026-07-05`. Run `npm run lint` +
`npm run check` after each item. Don't touch anything not listed.

1. **Share-unlock via POST** (`netlify/functions/share.js`,
   `modules/deck-persistence.js#fetchSharedRecord`): passphrases currently
   travel as `?password=` GET params (logged everywhere). Add a POST action
   `{ action: 'unlock', id, password }` to the share function; make the
   client send it; keep the GET path working for old links. Accept: wrong
   password → 401 JSON `{requiresPassword:true}`; right password → full
   record; no password ever appears in a URL.
2. **Rate limiting**: add [Netlify rate-limit rules](https://docs.netlify.com/security/rate-limiting/)
   (config-only) for `/.netlify/functions/gemini` (e.g. 20 req/min/IP) and
   `share` POST (e.g. 10/min/IP). Accept: normal app use unaffected.
3. **Theme URL allowlist** (`modules/theme-manager.js#normalizeThemeTokens`):
   strip `url(...)` values from theme tokens that arrive via shared decks
   (background-surface / background-overlay) unless same-origin. Accept:
   bundled themes still render; a theme with `url(https://evil/x)` renders
   without the remote fetch.
4. **`?data=` wrong-shape toast** (`modules/deck-persistence.js` data
   branch): valid JSON that isn't a deck currently falls through silently —
   add the same warning toast the `?slides=` path now has.
5. **Cheat console blocks slide nav** (`modules/keyboard-nav.js:58`): the
   console isn't `.modal-base`, so Space/arrows on its buttons still change
   slides. Either add the class to its root or extend the guard. Accept:
   typing/tabbing in the console never navigates the deck.
6. **`npm run check` should lint what shipped**: `scripts/validate.mjs`
   doesn't validate `guide.json` (add it to the file list).

## 🧊 Icebox (real work, decide later)

- Background-function or streaming refactor for image/deck generation if
  the 26s ceiling still truncates (Netlify background functions = 15min).
- Password-protected shares have no creation UI — finish or remove.
- sha256 instead of truncated-MD5 dedup keys; per-share asset listing
  instead of full-store scan on every share POST.
- Onboarding first-visit hints are a deliberate no-op (commented out) —
  resurrect or delete.
- `upload-asset` blobs never expire (safe default; storage grows).

## ✅ Known-good (don't re-audit)

Share lifecycle + expiry, deck load/render sad paths, editor XSS, delete,
autosave flush, fork-on-first-edit, voice recording UX + races, cheat-deck
image targeting, PWA cache logic, launcher import, overview enter/exit
(incl. Home/End/HUD during grid — fixed 2026-07-06), keyboard modifiers,
pinch-zoom, mobile deck layout, markdown rendering (raw HTML is escaped by
design — README now says so).
