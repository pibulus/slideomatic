import { debug } from './constants.js';
import { isOverview } from './state.js';
import { registerLazyImage } from './lazy-images.js';
import { askAIForImage, generateGraphVisualization } from './image-ai.js';
import { handleImageUpload } from './image-upload.js';
import { showHudStatus, hideHudStatus } from './hud.js';
import {
    buildImageSearchUrl,
    normalizeOrientation,
    deriveOrientationFromDimensions,
    cleanupSlideAssets,
    cleanupAllSlideAssets
} from './image-utils.js';

// ═══════════════════════════════════════════════════════════════════════════
// Image Rendering Module
// ═══════════════════════════════════════════════════════════════════════════

export { cleanupSlideAssets, cleanupAllSlideAssets, normalizeOrientation, deriveOrientationFromDimensions };

export function createImage(image, className = 'slide__image', options = {}) {
    if (!image || !image.src) {
        debug('createImage - No src, creating placeholder');
        return createImagePlaceholder(image, className);
    }
    const img = document.createElement('img');
    img.className = className;
    const actualSrc = image.src;
    const modalSrc = image.modalSrc ?? actualSrc;
    const shouldLazyLoad = typeof actualSrc === 'string' && !actualSrc.startsWith('data:');

    debug('createImage - Creating image:', {
        srcPrefix: actualSrc.substring(0, 50),
        shouldLazyLoad,
        isBase64: actualSrc.startsWith('data:')
    });

    img.alt = image.alt ?? '';
    img.dataset.modalSrc = modalSrc;
    if (image.alt) {
        img.dataset.modalAlt = image.alt;
    }
    if (image.loading) {
        img.loading = image.loading;
    } else {
        img.loading = 'lazy';
    }
    img.decoding = image.decoding ?? 'async';
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
        img.classList.add('slide__image--full');
    }
    if (image.border === false) {
        img.classList.add('slide__image--borderless');
    }
    const orientationTarget = options.orientationTarget;
    const rawOrientation =
        typeof image.orientation === 'string' ? image.orientation.trim() : image.orientation;
    const explicitOrientation = normalizeOrientation(rawOrientation);
    const orientationLocked =
        image.lockOrientation === true ||
        (typeof rawOrientation === 'string' && /!$/.test(rawOrientation));
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
        img.addEventListener('load', updateOrientationFromNatural, { once: true });
    }
    // Make images clickable to view full size
    img.style.cursor = 'pointer';
    return img;
}

