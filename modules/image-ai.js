import { showHudStatus, hideHudStatus } from './hud.js';
import { STORAGE_KEY_API } from './voice-modes.js';
import { openSettingsModal } from './settings-modal.js';
import { getCurrentThemePath, getCurrentTheme } from './theme-manager.js';
import { isOverview } from './state.js';
import { replaceSlideAt } from './slide-actions.js';
import { setActiveSlide } from './navigation.js';
import {
    extractSlideContext,
    buildImageSearchUrl,
    updateSlideImage,
    updateSlideImageByIndex
} from './image-utils.js';

// ═══════════════════════════════════════════════════════════════════════════
// Image AI Module
// ═══════════════════════════════════════════════════════════════════════════

export function requireGeminiApiKey() {
    const apiKey = localStorage.getItem(STORAGE_KEY_API);
    if (!apiKey) {
        showHudStatus('⚠️ Please set your Gemini API key in Settings (S key)', 'error');
        openSettingsModal();
        setTimeout(() => hideHudStatus(), 2000);
        return null;
    }
    return apiKey;
}

export async function askAIForImage(placeholderElement, imageConfig = {}) {
    const apiKey = requireGeminiApiKey();
    if (!apiKey) return;

    let context;
    if (imageConfig.context) {
        context = imageConfig.context;
    } else if (placeholderElement) {
        context = extractSlideContext(placeholderElement);
    } else {
        console.warn('No context provided for AI image generation');
        return;
    }

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
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

    let context;
    if (imageConfig.context) {
        context = imageConfig.context;
    } else if (placeholderElement) {
        context = extractSlideContext(placeholderElement);
    } else {
        return;
    }

    const { slideIndex, headline, body } = context;
    // Use slideIndex from config if available (for edit drawer context)
    const targetSlideIndex = imageConfig.slideIndex !== undefined ? imageConfig.slideIndex : slideIndex;
    
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

        const imageData = {
            src: base64Data,
            alt: imageContext || headline || 'AI generated image',
            originalFilename: 'ai-generated.png',
            generatedAt: Date.now()
        };

        if (targetSlideIndex >= 0) {
            if (imageConfig.imageIndex !== undefined) {
                // Update by index (Edit Drawer flow)
                updateSlideImageByIndex(targetSlideIndex, imageConfig.imageIndex, imageData);
            } else {
                // Update by placeholder (Main View flow)
                updateSlideImage(targetSlideIndex, imageData, placeholderElement);
            }

            replaceSlideAt(targetSlideIndex, { focus: false });
            if (!isOverview) {
                setActiveSlide(targetSlideIndex);
            }
            
            // If provided, call success callback (e.g. to refresh edit drawer)
            if (imageConfig.onSuccess) {
                imageConfig.onSuccess();
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

export async function generateGraphVisualization(slide = {}, options = {}) {
    const apiKey = requireGeminiApiKey();
    if (!apiKey) return null;

    const theme = typeof getCurrentTheme === 'function' ? getCurrentTheme() : null;
    const palette = theme
        ? [
              theme['color-surface'],
              theme['color-surface-alt'],
              theme['color-accent'],
              theme['badge-bg'],
              theme['color-ink'],
          ].filter(Boolean)
        : [];

    const paletteLine = palette.length
        ? `Palette reference: ${palette.join(', ')}.`
        : 'Palette reference: riso magenta, cyan, mustard, ink black.';

    const headline = slide.title || slide.headline || slide.badge || 'Untitled Graph';
    const description = slide.description || slide.summary || '';
    const slideFacts = summarizeSlideForGraph(slide);

    const prompt = `
You are Slideomatic's risograph data visualiser. Create a single 16:9 infographic image (PNG/JPEG) that feels screen-printed, textural, and bold.

Slide context:
Title: ${headline}
Description: ${description}
${slideFacts}

${paletteLine}
Use chunky ink lines, halftone fills, and grain. Choose an appropriate chart style (bar, line, radial, stacked, comparison cards, etc.) that best communicates the data/story. Label axes or segments minimally, keep typography clean (Inter / Space Mono inspiration). Avoid realistic photos or UI chrome. Include the title within the graphic. Output only an image.
`.trim();

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
                    temperature: options.temperature ?? 0.65,
                    responseModalities: ['Image'],
                    imageConfig: {
                        aspectRatio: options.aspectRatio ?? '16:9',
                    },
                },
            }),
        }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error?.message || `API error: ${response.status}`);
    }

    const result = await response.json();
    const imagePart = result.candidates?.[0]?.content?.parts?.find((part) => part.inlineData);
    if (!imagePart || !imagePart.inlineData) {
        throw new Error('No graph returned from Gemini');
    }

    const mimeType = imagePart.inlineData.mimeType || 'image/png';
    const base64Data = `data:${mimeType};base64,${imagePart.inlineData.data}`;

    return {
        src: base64Data,
        alt: slide.description || slide.title || slide.headline || 'Generated graph',
    };
}

function summarizeSlideForGraph(slide) {
    if (!slide || typeof slide !== 'object') return 'No structured data provided.';
    const lines = [];
    const textKeys = ['headline', 'subtitle', 'description', 'notes', 'goal', 'audience'];
    textKeys.forEach((key) => {
        if (slide[key]) {
            lines.push(`${key}: ${truncateText(slide[key])}`);
        }
    });

    const listKeys = ['metrics', 'points', 'items', 'pillars', 'data', 'values', 'stats'];
    listKeys.forEach((key) => {
        const value = slide[key];
        if (Array.isArray(value) && value.length) {
            const formatted = value
                .slice(0, 6)
                .map((item) => formatDataPoint(item))
                .join(' | ');
            lines.push(`${key}: ${formatted}`);
        } else if (value && typeof value === 'object') {
            lines.push(`${key}: ${safeJson(value)}`);
        }
    });

    if (slide.comparison) {
        lines.push(`comparison: ${safeJson(slide.comparison)}`);
    }

    if (!lines.length) {
        return 'No explicit data list. Create a conceptual infographic based on the description.';
    }
    return lines.join('\n');
}

function formatDataPoint(item) {
    if (typeof item === 'string') return truncateText(item, 80);
    if (!item || typeof item !== 'object') return truncateText(String(item), 80);
    if (item.label && item.value) return `${item.label}: ${item.value}`;
    if (item.title && item.value) return `${item.title}: ${item.value}`;
    if (item.name && item.percent) return `${item.name} ${item.percent}`;
    return truncateText(JSON.stringify(item), 80);
}

function truncateText(text, length = 140) {
    const str = typeof text === 'string' ? text : String(text);
    return str.length > length ? `${str.slice(0, length - 3)}...` : str;
}

function safeJson(value) {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
