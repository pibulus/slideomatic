#!/usr/bin/env node
/**
 * Generate an image-only slides JSON from a folder of assets.
 *
 * Usage:
 *   node scripts/generate-image-deck.mjs --dir images/screenshots --out slides-screenshots.json
 *
 * - Images are sorted by modified time (oldest first).
 * - For each image we create an `image` slide that fills the frame.
 * - Captions and alt text default to the file name (title-cased).
 */

import { readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.avif',
  '.bmp',
  '.tiff',
]);

main().catch((error) => {
  console.error('✖ Failed to generate slides:', error.message);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.showHelp) {
    printHelp();
    return;
  }

  const sourceDir = resolve(root, options.dir);
  const outputPath = resolve(root, options.out);

  const imageFiles = await collectImages(sourceDir);

  if (imageFiles.length === 0) {
    throw new Error(`No images found in ${options.dir}.`);
  }

  const slides = imageFiles.map((file, index) => {
    const caption = toTitle(file.name);
    return {
      type: 'image',
      badge: `Screenshot ${index + 1}`,
      image: {
        src: toPosix(relative(root, file.path)),
        alt: caption,
        fullBleed: true,
        objectFit: 'contain',
        objectPosition: 'center',
      },
      caption,
    };
  });

  if (!options.quiet) {
    console.log(
      `Found ${slides.length} image${slides.length === 1 ? '' : 's'} in ${
        options.dir
      }`
    );
  }

  if (options.dryRun) {
    if (!options.quiet) {
      console.log('Dry run enabled — no file written.');
    }
    if (!options.quiet) {
      console.log(JSON.stringify(slides, null, 2));
    }
    return;
  }

  await writeFile(outputPath, `${JSON.stringify(slides, null, 2)}\n`, 'utf8');

  if (!options.quiet) {
    console.log(`✔ Wrote ${options.out}`);
  }
}

function parseArgs(argv) {
  const options = {
    dir: 'images/screenshots',
    out: 'slides-screenshots.json',
    dryRun: false,
    quiet: false,
    showHelp: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--dir':
      case '-d':
        options.dir = argv[++i] ?? options.dir;
        break;
      case '--out':
      case '-o':
        options.out = argv[++i] ?? options.out;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '--help':
      case '-h':
        options.showHelp = true;
        break;
      default:
        console.warn(`Ignoring unknown argument: ${arg}`);
    }
  }

  return options;
}

async function collectImages(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile()) return;
      const extension = extname(entry.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension)) return;

      const absolute = join(directory, entry.name);
      const stats = await stat(absolute);
      files.push({
        name: entry.name,
        path: absolute,
        modifiedTime: stats.mtimeMs,
      });
    })
  );

  files.sort((a, b) => a.modifiedTime - b.modifiedTime);
  return files;
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function toTitle(filename) {
  const base = filename.replace(/\.[^.]+$/, '') // strip extension
    .replace(/[-_]+/g, ' ')
    .trim();

  if (base.length === 0) return filename;

  return base
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function printHelp() {
  console.log(`
Generate an image-only slides deck from a folder.

Usage:
  node scripts/generate-image-deck.mjs [options]

Options:
  -d, --dir <path>   Source directory relative to project root (default: images/screenshots)
  -o, --out <path>   Output JSON path relative to project root (default: slides-screenshots.json)
      --dry-run      Print the resulting slides to stdout instead of writing a file
      --quiet        Suppress console output
  -h, --help         Show this help

Example:
  node scripts/generate-image-deck.mjs --dir images/drops --out slides-drops.json
  deck.html?slides=slides-drops.json
`);
}