export function createImagePlaceholder(image = {}, className = 'slide__image', context = 'image') {
    const baseClasses = String(className)
        .split(/\s+/)
        .filter(Boolean);

    // Create wrapper container
    const wrapper = document.createElement('div');
    wrapper.className = [...baseClasses, 'image-placeholder-wrapper'].join(' ');

    const placeholder = document.createElement('button');
    placeholder.type = 'button';
    placeholder.className = 'image-placeholder';

    const query =
        image.alt ||
        image.search ||
        image.label ||
        image.caption ||
        image.query ||
        '';
    const trimmedQuery = query.trim();
    const isGraphContext = context === 'graph';
    const customMagicHandler = typeof image?.__magicHandler === 'function' ? image.__magicHandler : null;

    const defaultText = isGraphContext
        ? trimmedQuery
            ? `Generate graph for "${trimmedQuery}"`
            : 'Describe and generate graph'
        : trimmedQuery
            ? `Search "${trimmedQuery}" or drag & drop`
            : 'Drag & drop or paste image';

    const icon = document.createElement('span');
    icon.className = 'image-placeholder__icon';
    icon.textContent = context === 'graph' ? '📊' : '🔍';

    const text = document.createElement('span');
    text.className = 'image-placeholder__text';
    
    text.textContent = defaultText;

    const progressBar = document.createElement('div');
    progressBar.className = 'image-placeholder__progress';
    const progressFill = document.createElement('div');
    progressFill.className = 'image-placeholder__progress-fill';
    progressBar.appendChild(progressFill);

    placeholder.append(icon, text, progressBar);

    // Track event listeners for cleanup
    const listeners = [];

    // Click handler for Google Image Search
    if (trimmedQuery && !isGraphContext) {
        placeholder.dataset.searchQuery = trimmedQuery;
        placeholder.setAttribute('aria-label', `Search images for ${trimmedQuery} or drag and drop`);
        const clickHandler = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const url = buildImageSearchUrl(trimmedQuery);
            window.open(url, '_blank', 'noopener');
        };
        placeholder.addEventListener('click', clickHandler);
        listeners.push({ element: placeholder, event: 'click', handler: clickHandler });
    } else if (!isGraphContext) {
        placeholder.setAttribute(
            'aria-label',
            'Drag and drop or paste an image'
        );
    } else {
        placeholder.setAttribute('aria-label', 'Describe the graph you want to generate');
    }

    // Drag & drop handlers
    const dragoverHandler = (event) => {
        event.preventDefault();
        event.stopPropagation();
        placeholder.classList.add('image-placeholder--dragover');
        text.textContent = 'Drop to add image';
    };
    placeholder.addEventListener('dragover', dragoverHandler);
    listeners.push({ element: placeholder, event: 'dragover', handler: dragoverHandler });

    const dragleaveHandler = (event) => {
        event.preventDefault();
        event.stopPropagation();
        placeholder.classList.remove('image-placeholder--dragover');
        text.textContent = defaultText;
    };
    placeholder.addEventListener('dragleave', dragleaveHandler);
    listeners.push({ element: placeholder, event: 'dragleave', handler: dragleaveHandler });

    const dropHandler = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        placeholder.classList.remove('image-placeholder--dragover');

        const files = Array.from(event.dataTransfer.files);
        const imageFile = files.find(f => f.type.startsWith('image/'));

        if (imageFile) {
            try {
                await handleImageUpload(imageFile, placeholder, image);
            } catch (error) {
                console.error('Drop upload failed:', error);
                // We don't have showHudStatus here easily without importing it,
                // but handleImageUpload handles its own errors mostly.
                // If we need it, we can import it.
            }
        }
    };
    placeholder.addEventListener('drop', dropHandler);
    listeners.push({ element: placeholder, event: 'drop', handler: dropHandler });

    // Store reference to the original image object
    /** @type {any} */ (placeholder)._imageRef = image;

    wrapper.appendChild(placeholder);

    // Magic button appears once there's a description (or always enabled for custom handlers)
    const aiBtn = document.createElement('button');
    aiBtn.type = 'button';
    aiBtn.className = 'image-placeholder__magic-btn';
    aiBtn.textContent = isGraphContext ? '📊' : '🪄';
    aiBtn.title = isGraphContext
        ? 'Generate chart with AI'
        : trimmedQuery ? 'Generate image with AI' : 'Add a description to unlock AI assist';
    aiBtn.setAttribute('aria-label', aiBtn.title);
    const magicAlwaysEnabled = isGraphContext || Boolean(customMagicHandler);
    aiBtn.disabled = !trimmedQuery && !magicAlwaysEnabled;

    const aiClickHandler = async (event) => {
        if (aiBtn.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        if (customMagicHandler) {
            await customMagicHandler({ placeholder, image, button: aiBtn });
            return;
        }
        await askAIForImage(placeholder, image);
    };
    aiBtn.addEventListener('click', aiClickHandler);
    listeners.push({ element: aiBtn, event: 'click', handler: aiClickHandler });

    wrapper.appendChild(aiBtn);

    // Store reference on wrapper
    /** @type {any} */ (wrapper)._imageRef = image;

    // Add cleanup function to remove all event listeners
    /** @type {any} */ (wrapper).cleanup = () => {
        listeners.forEach(({ element, event, handler }) => {
            element?.removeEventListener(event, handler);
        });
        listeners.length = 0;
    };

    return wrapper;
}

