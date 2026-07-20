// ═══════════════════════════════════════════════════════════════════════════
// Base64 Tokens Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Handles conversion between base64 image payloads and human-readable tokens
// so that JSON editing in the drawer remains manageable.
// - Generates display tokens for embedded base64 images
// - Prepares slides for editing (deep clone with tokens)
// - Restores original base64 strings before persisting changes
//
// Dependencies: utils.js
// Used by: edit-drawer.js, main.js
//
// ═══════════════════════════════════════════════════════════════════════════

import { formatBytes } from './utils.js';

function createBase64Token(imageData) {
  const filename = imageData.originalFilename || 'image';
  const size = imageData.compressedSize
    ? formatBytes(imageData.compressedSize)
    : 'unknown size';
  return `{{BASE64_IMAGE: ${filename}, ${size}}}`;
}

function isBase64Token(str) {
  return typeof str === 'string' && str.startsWith('{{BASE64_IMAGE:');
}

function replaceBase64WithToken(imageObj) {
  if (!imageObj || typeof imageObj !== 'object') return imageObj;

  const result = { ...imageObj };

  if (result.src && typeof result.src === 'string' && result.src.startsWith('data:image')) {
    result.src = createBase64Token(result);
  }

  return result;
}

// Every path where a slide can hold an image object — the single source of
// truth for the tokenize/restore/collect walks below.
function imagePaths(slide) {
  if (!slide || typeof slide !== 'object') return [];
  const paths = [];
  if (slide.image) paths.push(['image']);
  if (Array.isArray(slide.media)) slide.media.forEach((m, i) => m?.image && paths.push(['media', i, 'image']));
  if (Array.isArray(slide.items)) slide.items.forEach((it, i) => it?.image && paths.push(['items', i, 'image']));
  if (slide.left?.image) paths.push(['left', 'image']);
  if (slide.right?.image) paths.push(['right', 'image']);
  if (Array.isArray(slide.pillars)) slide.pillars.forEach((p, i) => p?.image && paths.push(['pillars', i, 'image']));
  return paths;
}

function getAtPath(obj, path) {
  return path.reduce((node, key) => node?.[key], obj);
}

function setAtPath(obj, path, value) {
  const parent = getAtPath(obj, path.slice(0, -1));
  if (parent) parent[path[path.length - 1]] = value;
}

function prepareSlideForEditing(slide) {
  // Deep clone to avoid mutating original
  const clone = JSON.parse(JSON.stringify(slide));
  imagePaths(clone).forEach((path) => {
    setAtPath(clone, path, replaceBase64WithToken(getAtPath(clone, path)));
  });
  return clone;
}

function restoreBase64InImage(editedImage, originalImage) {
  if (!editedImage || typeof editedImage !== 'object') return editedImage;

  const result = { ...editedImage };

  if (isBase64Token(result.src)) {
    if (originalImage?.src?.startsWith('data:image')) {
      result.src = originalImage.src;
    } else {
      console.warn('Base64 token found but no original image data to restore');
      result.src = '';
    }
  }

  return result;
}

function restoreBase64FromTokens(editedSlide, originalSlide) {
  // Deep clone so the token-rescue pass below can mutate slots freely without
  // reaching back into the caller's edited object.
  const result = JSON.parse(JSON.stringify(editedSlide));

  // Positional restore: same slot in the edited and original slide.
  imagePaths(result).forEach((path) => {
    const originalImage = getAtPath(originalSlide, path);
    if (originalImage) {
      setAtPath(result, path, restoreBase64InImage(getAtPath(result, path), originalImage));
    }
  });

  // The positional restore above misses reordered arrays (e.g. gallery items
  // swapped in the JSON editor). Rescue leftover tokens by matching against
  // ALL of the original slide's images — the token text embeds filename +
  // size — and never let a literal {{BASE64_IMAGE:…}} string persist as src.
  const tokenMap = new Map();
  collectImages(originalSlide).forEach((img) => {
    if (typeof img?.src === 'string' && img.src.startsWith('data:image')) {
      tokenMap.set(createBase64Token(img), img.src);
    }
  });
  collectImages(result).forEach((img) => {
    if (img && isBase64Token(img.src)) {
      const restored = tokenMap.get(img.src);
      if (restored) {
        img.src = restored;
      } else {
        console.warn('Base64 token had no matching original image — blanking src');
        img.src = '';
      }
    }
  });

  return result;
}

function collectImages(slide) {
  return imagePaths(slide).map((path) => getAtPath(slide, path));
}

export {
  createBase64Token,
  isBase64Token,
  prepareSlideForEditing,
  restoreBase64FromTokens,
  formatBytes,
};

