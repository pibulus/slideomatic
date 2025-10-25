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

function prepareSlideForEditing(slide) {
  // Deep clone to avoid mutating original
  const clone = JSON.parse(JSON.stringify(slide));

  if (clone.image) {
    clone.image = replaceBase64WithToken(clone.image);
  }

  if (Array.isArray(clone.media)) {
    clone.media = clone.media.map((mediaItem) => {
      if (mediaItem.image) {
        return { ...mediaItem, image: replaceBase64WithToken(mediaItem.image) };
      }
      return mediaItem;
    });
  }

  if (Array.isArray(clone.items)) {
    clone.items = clone.items.map((item) => {
      if (item.image) {
        return { ...item, image: replaceBase64WithToken(item.image) };
      }
      return item;
    });
  }

  if (clone.left?.image) {
    clone.left = { ...clone.left, image: replaceBase64WithToken(clone.left.image) };
  }
  if (clone.right?.image) {
    clone.right = { ...clone.right, image: replaceBase64WithToken(clone.right.image) };
  }

  if (Array.isArray(clone.pillars)) {
    clone.pillars = clone.pillars.map((pillar) => {
      if (pillar.image) {
        return { ...pillar, image: replaceBase64WithToken(pillar.image) };
      }
      return pillar;
    });
  }

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
  const result = { ...editedSlide };

  if (result.image && originalSlide.image) {
    result.image = restoreBase64InImage(result.image, originalSlide.image);
  }

  if (Array.isArray(result.media) && Array.isArray(originalSlide.media)) {
    result.media = result.media.map((mediaItem, index) => {
      if (mediaItem.image && originalSlide.media[index]?.image) {
        return { ...mediaItem, image: restoreBase64InImage(mediaItem.image, originalSlide.media[index].image) };
      }
      return mediaItem;
    });
  }

  if (Array.isArray(result.items) && Array.isArray(originalSlide.items)) {
    result.items = result.items.map((item, index) => {
      if (item.image && originalSlide.items[index]?.image) {
        return { ...item, image: restoreBase64InImage(item.image, originalSlide.items[index].image) };
      }
      return item;
    });
  }

  if (result.left?.image && originalSlide.left?.image) {
    result.left = { ...result.left, image: restoreBase64InImage(result.left.image, originalSlide.left.image) };
  }
  if (result.right?.image && originalSlide.right?.image) {
    result.right = { ...result.right, image: restoreBase64InImage(result.right.image, originalSlide.right.image) };
  }

  if (Array.isArray(result.pillars) && Array.isArray(originalSlide.pillars)) {
    result.pillars = result.pillars.map((pillar, index) => {
      if (pillar.image && originalSlide.pillars[index]?.image) {
        return { ...pillar, image: restoreBase64InImage(pillar.image, originalSlide.pillars[index].image) };
      }
      return pillar;
    });
  }

  return result;
}

export {
  createBase64Token,
  isBase64Token,
  prepareSlideForEditing,
  restoreBase64FromTokens,
  formatBytes,
};

