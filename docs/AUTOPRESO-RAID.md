# AUTOPRESO RAID 🏴‍☠️
> Star-raid study: `kunchenguid/autopreso` (~407 ⭐) vs slideomatic.
> Read-only recon, 2026-07-19. Clone lives at `~/Projects/active/experiments/star-raid/autopreso`.

## What autopreso actually is

"Let the whiteboard whiteboard itself." You talk, an agent draws an Excalidraw
canvas live. Not a slide app at all — it's a realtime visual note-taker. But the
*plumbing* between mic and canvas is the good stuff.

The pipeline, 8 lines:

1. Browser mic → 24kHz PCM → local Express/WS server (127.0.0.1 only, nothing leaves the machine unless you pick OpenAI).
2. STT is swappable: **Moonshine** (local macOS sidecar binary, npm-shipped per-arch) or **OpenAI Realtime WS**. Ollama option for the agent too — fully local mode exists.
3. Turn boundaries come from **delta-quiet timing**: 1000ms with no new transcription delta = "that was one thought", flush it as a turn. No VAD trust, no waiting for `completed` events.
4. Turns pass a **filler gate**: "uh", "um", "so, like, yeah" never reach the LLM. They accumulate until a real word shows up, then fire as one combined turn.
5. A **turn queue** guarantees exactly one agent call in flight; transcripts arriving mid-turn coalesce and run as the next single turn.
6. The agent sees the canvas as **line-numbered JSON** and edits it with three ops: `replace` / `insert_after` / `delete` (plus a viewport command). One tool call per turn, enforced by prompt.
7. A **warmup loop** primes the provider's prompt cache with the exact request prefix before you say word one, retrying with backoff until ≥50% cached.
8. Staged content gets keyword-extracted and fed to the STT as a **vocabulary bias prompt**, so your product names don't transcribe as soup.

Whole thing is ~5k lines of dependency-light vanilla Node + vanilla JS frontend.
Philosophically it's a cousin: local-first, no build step worship, one thing done well.

## What slideomatic is today (for contrast)

Vanilla JS, no framework, no build step. `deck.html` + `main.js` + `modules/*`.
Voice exists but it's **batch**: press V → MediaRecorder records → press V again →
whole Opus blob goes to Gemini multimodal (`modules/voice-modes.js`,
`processVoiceToSlide`) → one slide JSON comes back → inserted. Push-to-talk,
one slide per take, 3-5s wait. No listening mode, no segmentation, no deck-editing
via voice beyond the cheat console.

That gap — batch vs stream — is the entire raid.

---

## The steals

### 1. Delta-quiet turn segmentation ⭐ (the crown jewel)
**What:** Don't ask the user to press stop. Watch the transcript stream; when no
new text has arrived for ~1s, the utterance is over — flush it as a unit of work.
It's ~30 lines: a timer that re-arms on every delta and fires a flush when it
survives.
**Where:** `src/openai-transcription.js` lines 12-99 (`DEFAULT_DELTA_QUIET_MS`,
`scheduleDeltaQuietFlush`, `flushPartialAsTurn`). The comment block at the top
explains *why* they don't trust VAD — worth reading verbatim.
**Slideomatic mapping:** This is how you get **Preso Mode**: press V *once*, then
just talk. Browser `SpeechRecognition` gives free streaming interim results (its
`onresult` events ARE the deltas) — you don't even need it to be accurate, you
need it as a *silence detector*. Quiet timer fires → slice the rolling
MediaRecorder audio (or just take the recognized text) → feed the existing
`processVoiceToSlide` → slide pops in while you keep talking. You already own
the entire utterance→slide half; this is the missing segmenter.

### 2. Filler gate + single-flight turn queue
**What:** Two tiny pieces. (a) `isTrivialTranscript`: a Set of filler words +
three rules — never burn an LLM call on "uh, yeah, okay". Fillers accumulate
until real content arrives, then ship as one turn. (b) A queue where exactly one
agent call runs at a time; anything arriving mid-flight gets joined with `\n`
and runs as the *next single* call — no pileups, no interleaving, no rate-limit
storms.
**Where:** `src/whiteboard-session.js` lines 6-28 (`FILLER_WORDS`,
`isTrivialTranscript`) and `src/transcript-turn-queue.js` (78 lines, fully
self-contained, has its own tests).
**Slideomatic mapping:** Lift `transcript-turn-queue.js` nearly wholesale into a
new `modules/voice-preso.js`. It's dependency-free vanilla JS — it would pass
your own lint. This is the piece that makes Preso Mode not fall over when you
talk fast or cough. The filler set is the cheapest cost-guard you'll ever add.

