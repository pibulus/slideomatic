# Deck brief — The Sovereign Passport (2026 edition)

**Status:** build brief for an independent pass. Written 2026-11-13 by the session that shipped the arcade passport work (`pibulus-os` `b197b04` → `e131768`).
**Deliverable:** one deck in Slide-o-Matic that explains the Passport system to a smart newcomer, is worth sharing cold, and is *checkable* — every number and claim traceable to this repo or the module.
**Where it goes:** `sovereign-passport-2026.json` at the repo root + one `catalog.json` entry. Validate with `npm run check`.

---

## 1. What this deck is for

Someone opens it having never heard of the Passport. Twenty slides later they can:

- explain the four words to a friend in one sentence,
- say what is *derived* and what is *stored*,
- say what the QR is,
- say what happens when two devices "sync",
- say what the honest limits are.

Not a pitch. A **shared mental model** — the kind of deck that ends an argument in a design review because everyone now knows the same diagram.

**Tone:** confident, friendly, slightly obsessed. "The more you know." Memetic in the sense of *sticky phrasing*, not joke density — one memorable line per section beats ten quips. No marketing fog, no "AI", no exclamation marks in body copy, no emoji as garnish.

**Hard rules**

1. Every number is real and sourced (§7). No invented features. No "coming soon" presented as shipped.
2. Where something is deliberately *not* built, say so plainly on its own slide. The honesty is the product.
3. These are game saves and personal notes, not secrets of state. Do not inflate the threat model; do not dismiss it either.

---

## 2. The spine (17 slides)

Each slide: **what it must teach**, and the evidence to put on it. Change the words, keep the order.

| # | Type | Teach | Evidence |
|---|------|-------|----------|
| 1 | `title` | Four words, no account. | `eyebrow: "SoftStack Passport"`, `title: "Four words, no account"`, 3-image media strip |
| 2 | `split` | The default (account, email, password, forgot-password, "sign in to sync") vs this. | Left: the landlord model. Right: the cartridge model. Both in 4 bullets, no strawman |
| 3 | `standard` | One secret, and why four *words* not sixteen hex | 4,096-word curated bank, 48 bits, 281,474,976,710,656. A checkpoint: the card is 4 words wide on purpose |
| 4 | `standard` | **Layer 1 — words → code.** One-way. | `HMAC("softstack-passport-code:" + phrase, secret)` → 12 hex → `SS-XXXX-XXXX-XXXX`. "A code alone never restores the words" |
| 5 | `standard` | **Layer 2 — code → identity.** Stored at issue, so bank expansions never rename you | `SHA-256("softstack-passport-id:" + code)` → moniker + DiceBear face + palette |
| 6 | `grid` | The look space is enumerated, not infinite | 8 palettes (Sunset, Miami, Lavender, Pool, Risograph, Mango, Grape Soda, Spearmint) × 4 holo × 4 frames × 5 textures × 3 type styles × 4 avatar sets = **7,680 looks`. Give the grid real swatch colours |
| 7 | `image` | Same words → same card, offline, before any network call | The contact sheet (§5) full-bleed, caption explains determinism |
| 8 | `split` | The card is a licence: front carries the four words masked + portrait + chip + seal | Real screenshot crop, front |
| 9 | `image` | The back carries the code, and the flip is why the front stays clean | Front/back pair, same card, same palette |
| 10 | `standard` | **The QR is the words.** `https://…/arcade/#phrase=<words>` | The `#` matters: fragments are never sent to a server. Note the 8-char bit-packed idea as a *possible* optimisation, not shipped |
| 11 | `standard` | **Layer 3 — where it lands.** The vault. | Arcade: `~/arcade-saves/<sha256(pass)[:32]>/<game>.json`, one `state` + one `sram` per game, last write wins |
| 12 | `standard` | The round trip, as actually tested | Phone saves → POST 200 → cold laptop with `#phrase=` shows `passport · 1` → RESUME → GET 200. Frame it as a receipt, not a promise |
| 13 | `split` | **Link, don't merge.** Two keys are two vaults | Left: what happens when you scan someone's QR (you adopt their words). Right: there is no merge, and why merging content-addressed vaults isn't a one-liner |
| 14 | `standard` | What is and isn't encrypted, today | TLS in transit; the vault dir *is* `sha256(words)`; blobs are plaintext on the box. Client-side AES-GCM + a lookup id is the plan, not the state |
| 15 | `split` | Unhook vs revoke | `DISCONNECT THIS DEVICE` is local (proven: vault still answers after). Rotation is the only real revocation because there are no accounts |
| 16 | `pillars` | **Five surfaces, one source of truth — and where the fifth stands.** | talktype / ziplist / qrbuddy / promapper are vendored byte-identically and checked (`scripts/vendor.mjs` + `check.mjs`). The arcade's copy is a **hand-merged fork** (shared card + its own sheet/badge CSS) and has drifted from the canonical styles — say so on the slide. Four apps sign an HS256 token with `stamps` + `tier`; the arcade skips the token because there is nothing to unlock |
| 17 | `quote` | The closing line | e.g. "The four words are the key, the name, and the portrait." + a one-line "mint one at quickcat.club/arcade" |

