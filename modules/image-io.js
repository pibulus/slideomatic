import { CONFIG, debug } from './constants.js';
import { showHudStatus, hideHudStatus } from './hud.js';
import { formatBytes, fileToBase64 } from './utils.js';
import { slides, slideElements, isOverview, currentIndex } from './state.js';
import { replaceSlideAt, setActiveSlide } from './slide-actions.js';
import { registerLazyImage } from './lazy-images.js';
import { STORAGE_KEY_API } from './voice-modes.js';
import { openSettingsModal } from './settings-modal.js';
import { getCurrentThemePath } from './theme-manager.js';

// ═══════════════════════════════════════════════════════════════════════════
// Image Handling Module
// ═══════════════════════════════════════════════════════════════════════════

const MAX_IMAGE_BYTES = CONFIG.IMAGE.MAX_BYTES;
const TARGET_IMAGE_BYTES = CONFIG.IMAGE.TARGET_BYTES;
const IMAGE_SETTLE_WINDOW_MS = CONFIG.IMAGE.SETTLE_WINDOW_MS;

const assetDeletionQueue = new Map();
let assetCleanupTimer = null;

// ================================================================
// Image Creation & Placeholders
// ================================================================

export function createImage(image, className = "slide__image", options = {}) {
    if (!image || !image.src) {
        debug('createImage - No src, creating placeholder');
        return createImagePlaceholder(image, className);
    }
    const img = document.createElement("img");
    img.className = className;
    const actualSrc = image.src;
    const modalSrc = image.modalSrc ?? actualSrc;
    const shouldLazyLoad = typeof actualSrc === "string" && !actualSrc.startsWith("data:");

    debug('createImage - Creating image:', {
        srcPrefix: actualSrc.substring(0, 50),
        shouldLazyLoad,
        isBase64: actualSrc.startsWith('data:')
    });

    img.alt = image.alt ?? "";
    img.dataset.modalSrc = modalSrc;
    if (image.alt) {
        img.dataset.modalAlt = image.alt;
    }
    if (image.loading) {
        img.loading = image.loading;
    } else {
        img.loading = "lazy";
    }
    img.decoding = image.decoding ?? "async";
    if (shouldLazyLoad) {
        registerLazyImage(img, actualSrc);
    } else {
        debug('createImage - Setting base64 src directly');
        img.src = actualSrc;
    }
    if (image.aspectRatio) {
        img.style.aspectRatio = image.aspectRatio;
    }
    if (image.objectFit) {
        img.style.objectFit = image.objectFit;
    }
    if (image.objectPosition) {
        img.style.objectPosition = image.objectPosition;
    }
    if (image.fullBleed) {
        img.classList.add("slide__image--full");
    }
    if (image.border === false) {
        img.classList.add("slide__image--borderless");
    }
    const orientationTarget = options.orientationTarget;
    const rawOrientation =
        typeof image.orientation === "string" ? image.orientation.trim() : image.orientation;
    const explicitOrientation = normalizeOrientation(rawOrientation);
    const orientationLocked =
        image.lockOrientation === true ||
        (typeof rawOrientation === "string" && /!$/.test(rawOrientation));
    const applyOrientation = (orientation) => {
        if (!orientation) return;
        img.dataset.orientation = orientation;
        if (orientationTarget) {
            orientationTarget.dataset.orientation = orientation;
        }
    };
    if (explicitOrientation) {
        applyOrientation(explicitOrientation);
    }
    const updateOrientationFromNatural = () => {
        const orientation = deriveOrientationFromDimensions(
            img.naturalWidth,
            img.naturalHeight
        );
        if (!orientation) return;
        if (!explicitOrientation || (!orientationLocked && orientation !== explicitOrientation)) {
            applyOrientation(orientation);
        }
    };
    if (img.complete && img.naturalWidth && img.naturalHeight) {
        updateOrientationFromNatural();
    } else {
        img.addEventListener("load", updateOrientationFromNatural, { once: true });
    }
    // Make images clickable to view full size
    img.style.cursor = 'pointer';
    return img;
}

