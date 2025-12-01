# 🧪 Local Testing Guide

Complete guide to testing all optimizations locally before deploying.

---

## 🚀 **Quick Start**

```bash
# Start Netlify dev server (includes Functions + Blobs)
netlify dev

# Open in browser
open http://localhost:8888
```

**Important**: Use `netlify dev` NOT `npm run dev` (which uses `serve`).
Only `netlify dev` runs Functions and Blobs locally.

---

## ✅ **What Works Locally**

| Feature | Local Support | Notes |
|---------|---------------|-------|
| **Image compression** | ✅ Full | Client-side browser-image-compression |
| **Share function** | ✅ Full | Netlify Blobs dev mode |
| **Deduplication** | ✅ Full | Local + global across shares |
| **Re-compression** | ✅ Full | Sharp installed, works locally |
| **Stats display** | ✅ Full | UI shows all optimization data |
| **Cleanup function** | ✅ Full | Can trigger via curl |
| **Lazy loading** | ✅ Full | IntersectionObserver (native) |
| **Netlify Image CDN** | ⚠️ Fallback | Uses direct URLs locally, CDN on deploy |

---

## 🧪 **Test Scenarios**

### **1. Basic Share (No Optimization)**

**Test text-only deck:**
```
1. Start: netlify dev
2. Create deck with 3 text slides (no images)
3. Click "Share Deck" button
4. Should see: "Share size: 2KB" (no optimization stats)
```

**Expected logs:**
```
Share optimization: 0 re-compressed, 0 deduplicated (0 global), saved 0KB
```

---

### **2. Image Compression Test**

**Test re-compression pipeline:**
```
1. Create deck with 1 slide
2. Drop a large image (e.g., screenshot, >1MB)
3. Wait for compression + upload
4. Click "Share Deck"
5. Check modal for optimization stats
```

**Expected UI:**
```
Share Details:
  Share size: 245KB
  Optimized: 680KB saved (73%)

Details: 1 image re-compressed
```

**Expected logs:**
```
Re-compressed image.png: 925000B → 245000B (73% savings)
Share optimization: 1 re-compressed, 0 deduplicated, saved 680KB
```

---

### **3. Local Deduplication Test**

**Test within-share dedup:**
```
1. Create deck with 5 slides
2. Drop same logo image on slides 1, 3, 5
3. Click "Share Deck"
4. Should see dedup stats
```

**Expected UI:**
```
Share Details:
  Optimized: 640KB saved (66%)

Details: 1 image re-compressed, 2 duplicates removed
```

**Expected logs:**
```
Re-compressed logo.png: 320000B → 140000B
Local dedup: a3f5c9e1
Local dedup: a3f5c9e1
Share optimization: 1 re-compressed, 2 deduplicated (0 global)
```

---

### **4. Global Deduplication Test** 🌍

**Test cross-share dedup (THE BIG ONE):**

**Step 1: Share deck A**
```
1. Create deck A with company logo
2. Share it
3. Note the asset ID in console
```

**Logs:**
```
Re-compressed logo.png: 320000B → 140000B
Share optimization: 1 re-compressed, 0 deduplicated, saved 180KB
```

**Step 2: Share deck B**
```
1. Create NEW deck B
2. Drop the SAME logo image
3. Share it
4. Watch for global dedup!
```

**Expected UI:**
```
Share Details:
  Optimized: 140KB saved (100%)

Details: 1 image shared globally
```

**Expected logs:**
```
Built global asset map: 1 unique hashes
Global dedup: reused logo-xyz123 (hash: a3f5c9e1, saved 140KB)
Extended expiry for logo-xyz123 (reuse count: 0)
Share optimization: 0 re-compressed, 1 deduplicated (1 global), saved 140KB
```

**Step 3: Share deck C**
```
1. Create deck C with same logo
2. Share it
3. Should reuse same asset again
```

**Expected logs:**
```
Built global asset map: 1 unique hashes
Global dedup: reused logo-xyz123 (hash: a3f5c9e1, saved 140KB)
Extended expiry for logo-xyz123 (reuse count: 1)  # Incremented!
```

---

### **5. Mixed Optimization Test**

**Test all optimizations together:**
```
1. Create deck with 8 slides
2. Add 3 unique images (will be re-compressed)
3. Add same logo to 3 slides (local dedup)
4. Share it
5. Create deck 2, reuse logo from deck 1 (global dedup)
6. Share it
```

