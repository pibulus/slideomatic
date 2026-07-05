# Voice-to-Slide + Dictation

Generate slides, edit with speech, and clean up spoken prompts using Gemini AI.

## Setup

1. Get a Gemini API key from Google AI Studio: https://aistudio.google.com/app/apikey

2. Open the deck (`deck.html`) and press `S` or click the settings button in the HUD.

3. Paste your key into the **Gemini API Key** field, then hit **Save Key**. You can optionally use **Test Connection** to verify it.

4. The key is stored locally in your browser via `localStorage`—no code changes required.

## Usage

### Keyboard Shortcut
Press `V` to start/stop voice-to-slide recording.

### Mic Buttons
Use the mic buttons in the edit drawer and cheat console to dictate into prompt/body fields. The app sends the short recording to Gemini, removes filler/stumbles, and inserts clean text back into the active field.

### Recording Flow
1. **Press V or click the voice button** - Mic icon turns to ⏹ (red, pulsing)
2. **Speak your slide description** - Be specific about content, images, layout
3. **Press V again to stop** - Button shows ⚡ (processing)
4. **Wait ~3-5 seconds** - Gemini generates the slide
5. **New slide appears** - Inserted after your current slide

## Voice Command Examples

### Good Commands ✅

**"Create a slide about vintage synthesizers with three examples"**
→ Generates a `grid` slide with 3 image placeholders (searchable terms: "moog synthesizer", "roland jupiter", "arp odyssey")

**"Make a quote slide: 'Move fast and break things' attributed to Mark Zuckerberg"**
→ Generates a `quote` slide with proper formatting

**"Add a title slide called 'The Future of Design' with subtitle 'Bold ideas for 2025'"**
→ Generates a `title` slide with headline and subtitle

**"Split layout: left side is features, right side shows a product screenshot"**
→ Generates a `split` slide with two columns

**"Gallery of three modern office spaces"**
→ Generates `gallery` with 3 image placeholders

### Advanced Examples 🔥

**"Pillars slide about our values: Innovation, Quality, Community, Speed. Each pillar should have a description and an icon"**
→ Smart `pillars` layout with 4 cards

**"Full-screen image of a sunset over mountains with caption 'Where we're headed'"**
→ `image` slide with full-bleed visual

## How It Works

### AI Design Brain
Gemini analyzes your voice and:
- **Chooses the best slide type** (grid, quote, split, etc.)
- **Writes punchy headlines** (5-7 words max)
- **Creates searchable image terms** - Uses FINDABLE Google Image search terms
- **Structures content** - Proper JSON matching Slideomatic schema

### Image Search Strategy
The AI is trained to create **smart image alt text** that works with Google Images:

✅ **Good**: "vintage synthesizer", "modern office workspace", "mountain sunset"
❌ **Bad**: "moog model d serial 12345", "apple macbook pro m1 2021"

This means when you click the 🔍 button on placeholders, you'll actually find good images!

## Button States

| State | Icon | Color | Meaning |
|-------|------|-------|---------|
| Ready | 🎙 | Pink | Click to record |
| Recording | ⏹ | Red (pulsing) | Speak now, click to stop |
| Processing | ⚡ | Yellow (pulsing) | AI is generating slide |

## Slide Types Gemini Can Generate

1. **title** - Hero slide with big title, subtitle, media strip
2. **standard** - Headline + body + optional image
3. **quote** - Large quote with attribution
4. **split** - Two-column layout
5. **grid** - Grid of images/colors
6. **pillars** - Feature cards (2-4 columns)
7. **gallery** - Visual gallery with labels
8. **image** - Full-bleed image with caption
9. **graph** - AI-generated infographic or chart image
10. **typeface** - Font showcase

## Tips for Best Results

### Be Specific
"Create a pillars slide with 4 features" → Better than "Make a slide about features"

### Mention Layout
"Split slide" or "Gallery with 3 items" helps Gemini choose the right type

### For Images
Say "with examples" or "with visuals" and Gemini will add searchable image placeholders

### Quote Syntax
Use natural language: "Quote slide that says X by Y" or "Add a quote from..."

## Troubleshooting

### "Failed to access microphone"
→ Grant microphone permissions in your browser settings

### "Failed to create slide: Gemini API call failed"
→ Open Settings with `S`, save your API key, then use **Test Connection**.

### "Failed to create slide: Invalid JSON"
→ Rare AI hallucination - try recording again with clearer instructions

### Slide doesn't match expectations
→ Be more specific! Say "grid slide with 3 items" instead of just "about synthesizers"

## Privacy & Cost

**Privacy**: Audio is sent to Google's Gemini API for processing. Not stored anywhere.

**Cost**: Generation and transcription use the rolling `gemini-flash-latest` alias via the server-side proxy. Without a personal key the shared app key covers usage; with your own key (Settings), your API usage shows in Google AI Studio.

## Post-v1 Ideas

- [ ] Voice navigation ("go to slide 5")
- [ ] More explicit batch generation controls ("create 10 slides about X")
- [ ] Custom voice shortcuts (saved phrases)
- [ ] Offline mode with local whisper.cpp

---

Built with Gemini 2.5 Flash and Flash Lite multimodal APIs.