export function createImagePlaceholder(image = {}, className = "slide__image") {
    const baseClasses = String(className)
        .split(/\s+/)
        .filter(Boolean);

    // Create wrapper container
    const wrapper = document.createElement("div");
    wrapper.className = [...baseClasses, "image-placeholder-wrapper"].join(" ");

    const placeholder = document.createElement("button");
    placeholder.type = "button";
    placeholder.className = "image-placeholder";

    const query =
        image.alt ||
        image.search ||
        image.label ||
        image.caption ||
        image.query ||
        "";
    const trimmedQuery = query.trim();

    const icon = document.createElement("span");
    icon.className = "image-placeholder__icon";
    icon.textContent = "🔍";

    const text = document.createElement("span");
    text.className = "image-placeholder__text";
    text.textContent = trimmedQuery
        ? `Search "${trimmedQuery}" or drag & drop`
        : "Drag & drop or paste image";

    placeholder.append(icon, text);

    // Track event listeners for cleanup
    const listeners = [];

    // Click handler for Google Image Search
    if (trimmedQuery) {
        placeholder.dataset.searchQuery = trimmedQuery;
        placeholder.setAttribute("aria-label", `Search images for ${trimmedQuery} or drag and drop`);
        const clickHandler = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const url = buildImageSearchUrl(trimmedQuery);
            window.open(url, "_blank", "noopener");
        };
        placeholder.addEventListener("click", clickHandler);
        listeners.push({ element: placeholder, event: 'click', handler: clickHandler });
    } else {
        placeholder.setAttribute(
            "aria-label",
            "Drag and drop or paste an image"
        );
    }

    // Drag & drop handlers
    const dragoverHandler = (event) => {
        event.preventDefault();
        event.stopPropagation();
        placeholder.classList.add("image-placeholder--dragover");
        text.textContent = "Drop to add image";
    };
    placeholder.addEventListener("dragover", dragoverHandler);
    listeners.push({ element: placeholder, event: 'dragover', handler: dragoverHandler });

    const dragleaveHandler = (event) => {
        event.preventDefault();
        event.stopPropagation();
        placeholder.classList.remove("image-placeholder--dragover");
        text.textContent = trimmedQuery
            ? `Search "${trimmedQuery}" or drag & drop`
            : "Drag & drop or paste image";
    };
    placeholder.addEventListener("dragleave", dragleaveHandler);
    listeners.push({ element: placeholder, event: 'dragleave', handler: dragleaveHandler });

    const dropHandler = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        placeholder.classList.remove("image-placeholder--dragover");

        const files = Array.from(event.dataTransfer.files);
        const imageFile = files.find(f => f.type.startsWith("image/"));

        if (imageFile) {
            try {
                await handleImageUpload(imageFile, placeholder, image);
            } catch (error) {
                console.error('Drop upload failed:', error);
                showHudStatus(`Upload failed: ${error.message}`, 'error');
                setTimeout(hideHudStatus, 3000);
            }
        }
    };
    placeholder.addEventListener("drop", dropHandler);
    listeners.push({ element: placeholder, event: 'drop', handler: dropHandler });

    // Store reference to the original image object
    placeholder._imageRef = image;

    wrapper.appendChild(placeholder);

    // Only show AI button when there's NO query
    if (!trimmedQuery) {
        const aiBtn = document.createElement("button");
        aiBtn.type = "button";
        aiBtn.className = "image-placeholder__magic-btn";
        aiBtn.textContent = "🪄";
        aiBtn.title = "Generate image with AI";
        aiBtn.setAttribute("aria-label", "Generate image with AI");

        const aiClickHandler = async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await askAIForImage(placeholder, image);
        };
        aiBtn.addEventListener("click", aiClickHandler);
        listeners.push({ element: aiBtn, event: 'click', handler: aiClickHandler });

        wrapper.appendChild(aiBtn);
    }

    // Store reference on wrapper
    wrapper._imageRef = image;

    // Add cleanup function to remove all event listeners
    wrapper.cleanup = () => {
        listeners.forEach(({ element, event, handler }) => {
            element?.removeEventListener(event, handler);
        });
        listeners.length = 0;
    };

    return wrapper;
}

