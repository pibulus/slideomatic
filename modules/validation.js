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
      if (!slide.image || typeof slide.image !== 'object' || !slide.image.src) {
        throw new Error(`Slide ${index} (${slide.badge ?? slide.headline ?? 'Image slide'}) requires an image.src value.`);
      }
    }
  });
}
