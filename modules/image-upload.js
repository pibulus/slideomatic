import { CONFIG, debug } from './constants.js';
import { showHudStatus, hideHudStatus } from './hud.js';
import { formatBytes, fileToBase64 } from './utils.js';
import { slides, slideElements, isOverview, currentIndex } from './state.js';
import { replaceSlideAt, setActiveSlide } from './slide-actions.js';
import {
    updateSlideImage,
    findSlideIndexForPlaceholder,
    showImageError
} from './image-utils.js';

// ═══════════════════════════════════════════════════════════════════════════
// Image Upload Module
// ═══════════════════════════════════════════════════════════════════════════

const MAX_IMAGE_BYTES = CONFIG.IMAGE.MAX_BYTES;
const TARGET_IMAGE_BYTES = CONFIG.IMAGE.TARGET_BYTES;

export async function handleImageUpload(file, placeholderElement, imageConfig = {}) {
    if (!file.type.startsWith('image/')) {
        showImageError(placeholderElement, 'Please drop an image file');
        return;
    }

    const text = placeholderElement.querySelector('.image-placeholder__text');
    const icon = placeholderElement.querySelector('.image-placeholder__icon');
    const originalText = text.textContent;
    const originalIcon = icon.textContent;

    text.textContent = 'Compressing...';
    icon.textContent = '⏳';
    placeholderElement.disabled = true;

    let hadError = false;

    try {
        const { file: compressedFile, format: outputFormat, hitSoftLimit } = await compressImage(file);
        const resolvedFormat = compressedFile.type || outputFormat || file.type || 'image/webp';
        const sizeInBytes = compressedFile.size;
        const sizeLabel = formatBytes(sizeInBytes);

        if (sizeInBytes > MAX_IMAGE_BYTES) {
            throw new Error(`Image still too large (${sizeLabel}); try a smaller original.`);
        }

        const dataUrl = await fileToBase64(compressedFile);
        let uploadResult = null;
        let usedInlineFallback = false;

        try {
            text.textContent = 'Uploading...';
            uploadResult = await uploadOptimizedImage({
                dataUrl,
                mimeType: resolvedFormat,
                filename: file.name,
                size: sizeInBytes,
            });
        } catch (uploadError) {
            usedInlineFallback = true;
            console.warn('Asset upload failed, falling back to inline data', uploadError);
            showHudStatus('Using local image only — run `netlify dev` to enable sharing', 'warning');
            setTimeout(hideHudStatus, 2800);
        }

        const slideIndex = findSlideIndexForPlaceholder(placeholderElement);
        if (slideIndex !== -1) {
            updateSlideImage(slideIndex, {
                src: uploadResult?.url ?? dataUrl,
                alt: imageConfig.alt || file.name.replace(/\.[^/.]+$/, ''),
                originalFilename: file.name,
                compressedSize: sizeInBytes,
                compressedFormat: resolvedFormat,
                uploadedAt: Date.now(),
                assetId: uploadResult?.assetId ?? null,
                storage: uploadResult ? 'netlify-asset' : 'inline',
            }, placeholderElement);

            debug('Image uploaded, re-rendering slide', slideIndex);
            replaceSlideAt(slideIndex, { focus: false });
            if (!isOverview) {
                setActiveSlide(slideIndex);
            }
            if (hitSoftLimit) {
                console.warn(`Image for slide ${slideIndex} landed above soft target (${sizeLabel}).`);
            }
            const statusType = hitSoftLimit ? 'warning' : 'success';
            const statusMessage = hitSoftLimit
                ? `Image added (${sizeLabel}) — hit quality floor`
                : usedInlineFallback
                    ? `Image added locally (${sizeLabel})`
                    : `Image added (${sizeLabel})`;
            showHudStatus(statusMessage, statusType);
            setTimeout(hideHudStatus, hitSoftLimit ? 3000 : 2000);
        }
    } catch (error) {
        hadError = true;
        console.error('Image upload failed:', error);
        icon.textContent = originalIcon;
        text.textContent = originalText;
        showImageError(placeholderElement, error.message);
    } finally {
        placeholderElement.disabled = false;
        if (!hadError) {
            text.textContent = originalText;
            icon.textContent = originalIcon;
            delete text.dataset.originalText;
        }
    }
}