### 3. Line-numbered state + edit ops (voice-EDIT the deck, not just append)
**What:** Instead of regenerating everything or only appending, autopreso shows
the model the current canvas as numbered lines of JSON and accepts three surgical
ops: `replace line N`, `insert_after N`, `delete N`. Tool result returns the new
numbered state as the authoritative truth, so multi-op turns can't drift.
**Where:** `src/whiteboard-tools.js` (48 lines — `formatLineNumberedWhiteboard`,
`applyWhiteboardEditOperations`) + the zod op schema in `src/server.js` ~line 358.
**Slideomatic mapping:** Your deck IS already a JSON array of slides. Number it,
hand it to Gemini with the transcript, accept `{replace|insert_after|delete, line, slide}`
ops. Suddenly "actually make slide 3 a quote from Ursula K. Le Guin" and "kill
the last slide" work by voice. This upgrades voice from a slide-maker to a
deck-editor, and it's mostly a prompt change plus a 40-line ops applier.

### 4. STT vocabulary biasing from existing content
**What:** Before listening starts, extract the distinct text terms already on the
canvas, longest-first, cap at 500 chars, prepend "Domain vocabulary that may
appear: …" to the transcription prompt. Product names stop mis-transcribing.
**Where:** `src/whiteboard-keywords.js` (43 lines) + how it's injected in
`src/openai-transcription.js` `setSessionContext`.
**Slideomatic mapping:** Trivially portable — you already send a text prompt with
every Gemini audio call (`transcribeSpeechToText`, `buildCleanTranscriptionPrompt`).
Walk the current deck's headlines/body/labels, append the vocab line. Ten lines
of code, immediately better transcripts of "Hexbloop" and "neo-toybrut".

### 5. Session token invalidation
**What:** `state.session = {id, active}`. Every in-flight operation captures the
token at start; Stop/Reset flips `active=false` and swaps a fresh token, so late
LLM responses become no-ops instead of mutating the next session. You already
fought exactly this class of bug (`isStartingRecording` double-press hot-mic fix
in `voice-modes.js`) — this is the general cure.
**Where:** `src/whiteboard-session.js` lines 56-63 + `endSession`, and the
`mySession.active` checks in `src/server.js` `runWhiteboardAgent`.
**Slideomatic mapping:** One object, a few `if (!mySession.active) return` lines
in the voice callbacks. Do it the day Preso Mode lands, because continuous mode
multiplies the ways a stale response can land after Stop.

---

## What NOT to steal

- **The prompt-cache warmup loop** (`startWarmupLoop`, ~100 lines + the priming
  message choreography in `server.js`). Genuinely clever — it retries until the
  provider confirms ≥50% of the prefix cached, then appends the exact priming
  pair to history so turn 1 hits cache. But it's OpenAI-prefix-cache specific,
  saves cents-per-session at autopreso's token volumes, and is exactly the kind
  of complexity-theatre that Gemini flash-lite pricing makes pointless for us.
  Admire, close tab.
- **Moonshine local STT sidecar.** Per-arch native binaries shipped as npm
  packages, a Python build script, macOS-only. Cool sovereignty flex, wrong tree
  for a zero-build browser PWA. If local STT ever matters, whisper.cpp WASM in
  the browser is the slideomatic-shaped answer (it's already in VOICE_TO_SLIDE.md's
  post-v1 list).
- **Multi-provider agent plumbing** (`agent-provider.js`, `codex-auth.js`).
  Provider switchboards violate THE ONE LAW of the fleet key system, and
  slideomatic's Gemini proxy + user-key fallback already covers both "free" and
  "BYO key". One model alias, no drift.
- **The 160-line layout monolith prompt** (`server.js` `whiteboardSystemPrompt`).
  It's for an infinite canvas with coordinates and arrows. Slideomatic's slide
  *types* already encode layout — that's the smarter compression. Skim it once
  for the pattern-library idea (parallel peers / comparison / timeline / hero →
  which visual form) since it rhymes with your type-picker prompt, but don't
  import the beast.
- **The whole server.** autopreso needs Express+WS because STT and the agent run
  in Node. Slideomatic's browser-only + Netlify-proxy shape is lighter and
  already deployed. Keep it.

---

## The 80/20 verdict

**One graft: Preso Mode = steal #1 + steal #2, wrapped around the code you
already have.**

Press V once. `SpeechRecognition` runs as a silence detector, the delta-quiet
timer chunks your speech into thoughts, the filler gate drops the "um"s, the
turn queue feeds each thought — one at a time — into the *existing*
`processVoiceToSlide` pipeline. Slides materialize on the projector while you're
still talking. Stop was never pressed.

Cost: one new module (~150 lines, half of it lift-able verbatim from
`transcript-turn-queue.js`), zero new dependencies, zero backend changes, zero
new keys. The utterance→slide half — the hard half — already works and ships
today. What it buys: the app's whole identity jumps from "voice-controlled slide
builder" to "talk and the deck builds itself." That's the demo that makes people
grab your arm. Same magic autopreso's 407 stars are for, on a pipeline you
already own 80% of.

Steal #4 (vocab biasing) is the bonus round: ten lines, do it the same afternoon.
Steal #3 (edit ops) is the worthy v2 once Preso Mode proves out.

*Raid complete. Nothing was modified, nobody saw us. -C*
