import { deepClone } from './utils.js';

export function getSlideTemplate(type) {
  const templates = {
    title: {
      type: 'title',
      eyebrow: 'New Section',
      title: 'Title Goes Here',
      subtitle: 'Optional subtitle copy',
      media: [],
      font: 'grotesk'
    },
    standard: {
      type: 'standard',
      badge: 'Slide',
      headline: 'Headline Goes Here',
      body: ['First talking point', 'Second talking point'],
      font: 'sans'
    },
    quote: {
      type: 'quote',
      quote: '"Add your quote here."',
      attribution: 'Attribution Name',
      font: 'sans'
    },
    split: {
      type: 'split',
      left: {
        headline: 'Left Column',
        body: ['Left column bullet']
      },
      right: {
        headline: 'Right Column',
        body: ['Right column bullet']
      },
      font: 'sans'
    },
    grid: {
      type: 'grid',
      headline: 'Grid Headline',
      body: ['Introduce the items in this grid.'],
      items: [
        {
          image: { src: '', alt: 'Image description' },
          label: 'Item label'
        },
        {
          image: { src: '', alt: 'Image description' },
          label: 'Item label'
        }
      ],
      font: 'sans'
    },
    pillars: {
      type: 'pillars',
      headline: 'Pillars Headline',
      body: ['Introduce the pillars.'],
      pillars: [
        {
          title: 'Pillar One',
          copy: ['Supporting detail for pillar one']
        },
        {
          title: 'Pillar Two',
          copy: ['Supporting detail for pillar two']
        }
      ],
      font: 'sans'
    },
    gallery: {
      type: 'gallery',
      headline: 'Gallery Headline',
      body: 'Describe the collection showcased here.',
      items: [
        {
          image: { src: '', alt: 'Image description' },
          label: 'Item label',
          copy: 'Optional supporting copy.'
        },
        {
          image: { src: '', alt: 'Image description' },
          label: 'Item label',
          copy: 'Optional supporting copy.'
        }
      ],
      font: 'sans'
    },
    image: {
      type: 'image',
      badge: 'Slide',
      headline: 'Image Slide Headline',
      image: { src: '', alt: 'Describe the image' },
      caption: 'Optional caption text.',
      font: 'sans'
    },
    typeface: {
      type: 'typeface',
      headline: 'Typeface Showcase',
      fonts: [
        {
          name: 'Display',
          font: '"Space Grotesk", sans-serif',
          sample: 'The quick brown fox jumps over the lazy dog.'
        },
        {
          name: 'Body',
          font: '"Inter", sans-serif',
          sample: 'Use this space to demonstrate body copy.'
        }
      ],
      body: ['Describe how these typefaces support the system.'],
      font: 'sans'
    }
  };

  const template = templates[type];
  if (!template) return null;
  return deepClone(template);
}