export async function compressImage(file) {
    if (typeof imageCompression === 'undefined') {
        if (file.size > MAX_IMAGE_BYTES) {
            throw new Error('Compression library unavailable — use a smaller image (<512KB).');
        }
        return { file, format: file.type || 'image/png', hitSoftLimit: file.size > TARGET_IMAGE_BYTES };
    }

    if (file.size <= TARGET_IMAGE_BYTES) {
        return { file, format: file.type || 'image/png', hitSoftLimit: false };
    }

    const preferredFormats = [];
    if (file.type !== 'image/webp') {
        preferredFormats.push('image/webp');
    }
    if (file.type && !preferredFormats.includes(file.type)) {
        preferredFormats.push(file.type);
    }
    if (!preferredFormats.includes('image/jpeg')) {
        preferredFormats.push('image/jpeg');
    }
    if (!preferredFormats.includes('image/png')) {
        preferredFormats.push('image/png');
    }

    const dimensionSteps = CONFIG.IMAGE.DIMENSION_STEPS;
    const qualitySteps = CONFIG.IMAGE.QUALITY_STEPS;
    let bestCandidate = null;

    for (const format of preferredFormats) {
        for (const dimension of dimensionSteps) {
            const qualities = format === 'image/png' ? [1] : qualitySteps;
            for (const quality of qualities) {
                const options = {
                    maxWidthOrHeight: dimension,
                    useWebWorker: true,
                    maxSizeMB: TARGET_IMAGE_BYTES / (1024 * 1024),
                    maxIteration: 12,
                    fileType: format,
                };
                if (format !== 'image/png') {
                    options.initialQuality = quality;
                }

                try {
                    const compressed = await imageCompression(file, options);
                    if (compressed.size <= TARGET_IMAGE_BYTES) {
                        return { file: compressed, format, hitSoftLimit: false };
                    }
                    if (compressed.size <= MAX_IMAGE_BYTES) {
                        if (!bestCandidate || compressed.size < bestCandidate.file.size) {
                            bestCandidate = { file: compressed, format, hitSoftLimit: true };
                        }
                    }
                } catch (error) {
                    console.warn(`Compression attempt failed (${format} @ ${dimension}px, q=${quality}):`, error);
                }
            }
        }
    }

    if (bestCandidate) {
        return bestCandidate;
    }

    throw new Error('Could not shrink image under 512KB. Try exporting a smaller source.');
}

async function uploadOptimizedImage({ dataUrl, mimeType, filename, size }) {
    try {
        const response = await fetch('/.netlify/functions/upload-asset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ dataUrl, mimeType, filename, size }),
        });

        let payload = null;
        try {
            payload = await response.json();
        } catch (_) {
            // Ignore JSON parse error
        }

        if (!response.ok) {
            const message = payload?.error || 'Unable to upload image asset';
            throw new Error(message);
        }

        return payload;
    } catch (error) {
        throw new Error(error.message || 'Asset upload failed');
    }
}

export async function handleGlobalPaste(event) {
    const target = event.target;
    if (target && (target.matches('input, textarea') || target.isContentEditable)) {
        return;
    }

    const items = event.clipboardData?.items;
    if (!items) return;

    for (let item of items) {
        if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (!file) continue;

            const currentSlideElement = slideElements[currentIndex];
            if (!currentSlideElement) return;

            const placeholder = currentSlideElement.querySelector('.image-placeholder-wrapper');

            if (placeholder) {
                await handleImageUpload(file, placeholder);
            } else {
                showHudStatus('⚠️ No image slot on this slide', 'warning');
                setTimeout(hideHudStatus, 2000);
            }
        }
    }
}
