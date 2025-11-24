import { CONFIG, debug } from './constants.js';
import { slides, slideElements, isOverview, currentIndex } from './state.js';
import { replaceSlideAt, setActiveSlide } from './slide-actions.js';
import { showHudStatus, hideHudStatus } from './hud.js';

// ═══════════════════════════════════════════════════════════════════════════
// Image Utilities Module
// ═══════════════════════════════════════════════════════════════════════════

const assetDeletionQueue = new Map();
let assetCleanupTimer = null;

export function buildImageSearchUrl(query) {
    const url = new URL('https://www.google.com/search');
    url.searchParams.set('tbm', 'isch');
    url.searchParams.set('q', query);
    return url.toString();
}

export function extractSlideContext(placeholderElement) {
    const slideElement = placeholderElement.closest('.slide');
    const slideIndex = slideElement ? slideElements.indexOf(slideElement) : -1;
    const slide = slideIndex >= 0 ? slides[slideIndex] : {};

    return {
        slideIndex,
        slide,
        headline: slide.headline || slide.title || '',
        body: Array.isArray(slide.body) ? slide.body.join(' ') : (slide.body || ''),
        slideType: slide.type || 'standard'
    };
}

export function findSlideIndexForPlaceholder(placeholderElement) {
    const slideElement = placeholderElement.closest('.slide');
    if (!slideElement) return -1;
    return slideElements.indexOf(slideElement);
}

export function updateSlideImage(slideIndex, imageData, placeholderElement) {
    if (slideIndex < 0 || slideIndex >= slides.length) return;

    const slide = slides[slideIndex];
    const targetImageRef = placeholderElement?._imageRef;

    if (targetImageRef) {
        const updated = findAndUpdateImageInSlide(slide, targetImageRef, imageData);
        if (updated) {
            debug('Updated image in nested structure');
            return;
        }
    }

    debug('Fallback to top-level slide.image');
    if (!slide.image) {
        slide.image = {};
    }
    handleImageReplacement(slide.image, imageData);
    Object.assign(slide.image, imageData);
}

function findAndUpdateImageInSlide(slide, targetImageRef, newImageData) {
    if (slide.image === targetImageRef) {
        handleImageReplacement(targetImageRef, newImageData);
        Object.assign(slide.image, newImageData);
        return true;
    }

    if (Array.isArray(slide.media)) {
        for (const mediaItem of slide.media) {
            if (mediaItem.image === targetImageRef) {
                handleImageReplacement(mediaItem.image, newImageData);
                Object.assign(mediaItem.image, newImageData);
                return true;
            }
        }
    }

    if (Array.isArray(slide.items)) {
        for (const item of slide.items) {
            if (item.image === targetImageRef) {
                handleImageReplacement(item.image, newImageData);
                Object.assign(item.image, newImageData);
                return true;
            }
        }
    }

    if (slide.left?.image === targetImageRef) {
        handleImageReplacement(slide.left.image, newImageData);
        Object.assign(slide.left.image, newImageData);
        return true;
    }
    if (slide.right?.image === targetImageRef) {
        handleImageReplacement(slide.right.image, newImageData);
        Object.assign(slide.right.image, newImageData);
        return true;
    }

    if (Array.isArray(slide.pillars)) {
        for (const pillar of slide.pillars) {
            if (pillar.image === targetImageRef) {
                handleImageReplacement(pillar.image, newImageData);
                Object.assign(pillar.image, newImageData);
                return true;
            }
        }
    }

    return false;
}

function handleImageReplacement(existingImage, nextImageData) {
    if (!existingImage || typeof existingImage !== 'object') return;
    maybeScheduleAssetCleanup(existingImage);
    if (!nextImageData.uploadedAt) {
        nextImageData.uploadedAt = Date.now();
    }
}

export function showImageError(placeholderElement, message) {
    const text = placeholderElement.querySelector('.image-placeholder__text');
    if (!text) return;

    const previousText = text.dataset.originalText || text.textContent;
    text.dataset.originalText = previousText;
    text.textContent = message;
    placeholderElement.classList.add('image-placeholder--error');

    setTimeout(() => {
        text.textContent = text.dataset.originalText || previousText;
        delete text.dataset.originalText;
        placeholderElement.classList.remove('image-placeholder--error');
    }, 3000);
}

export function maybeScheduleAssetCleanup(image) {
    if (!image || !image.assetId) return;
    debug('Scheduling asset cleanup for:', image.assetId);
    assetDeletionQueue.set(image.assetId, Date.now());
    scheduleFlush();
}

function scheduleFlush() {
    if (assetCleanupTimer) return;
    assetCleanupTimer = setTimeout(() => {
        flushAssetDeletions();
        assetCleanupTimer = null;
    }, 10000);
}

export async function flushAssetDeletions(force = false) {
    if (assetDeletionQueue.size === 0) return;

    const assetsToDelete = Array.from(assetDeletionQueue.keys());
    debug('Flushing asset deletions:', assetsToDelete);

    try {
        await fetch('/.netlify/functions/delete-assets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetIds: assetsToDelete }),
            keepalive: true,
        });
        assetDeletionQueue.clear();
    } catch (error) {
        console.warn('Failed to flush asset deletions:', error);
    }
}

export function cleanupSlideAssets(slide) {
    if (!slide) return;
    const images = [];
    if (slide.image) images.push(slide.image);
    if (Array.isArray(slide.media)) slide.media.forEach(m => m.image && images.push(m.image));
    if (Array.isArray(slide.items)) slide.items.forEach(i => i.image && images.push(i.image));
    if (slide.left?.image) images.push(slide.left.image);
    if (slide.right?.image) images.push(slide.right.image);
    if (Array.isArray(slide.pillars)) slide.pillars.forEach(p => p.image && images.push(p.image));

    images.forEach(img => maybeScheduleAssetCleanup(img));
}

export function cleanupAllSlideAssets() {
    slides.forEach(slide => cleanupSlideAssets(slide));
}

export function normalizeOrientation(val) {
    if (!val) return null;
    const lower = String(val).toLowerCase().trim();
    if (lower.startsWith('land')) return 'landscape';
    if (lower.startsWith('port')) return 'portrait';
    if (lower.startsWith('sq')) return 'square';
    return null;
}

export function deriveOrientationFromDimensions(width, height) {
    if (!width || !height) return null;
    const ratio = width / height;
    if (ratio > 1.2) return 'landscape';
    if (ratio < 0.85) return 'portrait';
    return 'square';
}