function buildImageSearchUrl(query) {
    const url = new URL("https://www.google.com/search");
    url.searchParams.set("tbm", "isch");
    url.searchParams.set("q", query);
    return url.toString();
}

// ================================================================
// AI Image Suggestions
// ================================================================

function requireGeminiApiKey() {
    const apiKey = localStorage.getItem(STORAGE_KEY_API);
    if (!apiKey) {
        showHudStatus('⚠️ Please set your Gemini API key in Settings (S key)', 'error');
        setTimeout(() => {
            hideHudStatus();
            openSettingsModal();
        }, 2000);
        return null;
    }
    return apiKey;
}

function extractSlideContext(placeholderElement) {
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

export async function askAIForImage(placeholderElement, imageConfig = {}) {
    const apiKey = requireGeminiApiKey();
    if (!apiKey) return;

    const context = extractSlideContext(placeholderElement);
    const { headline, body, slideType } = context;

    showHudStatus('🤔 Deciding...', 'info');

    try {
        const decisionPrompt = `You're helping find the perfect image for a presentation slide.

Slide content:
- Type: ${slideType}
- Headline: ${headline}
- Body: ${body}

Decide whether this slide needs:
A) A real photograph/stock image (respond with "SEARCH: [refined query]")
B) A custom illustration (respond with "GENERATE")

Guidelines:
- Use SEARCH for: real people, specific places, products, concrete things
- Use GENERATE for: concepts, abstract ideas, data visualization, creative illustrations

Respond with ONLY one of these formats, nothing else:
SEARCH: [your refined query here]
or
GENERATE`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: decisionPrompt }] }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 100,
                    },
                }),
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `API error: ${response.status}`);
        }

        const result = await response.json();
        const decision = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (!decision) {
            throw new Error('No decision returned from AI');
        }

        if (decision.toUpperCase().startsWith('SEARCH:')) {
            const query = decision.replace(/^SEARCH:\s*/i, '').trim();
            hideHudStatus();
            const url = buildImageSearchUrl(query);
            window.open(url, '_blank', 'noopener');
            showHudStatus(`🔍 Searching: "${query}"`, 'success');
            setTimeout(hideHudStatus, 3000);
        } else if (decision.toUpperCase().includes('GENERATE')) {
            showHudStatus('🎨 Generating image...', 'processing');
            await generateAIImage(placeholderElement, imageConfig);
        } else {
            throw new Error('AI returned unclear decision');
        }

    } catch (error) {
        console.error('AI image decision failed:', error);
        showHudStatus(`❌ ${error.message}`, 'error', {
            onRetry: () => askAIForImage(placeholderElement, imageConfig)
        });
        setTimeout(hideHudStatus, 6000);
    }
}

