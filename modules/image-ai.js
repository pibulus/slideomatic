import { CONFIG, debug } from './constants.js';
import { showHudStatus, hideHudStatus } from './hud.js';
import { STORAGE_KEY_API } from './voice-modes.js';
import { openSettingsModal } from './settings-modal.js';
import { getCurrentThemePath } from './theme-manager.js';
import { slides, slideElements, isOverview } from './state.js';
import { replaceSlideAt, setActiveSlide } from './slide-actions.js';
import {
    extractSlideContext,
    buildImageSearchUrl,
    updateSlideImage
} from './image-utils.js';

// ═══════════════════════════════════════════════════════════════════════════
// Image AI Module
// ═══════════════════════════════════════════════════════════════════════════

export function requireGeminiApiKey() {
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