**Expected deck 1:**
```
Share Details:
  Share size: 890KB
  Optimized: 1.2MB saved (57%)

Details: 3 images re-compressed, 2 duplicates removed
```

**Expected deck 2:**
```
Share Details:
  Share size: 650KB
  Optimized: 820KB saved (55%)

Details: 2 images re-compressed, 1 image shared globally
```

---

### **6. Cleanup Function Test**

**Test expired share cleanup:**

**Create test scenario:**
```bash
# In another terminal (while netlify dev running):

# Dry run (see what would be deleted)
curl "http://localhost:8888/.netlify/functions/cleanup-shares?dryRun=true"

# Execute cleanup
curl "http://localhost:8888/.netlify/functions/cleanup-shares"
```

**Expected response:**
```json
{
  "sharesScanned": 3,
  "sharesDeleted": 0,
  "assetsScanned": 5,
  "assetsDeleted": 0,
  "bytesFreedMB": "0.00",
  "dryRun": false,
  "timestamp": "2025-11-29T..."
}
```

**Note**: Won't delete anything because expiry is 30 days from creation.
To test deletion, you'd need to manually edit blob metadata (not recommended).

---

### **7. Toast Notification Test**

**Test celebration toast:**
```
1. Create deck with large image (>500KB original)
2. Share it
3. If savings > 100KB, toast appears:
   "🎉 Optimized! Saved 420KB (68%) via re-compression"
```

**Toast variations:**
- Re-compression only: "via re-compression"
- Dedup only: "via deduplication"
- Both: "via compression & deduplication"

---

### **8. Lazy Loading Test**

**Test image lazy loading:**
```
1. Create deck with 20 slides
2. Add images to slides 1, 5, 10, 15, 20
3. Open slide 1
4. Check Network tab in DevTools
5. Only images near current slide should load
6. Navigate to slide 10
7. Images near slide 10 load
```

**Preload window**: 200px before/after viewport

---

## 🔍 **Debugging**

### **Check Netlify Blobs**

**View all shares:**
```bash
# Install Netlify CLI tools
netlify blobs:list deck-assets
netlify blobs:list shared-decks
```

### **Check Function Logs**

In terminal running `netlify dev`, look for:
```
Built global asset map: 5 unique hashes
Global dedup: reused logo-abc123
Extended expiry for logo-abc123 (reuse count: 2)
Share optimization: 1 re-compressed, 2 deduplicated (1 global), saved 680KB
```

### **Check Browser Console**

Open DevTools → Console, look for:
```
[Slideomatic] Image uploaded, re-rendering slide 0
Share optimization: {...}
```

### **Check Network Tab**

Look for:
```
POST /.netlify/functions/share → 200 OK
Response: { shareUrl, bytes, optimization: {...} }
```

---

## ⚠️ **Known Local Limitations**

1. **Netlify Image CDN**: Falls back to direct URLs
   - Production: `/.netlify/images?url=...&w=1600&q=75`
   - Local: `/.netlify/functions/asset?id=...`
   - Both work, just different endpoints

2. **Sharp on M1/M2 Macs**: May need Rosetta
   - If compression fails, check: `npm rebuild sharp`

3. **Blob Persistence**: Local blobs stored in `.netlify/blobs-serve/`
   - Survives server restart
   - Delete folder to reset

---

## 📊 **Success Checklist**

Test each feature:
- [ ] Share text-only deck
- [ ] Share deck with 1 image (compression)
- [ ] Share deck with duplicate images (local dedup)
- [ ] Share multiple decks with same image (global dedup)
- [ ] See optimization stats in modal
- [ ] See toast notification (>100KB savings)
- [ ] Trigger cleanup function
- [ ] Verify lazy loading in Network tab
- [ ] Check server logs for optimization data

---

## 🚨 **Troubleshooting**

### **"Share service unavailable"**
```bash
# Make sure you're using netlify dev, not npm run dev
netlify dev
```

### **Images don't compress**
```bash
# Reinstall sharp
npm install sharp
npm rebuild sharp
```

### **No global dedup happening**
```bash
# Check blobs list
netlify blobs:list deck-assets

# Should show assets with hash metadata
```

### **Function timeout**
```bash
# Check netlify.toml has timeout config
[functions]
  timeout = 30
```

---

## 🎉 **You're Ready!**

All optimizations should work locally. The only difference from production is:
- Netlify Image CDN (uses direct URLs locally)
- Scheduled cleanup (manual trigger only)

Everything else is **identical** to production! 🚀