export async function generateAIImage(placeholderElement, imageConfig = {}) {
    const apiKey = requireGeminiApiKey();
    if (!apiKey) return;

    const context = extractSlideContext(placeholderElement);
    const { slideIndex, headline, body } = context;
    const imageContext = imageConfig.alt || imageConfig.label || imageConfig.search || '';

    const rootStyles = getComputedStyle(document.documentElement);
    const colorSurface = rootStyles.getPropertyValue('--color-surface').trim();
    const colorSurfaceAlt = rootStyles.getPropertyValue('--color-surface-alt').trim();
    const colorAccent = rootStyles.getPropertyValue('--color-accent').trim();

    const themePath = getCurrentThemePath();
    const themeName = themePath?.split('/').pop()?.replace('.json', '') || 'default';
    const themeMoods = {
        'vaporwave': 'dreamy, retro aesthetic, pink and cyan tones, nostalgic',
        'slack': 'quirky, vibrant, playful, unconventional',
        'gameboy': 'pixel art style, retro gaming, limited color palette',
        'default': 'clean, professional, modern'
    };
    const themeMood = themeMoods[themeName] || themeMoods.default;

    showHudStatus('✨ Generating image...', 'info');

    try {
        const prompt = `Create an illustration for a presentation slide about: ${imageContext || headline}.

Slide context:
${headline ? `- Headline: ${headline}` : ''}
${body ? `- Content: ${body.substring(0, 200)}` : ''}

Style requirements:
- Risograph print aesthetic with bold, flat colors, ${themeMood}
- Use complementary colors inspired by: ${colorSurface}, ${colorSurfaceAlt}, ${colorAccent}
- Clean, minimal composition
- High contrast, professional quality
- No text or labels in the image

The image should be visually striking and support the slide content.`;

        const response = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey,
                },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseModalities: ['Image'],
                        imageConfig: {
                            aspectRatio: '16:9'
                        }
                    }
                })
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `API error: ${response.status}`);
        }

        const result = await response.json();
        const imagePart = result.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

        if (!imagePart || !imagePart.inlineData) {
            throw new Error('No image data returned from API');
        }

        const mimeType = imagePart.inlineData.mimeType || 'image/png';
        const base64Data = `data:${mimeType};base64,${imagePart.inlineData.data}`;

        if (slideIndex >= 0) {
            updateSlideImage(slideIndex, {
                src: base64Data,
                alt: imageContext || headline || 'AI generated image',
                originalFilename: 'ai-generated.png',
                generatedAt: Date.now()
            }, placeholderElement);

            replaceSlideAt(slideIndex, { focus: false });
            if (!isOverview) {
                setActiveSlide(slideIndex);
            }
        }

        showHudStatus('✨ Image generated!', 'success');
        setTimeout(hideHudStatus, 2000);

    } catch (error) {
        console.error('AI image generation failed:', error);
        showHudStatus(`❌ ${error.message}`, 'error');
        setTimeout(hideHudStatus, 3000);
    }
}

// ================================================================
// Image Upload & Compression
// ================================================================

export async function handleImageUpload(file, placeholderElement, imageConfig = {}) {
    if (!file.type.startsWith("image/")) {
        showImageError(placeholderElement, "Please drop an image file");
        return;
    }

    const text = placeholderElement.querySelector(".image-placeholder__text");
    const icon = placeholderElement.querySelector(".image-placeholder__icon");
    const originalText = text.textContent;
    const originalIcon = icon.textContent;

    text.textContent = "Compressing...";
    icon.textContent = "⏳";
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
                alt: imageConfig.alt || file.name.replace(/\.[^/.]+$/, ""),
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
            const statusType = hitSoftLimit ? "warning" : "success";
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
        console.error("Image upload failed:", error);
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

function findSlideIndexForPlaceholder(placeholderElement) {
    const slideElement = placeholderElement.closest('.slide');
    if (!slideElement) return -1;
    return slideElements.indexOf(slideElement);
}

function updateSlideImage(slideIndex, imageData, placeholderElement) {
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

function showImageError(placeholderElement, message) {
    const text = placeholderElement.querySelector(".image-placeholder__text");
    if (!text) return;

    const previousText = text.dataset.originalText || text.textContent;
    text.dataset.originalText = previousText;
    text.textContent = message;
    placeholderElement.classList.add("image-placeholder--error");

    setTimeout(() => {
        text.textContent = text.dataset.originalText || previousText;
        delete text.dataset.originalText;
        placeholderElement.classList.remove("image-placeholder--error");
    }, 3000);
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

            // Use the current slide's placeholder if available, or just the slide itself
            const currentSlideElement = slideElements[currentIndex];
            if (!currentSlideElement) return;

            // Find a placeholder in the current slide
            const placeholder = currentSlideElement.querySelector('.image-placeholder-wrapper');

            // If we have a placeholder, use it. Otherwise we might need to add an image to the slide data directly.
            // For now, let's assume we want to upload/set the image for the current slide.
            // If there's a placeholder, we can simulate a drop or call handleImageUpload directly.

            if (placeholder) {
                await handleImageUpload(file, placeholder);
            } else {
                // If no placeholder, we might want to replace the main image if it exists, or add one?
                // This logic depends on how we want "global paste" to behave on a slide with an existing image.
                // For safety/simplicity, let's only handle it if there's a placeholder OR if it's an image slide.

                // Actually, let's try to find ANY image placeholder or just use the slide index.
                // But handleImageUpload expects a placeholder element to show status.

                // If we can't find a placeholder, we can't show progress easily with current handleImageUpload.
                // So let's just show a HUD message and try to update the slide.

                showHudStatus('Processing pasted image...', 'info');

                try {
                    // Create a temporary placeholder-like object or just reuse logic?
                    // Refactoring handleImageUpload to not strictly require a DOM element would be better, 
                    // but for now let's just warn if no placeholder.
                    showHudStatus('Paste on a slide with an image placeholder.', 'warning');
                    setTimeout(hideHudStatus, 3000);
                } catch (e) {
                    console.error(e);
                }
            }
        }
    }
}