Optional 18th: `scroll` with `variant: "two-column"` as the reference page — every path, every commit, the vault file shape, the module's file map. For the person who wants to go read the code.

---

## 3. The images — read this before generating anything

**Diagnosis.** The current per-slide generator is *told* to draw dense diagrams but is *fed* a headline, so it illustrates a **noun** instead of encoding a **claim**. "Four words unlock a chest" produced an otter, a lantern, fries, a star and a treasure chest in a row: five objects, zero information. The prompt isn't too simple — the **input** is.

**The rubric this deck is judged against** (Pablo's, verbatim in spirit):

- Ugly but it lands a lot of information → **good**.
- Not that informational but genuinely beautiful → **fine** (max one per deck, never on a slide carrying an argument).
- Half and half, even → **good**.
- Pretty with no conceptual value → **bad**.
- Conceptual with no typographic taste → **bad**.
- The ratio to aim for: **information leads, style carries it.** 80/20, and never the reverse on a teaching slide.

**Every generated image in this deck must answer:** *what does this encode that the sentence above it doesn't?* If the answer is "nothing", **cut the image** and let the slide be type. A slide with no image is not a failure; a decorative image on a teaching slide is.

**Image prompt template** (use this shape for `gemini-3.1-flash-image`; the existing `modules/image-ai.js` prompts are close — the missing pieces are the claim, the label list, and the forbiddens):

```
One 16:9 explanatory plate, printed not painted: risograph, 3 spot inks + warm cream
paper, visible grain, halftone fills, slight misregistration, chunky ink lines.

THE CLAIM THIS ENCODES (one sentence): <the slide's actual claim>
THE RELATIONSHIP TO SHOW: <sequence | hierarchy | containment | comparison | count | flow>
EXACT LABELS, no other words: <5-7 short labels in reading order>
NUMBERS THAT MUST APPEAR: <the real numbers from the slide>

STYLE: <palette hexes from the theme>, technical annotation, field-notebook/observatory
plate; full-bleed; no margins, no UI chrome, no glow, no 3D, no photorealism, no gradient mesh.
FORBIDDEN: decorative metaphors (lanterns, treasure chests, cute animals as symbols),
stock-photo props, blurry bokeh, illegible pseudo-text.
LEGIBILITY: every label spelled correctly and readable at 1/3 width; max 7 labels.
```

**Asset plan** (5 real assets, in order of value):

1. **Contact sheet — ALREADY MADE.** `images/passport-look-space.webp` (1560×1173 @2×, 604 KB) plus `images/passport-look-space.meta.json` (the palette/holo/frame/texture/type/avatar of each tile). Twelve real cards from twelve passphrases, labelled with the axes that vary — 7 palettes, all 4 foils, all 4 frames, all 5 textures, 3 type styles, all 4 avatar sets. Use it as-is on slide 7.
   Recipe if it ever needs re-shooting: open `https://quickcat.club/arcade/#phrase=<twelve phrases>`, screenshot the `.passport-card` element (not the viewport) at `deviceScaleFactor: 2`, then compose the labels **in HTML** and screenshot that page. Do **not** try to label with `magick -annotate` — it fights the geometry and loses the house type; the HTML route gives real typography and a caption per tile.
   Note for the deck: contrast varies by palette (Grape Soda and Sunset run light-on-light in the type row) — mention it in the honest-limits slide rather than cropping those tiles out.
2. **Front/back pair** — same card, flipped. Proves the code lives on the back and the front stays a licence.
3. **The three layers** — one diagram: words → (HMAC) → code → (SHA-256) → identity/card, and a separate branch words → (sha256) → vault folder. This one *is* the deck; if only one image gets made properly, make it this.
4. **The round trip** — phone, arrow, vault, arrow, laptop, with the actual request lines (`POST /api/arcade/save` / `GET …?game=`), not fog.
5. **Comparison table** — render as a `table` slide, not an image. Tables beat pictures for comparison; that's the 80/20.

Do **not** generate: a hero astronaut, a padlock, a glowing cloud, a hand holding a phone. If the deck wants atmosphere, the theme already supplies it.

---

## 4. Technical contract

```jsonc
// sovereign-passport-2026.json — bare array is fine (house style: see sovereign-passport.json)
[
  { "type": "title", "eyebrow": "…", "title": "…", "subtitle": "…", "media": [ { "image": { "src": "images/…", "alt": "…", "aspectRatio": "16 / 9" } } ] },
  { "type": "standard", "badge": "…", "headline": "…", "body": ["…", { "callout": "…" }], "image": { "src": "…", "alt": "…" } },
  { "type": "split", "left": { "headline": "…", "body": ["…"] }, "right": { "headline": "…", "body": ["…"] } },
  { "type": "pillars", "pillars": [ { "title": "…", "text": "…" } ] },
  { "type": "grid", "items": [ { "color": "#F472B6", "label": "…" } ] },
  { "type": "quote", "quote": "…", "attribution": "…" },
  { "type": "image", "image": { "src": "…", "alt": "…" }, "caption": "…" }
]
```

- Full schema: `docs/SCHEMA_EXAMPLE.json`; slide types: `title, standard, scroll, quote, split, grid, pillars, gallery, typeface, image`. Callouts are **body items** (`{ callout: "info" | "didyouknow" | "warning" | "question" | "pull", title, body }`).
- Fonts per slide: `sans | mono | grotesk | jetbrains | pixel`.
- Images: put files in `images/`, reference relatively. Hosted share preserves image assets; JSON export is the full-fidelity fallback.
- Add the catalog entry (`category: "Core Deck"`, tags e.g. `["Passport", "Architecture"]`) so it appears on the launcher.
- `npm run check` must pass; the deck must also open in `deck.html?slides=sovereign-passport-2026.json` with no error slide.
- Verify visually: 1440×900 and 390×844. Text must not overflow; `pillars` and `grid` must not crush on phone.

---

## 5. Source facts (cite these, don't invent)

**Canonical module** — `~/Projects/active/_shared-modules/passport/`
`identity.js` (13 KB, `WORDS` bank 4,096 + ADJECTIVES/ANIMALS + `generateMemberIdentity`), `code.js` (namespaces + `SS-` formatting), `skins.js` (holo/frame/texture/type groups), `palettes.js` (8 palettes + Pending), `avatar.js` (DiceBear: funEmoji/thumbs/adventurer/bottts), `card.html.js` (`renderMembershipCard`), `card.css`, `README.md`, `test-vectors.json`.

**Vendored into five surfaces.** Four apps are checked byte-for-byte by `scripts/check.mjs` + `vendor.mjs`:
`talktype/src/lib/softstack-passport/` · `ziplist/src/lib/softstack-passport/` · `qrbuddy/utils/softstack-passport/` · `promapper/utils/softstack-passport/`
The fifth is the arcade (`pibulus-os/www/html/arcade/passport/`) and it is **not** byte-identical: its `card.css` is a hand-merged fork (canonical shared card + arcade sheet/badge rules) and measured 1,006 lines vs the canonical 762 on 2026-11-13, with the canonical's warm-ink tweaks (`rgba(255,254,247,…)`) missing from the arcade side. Present that as the honest state of the fifth stamp, not as parity.

**Arcade additions** (this is the storage arm, and the only one you can demo live):
`pibulus-os/www/html/arcade/passport/holopass-shelf.js` (shelf glue: vault index, badges, sheet), `holopass-player.js` (EmulatorJS save hooks), `quiet-pass.js` (moves the phrase into an `X-QCC-Pass` header), `scripts/arcade-saves-service.py` (the vault), `config/nginx/hardening.conf` (rate limit), `www/html/arcade/index.html` (rail + flip card).

**Vault shape** — `/home/pibulus/arcade-saves/<sha256(pass)[:32]>/`
`_index.json` = `{ saves: { "<game>": { timestamp, hasState, hasSram } } }`; one `*.state.json` / `*.sram.json` per game = `{ game, kind, data(base64), timestamp }`. Plaintext. Last write wins per kind.

**Numbers you may quote:** 4,096-word bank · 4 words = 48 bits = 281,474,976,710,656 · `SS-` = 12 hex chars · 8 palettes × 4 × 4 × 5 × 3 × 4 = 7,680 looks · 2 credentials per game (state + sram) · arcade catalog 3,435 games / 21 systems · vault of two DS saves ≈ 108 KB.

**Commits to cite:** `b197b04` (shelf rail), `f2b54cd` (save/load trigger restored), `5b91283` (flip), `1ed15b1` + `a8e23b8` (portrait/palette), `0a9eb32` (card as object), `4f2ce81` (unhook), `2f01f18` + `e131768` (hardening, phrase off URLs).

---

## 6. Acceptance checklist (how we'll assess the pass)

- [ ] 17 ± 2 slides, no slide carrying two ideas.
- [ ] Slide 4/5/11 each name a **file** (`identity.js`, `code.js`, the vault path) — the deck teaches the real system, not a metaphor of it.
- [ ] The three-layer diagram exists and is legible at 1/3 width.
- [ ] Contact sheet is **real screenshots**, twelve distinct looks, no repeats.
- [ ] Every generated image passes the "what does it encode" test — the reviewer asks it slide by slide, out loud.
- [ ] The limits slide is present and unflinching (no merge, no backup, LWW, plaintext).
- [ ] Nothing claims encryption that isn't shipped.
- [ ] `npm run check` clean; opens with no error slide; phone layout not broken.
- [ ] Read it cold: after slide 10 you can explain the QR to someone; after 17 you can explain the vault.
- [ ] Share link works (`/s/…`) and preserves images and theme.

---

## 7. Prompt for the build pass (paste this to the agent)

> You are building a Slide-o-Matic deck about the SoftStack Passport. Work inside `~/Projects/active/apps/slideomatic`.
>
> 1. Read `AGENTS.md`, `GLOSSARY.md`, `docs/SCHEMA_EXAMPLE.json`, and this brief in full. Also read `~/Projects/active/_shared-modules/passport/README.md`, `identity.js`, `code.js`, `skins.js`, `palettes.js`, `avatar.js` — the deck must describe *that* code.
> 2. Build `sovereign-passport-2026.json` (repo root) following §2 and §4 above. Bare slide array. Add the `catalog.json` entry.
> 3. Produce the assets in §3 in this order: contact sheet → three-layer diagram → front/back pair → round-trip plate. Generate images only where §3 says an image earns its place; otherwise let the slide be type. Use the prompt template in §3, filling in the claim, the relationship, the exact labels, and the real numbers.
> 4. Verify: `npm run check`; open `deck.html?slides=sovereign-passport-2026.json` at 1440×900 and 390×844; confirm no error slide, no overflow, no illegible image labels.
> 5. Self-assess against §6 and report: which slides fail, which images you cut, and any claim you could not source. Do not paper over a gap — list it.
> 6. Do not modify `modules/image-ai.js`, `theme.json`, or any shared module. If you think the image prompts need changing, write a separate note instead.

---

*Written as a brief, not a spec — the build pass owns the words, the deck owns the voice.*
