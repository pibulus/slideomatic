# 🔑 API Keys for slideomatic — managed by the fleet key system

Slideomatic deploys on **Netlify** and its Gemini function reads `process.env.GEMINI_API_KEY`
(raw REST — immune to the GOOGLE_API_KEY shadow bug).

## To change/rotate the key
1. Edit `~/.config/fleet/keys.env` on the Mac (`SLIDEOMATIC_GEMINI_KEY`).
2. `~/.claude/scripts/fleet/keys-sync slideomatic` (pushes to Netlify env + redeploys).
3. `~/.claude/scripts/fleet/key-doctor` to prove the live function works.

Never hand-set the key in the Netlify dashboard without updating `keys.env` first — keys.env
is the source of truth. Model: `gemini-flash-lite-latest`. Key format: `AQ.` only.
Full system: `~/.claude/scripts/fleet/README.md`.