// ================================================================
// Asset Cleanup
// ================================================================

function scheduleAssetDeletion(assetId) {
    if (!assetId) return;
    assetDeletionQueue.set(assetId, Date.now());
    if (!assetCleanupTimer) {
        assetCleanupTimer = setTimeout(() => flushAssetDeletions(false), IMAGE_SETTLE_WINDOW_MS + 2000);
    }
}

async function flushAssetDeletions(force = false) {
    if (!assetDeletionQueue.size) {
        assetCleanupTimer = null;
        return;
    }

    const now = Date.now();
    const readyIds = [];
    assetDeletionQueue.forEach((timestamp, assetId) => {
        if (force || now - timestamp >= IMAGE_SETTLE_WINDOW_MS) {
            readyIds.push(assetId);
            assetDeletionQueue.delete(assetId);
        }
    });

    if (!readyIds.length) {
        assetCleanupTimer = setTimeout(() => flushAssetDeletions(false), IMAGE_SETTLE_WINDOW_MS);
        return;
    }

    try {
        await fetch('/.netlify/functions/delete-asset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ids: readyIds }),
        });
    } catch (error) {
        console.warn('Failed to delete assets', readyIds, error);
    } finally {
        assetCleanupTimer = assetDeletionQueue.size
            ? setTimeout(() => flushAssetDeletions(false), IMAGE_SETTLE_WINDOW_MS)
            : null;
    }
}

export function cleanupSlideAssets(slide, options = {}) {
    if (!slide || typeof slide !== 'object') return options.excludeSet ?? new Set();
    const exclusion = options.excludeSet ?? new Set();
    const refs = collectImageRefsFromSlide(slide);
    refs.forEach((ref) => exclusion.add(ref));
    refs.forEach((ref) => {
        if (ref?.storage === 'netlify-asset' && ref.assetId) {
            if (!isAssetStillUsed(ref.assetId, exclusion)) {
                scheduleAssetDeletion(ref.assetId);
            }
        }
    });
    return exclusion;
}

export function cleanupAllSlideAssets() {
    const exclusion = new Set();
    slides.forEach((slide) => {
        cleanupSlideAssets(slide, { excludeSet: exclusion });
    });
}

export function maybeScheduleAssetCleanup(imageRef) {
    if (!imageRef || typeof imageRef !== 'object') return;
    if (imageRef.storage !== 'netlify-asset' || !imageRef.assetId) return;
    const exclusion = new Set([imageRef]);
    if (!isAssetStillUsed(imageRef.assetId, exclusion)) {
        scheduleAssetDeletion(imageRef.assetId);
    }
}