export function handleImageModalTrigger(event) {
    if (isOverview) return;

    const target = /** @type {HTMLElement} */ (event.target);
    if (target.closest('.edit-drawer')) return; // Don't trigger in edit drawer

    const trigger = /** @type {HTMLElement} */ (target.closest('[data-modal-src]') || (target.tagName === 'IMG' && target.closest('.slide')));
    if (!trigger) return;

    // If it's a placeholder, don't open modal
    if (trigger.closest('.image-placeholder-wrapper')) return;

    const src = trigger.dataset.modalSrc || /** @type {HTMLImageElement} */ (trigger).src;
    const alt = trigger.dataset.modalAlt || /** @type {HTMLImageElement} */ (trigger).alt;

    if (!src) return;

    event.preventDefault();
    event.stopPropagation();

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
        <div class="image-modal__content">
            <img src="${src}" alt="${alt}" class="image-modal__image">
            <button class="image-modal__close" aria-label="Close">×</button>
        </div>
    `;

    document.body.appendChild(modal);

    const modalImg = modal.querySelector('.image-modal__image');
    const closeBtn = modal.querySelector('.image-modal__close');
    
    requestAnimationFrame(() => {
        modal.classList.add('is-active');
        
        // Tactile "Pop" Animation (Expand)
        modalImg.animate([
            { transform: 'scale(0.8)', opacity: 0 },
            { transform: 'scale(1)', opacity: 1 }
        ], {
            duration: 400,
            easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', // Springy pop
            fill: 'both'
        });

        // Backdrop fade
        modal.animate([
            { backgroundColor: 'rgba(0, 0, 0, 0)' },
            { backgroundColor: 'rgba(0, 0, 0, 0.9)' }
        ], {
            duration: 300,
            easing: 'ease-out',
            fill: 'both'
        });
        
        // Close button fade
        closeBtn.animate([
            { opacity: 0, transform: 'scale(0.8)' },
            { opacity: 1, transform: 'scale(1)' }
        ], {
            duration: 300,
            delay: 100,
            fill: 'both'
        });
    });

    let isClosing = false;

    const handleClose = () => {
        if (isClosing) return;
        isClosing = true;

        // Contract animation
        const animation = modalImg.animate([
            { transform: 'scale(1)', opacity: 1 },
            { transform: 'scale(0.8)', opacity: 0 }
        ], {
            duration: 250,
            easing: 'cubic-bezier(0.4, 0, 0.2, 1)', // Smooth retract
            fill: 'both'
        });

        modal.animate([
            { opacity: 1 },
            { opacity: 0 }
        ], {
            duration: 250,
            fill: 'both'
        });

        animation.onfinish = () => {
            modal.remove();
            document.removeEventListener('keydown', escHandler);
        };
    };

    const escHandler = (e) => {
        if (e.key === 'Escape') {
            handleClose();
        }
    };
    document.addEventListener('keydown', escHandler);

    modal.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        if (target === modal || target.closest('.image-modal__close') || target.tagName === 'IMG') {
            handleClose();
        }
    });
}

export async function generateGraphImage(slide, container) {
    if (!slide || !container) return;
    try {
        container.classList.add('graph-container--loading');
        container.dataset.state = 'loading';
        showHudStatus('📊 Generating graph...', 'info');

        const graphImage = await generateGraphVisualization(slide);
        if (!graphImage?.src) {
            throw new Error('No graph returned');
        }

        slide.imageData = graphImage.src;
        slide.graphAlt = graphImage.alt;
        slide.orientation = 'landscape';

        container.innerHTML = '';

        const img = document.createElement('img');
        img.className = 'graph-image';
        img.src = graphImage.src;
        img.alt = graphImage.alt || slide.description || 'Generated graph';
        img.dataset.orientation = 'landscape';

        const regenerateBtn = document.createElement('button');
        regenerateBtn.className = 'graph-regenerate-btn';
        regenerateBtn.textContent = '🔄 Regenerate';
        regenerateBtn.addEventListener('click', () => generateGraphImage(slide, container));

        container.appendChild(img);
        container.appendChild(regenerateBtn);

        showHudStatus('✨ Graph generated', 'success');
        setTimeout(hideHudStatus, 2000);
    } catch (error) {
        console.error('Graph generation failed:', error);
        const message = error instanceof Error ? error.message : 'Graph generation failed';
        showHudStatus(`❌ ${message}`, 'error');
        setTimeout(hideHudStatus, 3500);
        container.innerHTML = `
            <div class="graph-error">
                <p>${message}. Try again?</p>
                <button type="button" class="graph-regenerate-btn">Retry</button>
            </div>
        `;
        const retryBtn = container.querySelector('.graph-regenerate-btn');
        retryBtn?.addEventListener('click', () => generateGraphImage(slide, container));
    } finally {
        container.classList.remove('graph-container--loading');
        delete container.dataset.state;
    }
}
