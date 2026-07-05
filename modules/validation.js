export function validateSlides(data) {
  if (!Array.isArray(data)) {
    throw new Error('Slides data must be an array.');
  }

  const allowedTypes = new Set([
    'title',
    'standard',
    'quote',
    'split',
    'grid',
    'pillars',
    'gallery',
    'graph',
    'typeface',
    'image',
    '_schema'
  ]);

  data.forEach((slide, index) => {
    if (!slide || typeof slide !== 'object') {
      throw new Error(`Slide ${index} is not an object.`);
    }

    const originalType = slide.type;
    const normalizedType =
      typeof originalType === 'string' && originalType.trim()
        ? originalType.trim()
        : 'standard';

    if (!allowedTypes.has(normalizedType)) {
      console.warn(
        `Slide ${index} has unsupported type "${normalizedType}". Falling back to "standard".`
      );
      slide.type = 'standard';
    } else {
      slide.type = normalizedType;
    }

    if (slide.type === 'split') {
      if (!slide.left || !slide.right) {
        throw new Error(`Slide ${index} (${slide.badge ?? slide.headline ?? 'Split slide'}) is missing left/right content.`);
      }
    }

    if (slide.type === 'pillars') {
      if (!Array.isArray(slide.pillars) || slide.pillars.length === 0) {
        throw new Error(`Slide ${index} (${slide.badge ?? slide.headline ?? 'Pillars slide'}) requires a non-empty pillars array.`);
      }
    }

    if (slide.type === 'gallery') {
      if (!Array.isArray(slide.items) || slide.items.length === 0) {
        throw new Error(`Slide ${index} (${slide.badge ?? slide.headline ?? 'Gallery slide'}) requires a non-empty items array.`);
      }
    }

    if (slide.type === 'image') {
      // A missing/empty src is fine — the renderer shows a placeholder with
      // a search button, and AI deck generation intentionally leaves src
      // empty for later image generation. Throwing here used to reject whole
      // decks: hosted shares whose oversized images were blanked server-side,
      // and AI starter decks that followed the prompt's own instructions.
      if (slide.image != null && typeof slide.image !== 'object') {
        throw new Error(`Slide ${index} (${slide.badge ?? slide.headline ?? 'Image slide'}) has a malformed image value.`);
      }
    }
  });
}