function isAssetStillUsed(assetId, exclusionSet = new Set()) {
    let found = false;
    forEachImageRefInDeck((imageRef) => {
        if (found) return;
        if (imageRef.storage === 'netlify-asset' && imageRef.assetId === assetId && !exclusionSet.has(imageRef)) {
            found = true;
        }
    });
    return found;
}

function collectImageRefsFromSlide(slide) {
    const refs = [];
    forEachImageRefInSlide(slide, (image) => refs.push(image));
    return refs;
}

function forEachImageRefInDeck(callback) {
    slides.forEach((slide) => forEachImageRefInSlide(slide, callback));
}

function forEachImageRefInSlide(slide, callback) {
    if (!slide || typeof slide !== 'object' || typeof callback !== 'function') return;
    const pushRef = (image) => {
        if (image && typeof image === 'object') {
            callback(image);
        }
    };

    pushRef(slide.image);

    if (Array.isArray(slide.media)) {
        slide.media.forEach((item) => pushRef(item?.image));
    }

    if (Array.isArray(slide.items)) {
        slide.items.forEach((item) => pushRef(item?.image));
    }

    if (slide.left?.image) {
        pushRef(slide.left.image);
    }
    if (slide.right?.image) {
        pushRef(slide.right.image);
    }

    if (Array.isArray(slide.pillars)) {
        slide.pillars.forEach((pillar) => pushRef(pillar?.image));
    }

    if (Array.isArray(slide.gallery)) {
        slide.gallery.forEach((entry) => pushRef(entry?.image));
    }
}

// ================================================================
// Orientation Helpers
// ================================================================

export function normalizeOrientation(value) {
    if (!value) return null;
    const normalized = String(value).toLowerCase().replace(/!+$/, "");
    const alias = {
        poster: "portrait",
        "one-sheet": "portrait",
        flyer: "portrait",
        sheet: "portrait",
        banner: "landscape",
        widescreen: "landscape",
        panorama: "landscape",
    }[normalized];
    if (alias) {
        return alias;
    }
    if (["portrait", "landscape", "square"].includes(normalized)) {
        return normalized;
    }
    if (["vertical", "tall"].includes(normalized)) {
        return "portrait";
    }
    if (["horizontal", "wide"].includes(normalized)) {
        return "landscape";
    }
    return null;
}

export function deriveOrientationFromDimensions(width, height) {
    if (!width || !height) return null;
    if (Math.abs(width - height) / Math.max(width, height) < 0.08) {
        return "square";
    }
    return width > height ? "landscape" : "portrait";
}

// ================================================================
// Image Modal
// ================================================================

export function handleImageModalTrigger(event) {
    if (isOverview) return;
    const trigger = event.target.closest("[data-modal-src]");
    if (!trigger) return;
    const src = trigger.dataset.modalSrc;
    if (!src) return;
    event.preventDefault();
    event.stopPropagation();
    openImageModal(src, trigger.dataset.modalAlt ?? trigger.alt ?? "");
}

let imageModal = null;
let imageModalHandlers = null;

