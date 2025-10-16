import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const allowedTypes = new Set([
  'title',
  'standard',
  'quote',
  'split',
  'grid',
  'pillars',
  'gallery',
  'image'
]);

const mandatoryFiles = ['slides.json', 'theme.json', 'catalog.json'];

try {
  mandatoryFiles.forEach(assertFileExists);
  validateSlides('slides.json');
  validateTheme('theme.json');
  validateCatalog('catalog.json');
  validateOptional('autolinks.json', validateAutolinks);
  console.log('✔ Validation passed for slides, themes, and catalog.');
} catch (error) {
  console.error('✖ Validation failed:', error.message);
  process.exitCode = 1;
}

function readJson(relativePath) {
  const absolutePath = join(root, relativePath);
  try {
    const contents = readFileSync(absolutePath, 'utf8');
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Failed to parse ${relativePath}: ${error.message}`);
  }
}

function assertFileExists(relativePath) {
  try {
    statSync(join(root, relativePath));
  } catch {
    throw new Error(`Required file missing: ${relativePath}`);
  }
}

function validateSlides(relativePath) {
  const slides = readJson(relativePath);
  if (!Array.isArray(slides)) {
    throw new Error(`${relativePath} must export an array`);
  }

  slides.forEach((slide, index) => {
    const label = `slide ${index + 1}`;
    if (!slide || typeof slide !== 'object') {
      throw new Error(`${relativePath}: ${label} is not an object`);
    }

    const type = slide.type ?? 'standard';
    if (!allowedTypes.has(type)) {
      throw new Error(`${relativePath}: ${label} has unsupported type "${type}"`);
    }

    if (type === 'split') {
      if (!slide.left || !slide.right) {
        throw new Error(`${relativePath}: ${label} requires both left and right columns`);
      }
    }

    if (type === 'gallery') {
      if (!Array.isArray(slide.items) || !slide.items.length) {
        throw new Error(`${relativePath}: ${label} requires a non-empty items array`);
      }
    }

    if (type === 'pillars') {
      if (!Array.isArray(slide.pillars) || !slide.pillars.length) {
        throw new Error(`${relativePath}: ${label} requires a non-empty pillars array`);
      }
    }

    if (type === 'image') {
      if (!slide.image || typeof slide.image !== 'object' || !slide.image.src) {
        throw new Error(`${relativePath}: ${label} requires an image object with a "src"`);
      }
    }
  });
}

function validateTheme(relativePath) {
  const theme = readJson(relativePath);
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
    throw new Error(`${relativePath} must export an object of CSS variables`);
  }
}

function validateCatalog(relativePath) {
  const catalog = readJson(relativePath);
  if (!Array.isArray(catalog) || !catalog.length) {
    throw new Error(`${relativePath} must export a non-empty array`);
  }

  catalog.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`${relativePath}: deck ${index + 1} is not an object`);
    }

    if (!entry.title) {
      throw new Error(`${relativePath}: deck ${index + 1} is missing a title`);
    }

    const slidesPath = entry.slides ?? 'slides.json';
    validateSlidesFile(slidesPath);

    if (entry.theme) {
      validateThemeFile(entry.theme);
    }
  });
}

function validateSlidesFile(relativePath) {
  assertFileExists(relativePath);
  validateSlides(relativePath);
}

function validateThemeFile(relativePath) {
  assertFileExists(relativePath);
  validateTheme(relativePath);
}

function validateOptional(relativePath, validator) {
  try {
    assertFileExists(relativePath);
  } catch {
    return;
  }
  validator(relativePath);
}

function validateAutolinks(relativePath) {
  const entries = readJson(relativePath);
  if (!Array.isArray(entries)) {
    throw new Error(`${relativePath} must export an array`);
  }
  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`${relativePath}: entry ${index + 1} must be an object`);
    }
    if (!entry.term) {
      throw new Error(`${relativePath}: entry ${index + 1} missing "term"`);
    }
  });
}