function initImageModal() {
    if (imageModal) return { modal: imageModal, ...imageModalHandlers };

    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
    <div class="image-modal__backdrop"></div>
    <div class="image-modal__content">
      <img src="" alt="" loading="eager" decoding="sync" />
      <button class="image-modal__close" aria-label="Close">×</button>
    </div>
  `;

    document.body.appendChild(modal);

    const img = modal.querySelector('.image-modal__content img');
    const backdrop = modal.querySelector('.image-modal__backdrop');
    const closeBtn = modal.querySelector('.image-modal__close');

    const closeModal = () => {
        modal.classList.remove('is-active');
    };

    const handleEsc = (e) => {
        if (e.key === 'Escape' && modal.classList.contains('is-active')) {
            closeModal();
        }
    };

    backdrop.addEventListener('click', closeModal);
    img.addEventListener('click', closeModal);
    closeBtn.addEventListener('click', closeModal);
    document.addEventListener('keydown', handleEsc);

    imageModal = modal;
    imageModalHandlers = { closeModal, img };

    return { modal, closeModal, img };
}

export function openImageModal(src, alt) {
    const { modal, img } = initImageModal();
    img.src = src;
    img.alt = alt || '';
    requestAnimationFrame(() => modal.classList.add('is-active'));
}

export async function generateGraphImage(slide, containerElement) {
    const apiKey = requireGeminiApiKey();
    if (!apiKey) return;

    // Show HUD loading state
    showHudStatus('📊 Generating graph...', 'processing');

    // Show button loading state
    const button = containerElement.querySelector('.graph-generate-btn, .graph-regenerate-btn');
    if (button) {
        button.disabled = true;
        button.textContent = button.classList.contains('graph-regenerate-btn')
            ? '🔄 Generating...'
            : 'Generating...';
    }

    try {
        // Get current theme colors
        const rootStyles = getComputedStyle(document.documentElement);
        const colorSurface = rootStyles.getPropertyValue('--color-surface').trim();
        const colorSurfaceAlt = rootStyles.getPropertyValue('--color-surface-alt').trim();
        const colorAccent = rootStyles.getPropertyValue('--color-accent').trim();

        // Build prompt with theme colors and risograph style
        const normalizedOrientation = normalizeOrientation(slide.orientation) || (slide.orientation ? String(slide.orientation).toLowerCase() : '');
        const orientation = normalizedOrientation || 'landscape';
        const aspectRatio = orientation === 'portrait' ? '3:4' : orientation === 'square' ? '1:1' : '16:9';

        const prompt = `Create a clean, minimal ${orientation} graph or chart: ${slide.description || slide.title}.

Style requirements:
- Risograph print aesthetic with bold, flat colors
- Use these colors: ${colorSurface}, ${colorSurfaceAlt}, ${colorAccent}
- Clean typography, clear labels
- Data-focused, no decorative elements
- High contrast, easy to read from distance
- Professional presentation quality

The graph should be publication-ready with clear data visualization.`;

        const response = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey,
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: prompt }]
                    }],
                    generationConfig: {
                        responseModalities: ['Image'],
                        imageConfig: {
                            aspectRatio: aspectRatio
                        }
                    }
                })
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `API error: ${response.status}`);
        }

        const result = await response.json();
        const imagePart = result.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

        if (!imagePart || !imagePart.inlineData) {
            throw new Error('No image data returned from API');
        }

        // Build base64 data URL
        const mimeType = imagePart.inlineData.mimeType || 'image/png';
        const imageData = `data:${mimeType};base64,${imagePart.inlineData.data}`;

        // Save to slide object
        slide.imageData = imageData;

        // Update container to show image
        containerElement.innerHTML = '';

        const img = document.createElement('img');
        img.className = 'graph-image';
        img.src = imageData;
        img.alt = slide.description || 'Generated graph';
        img.dataset.orientation = normalizeOrientation(slide.orientation);

        const regenerateBtn = document.createElement('button');
        regenerateBtn.className = 'graph-regenerate-btn';
        regenerateBtn.textContent = '🔄 Regenerate';
        regenerateBtn.addEventListener('click', () => generateGraphImage(slide, containerElement));

        containerElement.appendChild(img);
        containerElement.appendChild(regenerateBtn);

        showHudStatus('✨ Graph generated!', 'success');
        setTimeout(hideHudStatus, 2000);

    } catch (error) {
        console.error('Graph generation failed:', error);
        showHudStatus(`❌ Graph failed: ${error.message}`, 'error', {
            onRetry: () => generateGraphImage(slide, containerElement)
        });
        setTimeout(hideHudStatus, 6000);

        // Reset button
        if (button) {
            button.disabled = false;
            button.textContent = button.classList.contains('graph-regenerate-btn')
                ? '🔄 Regenerate'
                : 'Generate Graph';
        }
    }
}
