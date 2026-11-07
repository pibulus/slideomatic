// ═══════════════════════════════════════════════════════════════════════════
// Slide-o-Matic Headless Smoke Harness (scripts/smoke.mjs)
// ═══════════════════════════════════════════════════════════════════════════
// Boots a zero-dependency static server on an ephemeral port and runs
// headless browser checks across desktop (1440×900) and mobile (375×812):
// - Landing page (index.html) & Collections page (collections.html)
// - Every public deck (slides, guide, sovereign-passport, demo-deck,
//   design-resources, templates/*) + local dossier decks if present
// - Zero .slide--error, zero broken images, zero console/page errors
// - Overview mode plaques, HUD controls, Drawer tabs & roving tabindex,
//   one-thumb slide reordering, Share modal options, and Studio console.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
        let pathname = decodeURIComponent(parsedUrl.pathname);
        if (pathname === '/') pathname = '/index.html';
        if (pathname === '/collections' || pathname === '/collections/') pathname = '/collections.html';
        if (pathname === '/deck') pathname = '/deck.html';

        const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
        if (safePath.split(/[/\\]/).some((part) => part.startsWith('.'))) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Forbidden');
          return;
        }
        let filePath = path.join(ROOT, safePath);

        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }

        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
        });
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(String(err?.message || err));
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function expectedSlideCount(relFile) {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, relFile), 'utf8'));
  const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.slides) ? raw.slides : []);
  return arr.filter((s) => s && typeof s === 'object' && s.type !== '_schema').length;
}

function collectDecksToTest() {
  const decks = [
    { name: 'slides', query: 'slides=slides.json', file: 'slides.json' },
    { name: 'guide', query: 'slides=guide.json', file: 'guide.json' },
    { name: 'sovereign-passport', query: 'slides=sovereign-passport.json', file: 'sovereign-passport.json' },
    { name: 'demo-deck', query: 'slides=demo-deck.json', file: 'demo-deck.json' },
    { name: 'design-resources', query: 'slides=design-resources.json', file: 'design-resources.json' },
  ];

  const templatesDir = path.join(ROOT, 'templates');
  if (fs.existsSync(templatesDir)) {
    for (const file of fs.readdirSync(templatesDir)) {
      if (file.endsWith('.json')) {
        decks.push({
          name: `templates/${file.replace(/\.json$/, '')}`,
          query: `slides=templates/${file}`,
          file: path.join('templates', file),
        });
      }
    }
  }

  // Optional local-only decks if present on disk
  const localCandidates = [
    'case-2891982.json',
    'numerological-reading.json',
    'pdeck-3.json',
  ];
  for (const file of localCandidates) {
    if (fs.existsSync(path.join(ROOT, file))) {
      decks.push({
        name: `local:${file.replace(/\.json$/, '')}`,
        query: `slides=${file}`,
        file,
      });
    }
  }

  return decks;
}

async function runSmoke() {
  const { server, baseUrl } = await startStaticServer();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const failures = [];
  const recordFailure = (scope, msg) => {
    console.error(`  ✖ [${scope}] ${msg}`);
    failures.push(`[${scope}] ${msg}`);
  };

  try {
    console.log(`🔎 Smoke server running at ${baseUrl}`);

    // 1. Landing page & Collections page check
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      const pageErrors = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle0' });
      const title = await page.title();
      if (!title.includes('Slide-o-Matic')) {
        recordFailure('index.html', `Unexpected title: ${title}`);
      }
      if (pageErrors.length) {
        recordFailure('index.html', `Page errors: ${pageErrors.join('; ')}`);
      }

      await page.goto(`${baseUrl}/collections.html`, { waitUntil: 'networkidle0' });
      const cardCount = await page.$$eval('.collection-card', (els) => els.length);
      if (cardCount < 3) {
        recordFailure('collections.html', `Expected >= 3 collection cards, found ${cardCount}`);
      }
      if (pageErrors.length) {
        recordFailure('collections.html', `Page errors: ${pageErrors.join('; ')}`);
      }
      await page.close();
      console.log(`  ✔ index.html & collections.html (${cardCount} cards)`);
    }

    // 2. Deck rendering & image integrity sweep
    const decks = collectDecksToTest();
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    for (const deck of decks) {
      const pageErrors = [];
      const onPageError = (err) => pageErrors.push(err.message);
      page.on('pageerror', onPageError);

      const expected = expectedSlideCount(deck.file);
      await page.goto(`${baseUrl}/deck.html?${deck.query}`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.slide', { timeout: 8000 });

      const audit = await page.evaluate(async () => {
        const slides = Array.from(document.querySelectorAll('#slides > .slide'));
        const errors = document.querySelectorAll('.slide--error').length;

        // Force eager load on lazy images so we verify every asset path resolves
        const imgs = Array.from(document.querySelectorAll('#slides img'));
        imgs.forEach((img) => {
          if (img.dataset?.src && !img.getAttribute('src')) {
            img.setAttribute('src', img.dataset.src);
          }
          img.loading = 'eager';
        });

        await Promise.all(
          imgs.map((img) => {
            if (img.complete) return Promise.resolve();
            return new Promise((res) => {
              img.addEventListener('load', res, { once: true });
              img.addEventListener('error', res, { once: true });
              setTimeout(res, 3000);
            });
          })
        );

        const brokenImages = imgs
          .filter((img) => {
            const src = img.getAttribute('src') || '';
            if (!src) return false;
            return !img.complete || img.naturalWidth === 0;
          })
          .map((img) => img.getAttribute('src'));

        const scrollSlides = document.querySelectorAll('.slide--scroll').length;
        return {
          renderedCount: slides.length,
          errorCount: errors,
          imageCount: imgs.length,
          brokenImages,
          scrollSlides,
        };
      });

      page.off('pageerror', onPageError);

      if (audit.errorCount > 0) {
        recordFailure(deck.name, `Found ${audit.errorCount} .slide--error slide(s)`);
      }
      if (audit.renderedCount !== expected) {
        recordFailure(deck.name, `Expected ${expected} slides, rendered ${audit.renderedCount}`);
      }
      if (audit.brokenImages.length > 0) {
        recordFailure(deck.name, `Broken images: ${audit.brokenImages.join(', ')}`);
      }
      if (pageErrors.length > 0) {
        recordFailure(deck.name, `Page errors: ${pageErrors.join('; ')}`);
      }

      console.log(
        `  ✔ deck [${deck.name}]: ${audit.renderedCount} slides, ${audit.imageCount} images, 0 errors`
      );
    }

    // 3. Interactive Desktop UI & Accessibility check (Overview, Drawer tabs, Reorder, Share, Studio)
    {
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(`${baseUrl}/deck.html?slides=guide.json`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.slide.is-active');

      // Dismiss onboarding hints modal if open
      await page.evaluate(() => {
        const hints = document.getElementById('hints-modal');
        if (hints?.classList.contains('is-open')) {
          document.getElementById('hints-modal-close')?.click();
        }
      });

      // Toggle Overview Mode
      await page.click('#overview-btn');
      const overviewState = await page.evaluate(() => {
        const firstSlide = document.querySelector('#slides > .slide');
        const plaqueContent = firstSlide ? getComputedStyle(firstSlide, '::before').content : 'none';
        return {
          mode: document.body.dataset.mode,
          indexedSlides: document.querySelectorAll('#slides > .slide[data-index]').length,
          plaqueContent,
        };
      });
      if (
        overviewState.mode !== 'overview' ||
        overviewState.indexedSlides === 0 ||
        overviewState.plaqueContent === 'none'
      ) {
        recordFailure('overview', `Expected overview mode with plaques, got ${JSON.stringify(overviewState)}`);
      }
      await page.click('#overview-btn');

      // Open Edit Drawer
      await page.click('#hud-edit-btn');
      await page.waitForSelector('#edit-drawer.is-open');

      // Check roving tabindex and keyboard ArrowRight -> Deck tab
      const tabStateBefore = await page.evaluate(() => ({
        slideTabIndex: document.getElementById('drawer-tab-slide')?.getAttribute('tabindex'),
        deckTabIndex: document.getElementById('drawer-tab-deck')?.getAttribute('tabindex'),
      }));
      if (tabStateBefore.slideTabIndex !== '0' || tabStateBefore.deckTabIndex !== '-1') {
        recordFailure('a11y-tabs', `Expected roving tabindex 0/-1, got ${JSON.stringify(tabStateBefore)}`);
      }

      await page.focus('#drawer-tab-slide');
      await page.keyboard.press('ArrowRight');
      const tabStateAfter = await page.evaluate(() => ({
        deckSelected: document.getElementById('drawer-tab-deck')?.getAttribute('aria-selected'),
        deckTabIndex: document.getElementById('drawer-tab-deck')?.getAttribute('tabindex'),
        panelHidden: document.getElementById('deck-panel')?.hidden,
        hasPdfBtn: Boolean(document.getElementById('deck-pdf-btn')),
        hasStudioBtn: Boolean(document.getElementById('deck-studio-console-btn')),
      }));
      if (
        tabStateAfter.deckSelected !== 'true' ||
        tabStateAfter.deckTabIndex !== '0' ||
        tabStateAfter.panelHidden !== false ||
        !tabStateAfter.hasPdfBtn ||
        !tabStateAfter.hasStudioBtn
      ) {
        recordFailure('deck-panel', `Unexpected deck tab state: ${JSON.stringify(tabStateAfter)}`);
      }

      // Switch back to Slide tab via ArrowLeft and test slide reordering
      await page.keyboard.press('ArrowLeft');
      const reorderResult = await page.evaluate(() => {
        const getSlideHeading = (idx) =>
          document.querySelectorAll('#slides > .slide')[idx]?.querySelector('h1, h2')?.textContent?.trim();
        const firstHeadlineBefore = getSlideHeading(0);
        const moveLaterBtn = document.getElementById('move-slide-later-btn');
        if (!moveLaterBtn || moveLaterBtn.disabled) return { ok: false, reason: 'move-slide-later-btn missing/disabled' };
        moveLaterBtn.click();
        const secondHeadlineAfter = getSlideHeading(1);
        const moveEarlierBtn = document.getElementById('move-slide-earlier-btn');
        moveEarlierBtn?.click();
        const firstHeadlineRestored = getSlideHeading(0);
        return {
          ok: Boolean(
            firstHeadlineBefore &&
            firstHeadlineBefore === secondHeadlineAfter &&
            firstHeadlineBefore === firstHeadlineRestored
          ),
          firstHeadlineBefore,
          secondHeadlineAfter,
          firstHeadlineRestored,
        };
      });
      if (!reorderResult.ok) {
        recordFailure('slide-reorder', `Slide reorder failed: ${JSON.stringify(reorderResult)}`);
      }

      // Check Share modal options (slug + password inputs)
      await page.evaluate(() => {
        document.getElementById('drawer-tab-deck')?.click();
        document.getElementById('share-deck-btn')?.click();
      });
      await page.waitForSelector('#share-modal.is-open');
      const shareInputs = await page.evaluate(() => ({
        slug: Boolean(document.getElementById('share-slug-input')),
        password: Boolean(document.getElementById('share-password-input')),
      }));
      if (!shareInputs.slug || !shareInputs.password) {
        recordFailure('share-modal', `Missing share option inputs: ${JSON.stringify(shareInputs)}`);
      }
      await page.evaluate(() => document.getElementById('share-modal-close')?.click());
      await page.waitForFunction(() => !document.getElementById('share-modal')?.classList.contains('is-open'));

      // Check Studio console button opens #cheat-console
      await page.evaluate(() => document.getElementById('deck-studio-console-btn')?.click());
      await page.waitForSelector('#cheat-console.is-open');
      await page.evaluate(() => document.querySelector('[data-cheat-close]')?.click());

      // Check Visual Representers (Code card, Vector chart, Ruled table, Video lite-embed), O(n) highlightCodeHtml, & .sld input accept
      const representerCheck = await page.evaluate(async () => {
        const mod = await import('/modules/slide-rendering.js');
        const host = document.createElement('div');
        mod.appendBody(host, [
          { code: 'const x = 42; // answer', lang: 'js', title: 'demo.js' },
          { chart: 'bar', title: 'Burn Rate', items: [{ label: 'Before', value: 44 }, { label: 'After', value: 7 }] },
          { table: { headers: ['Free', 'Passport'], rows: [['90d link', 'Permanent']] } },
          { video: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', caption: 'Demo clip' },
        ]);
        const t0 = performance.now();
        mod.highlightCodeHtml('"' + '\\"'.repeat(40000));
        const highlightMs = performance.now() - t0;
        const acceptAttr = document.getElementById('deck-upload')?.getAttribute('accept') || '';
        return {
          hasCode: Boolean(host.querySelector('.code-card .tok-keyword')),
          hasChart: Boolean(host.querySelector('.vector-chart--bar .vector-chart__bar-fill')),
          hasTable: Boolean(host.querySelector('.slide-table th')),
          hasVideo: Boolean(host.querySelector('.video-card__play')),
          acceptsSld: acceptAttr.includes('.sld'),
          fastHighlight: highlightMs < 50,
          highlightMs: Math.round(highlightMs),
        };
      });
      if (
        !representerCheck.hasCode ||
        !representerCheck.hasChart ||
        !representerCheck.hasTable ||
        !representerCheck.hasVideo ||
        !representerCheck.acceptsSld ||
        !representerCheck.fastHighlight
      ) {
        recordFailure('visual-representers', `Representer check failed: ${JSON.stringify(representerCheck)}`);
      }

      // Regression check: deleting a slide while a debounced edit is pending must NEVER overwrite the neighbour slide
      const deletePendingEditCheck = await page.evaluate(() => {
        // Switch back to Slide tab on slide index 1 (second slide)
        document.getElementById('drawer-tab-slide')?.click();
        document.getElementById('edit-nav-next')?.click();
        const getSlideHeading = (idx) => {
          const el = document.querySelectorAll('.slide')[idx];
          return el?.querySelector('h1, h2, blockquote')?.textContent?.trim() || '';
        };
        const countBefore = document.querySelectorAll('.slide').length;
        const neighbourBefore = getSlideHeading(2);
        const headlineInput = document.querySelector('[data-field="headline"], [data-field="title"]');
        if (headlineInput) {
          headlineInput.value = 'POISON-FROM-DELETED-SLIDE';
          headlineInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const deleteBtn = document.getElementById('delete-slide-btn');
        deleteBtn?.click(); // arm
        deleteBtn?.click(); // confirm delete while 3s autosave timer is still pending
        const countAfter = document.querySelectorAll('.slide').length;
        const neighbourAfter = getSlideHeading(1);
        return {
          ok:
            countAfter === countBefore - 1 &&
            neighbourAfter === neighbourBefore &&
            neighbourAfter !== 'POISON-FROM-DELETED-SLIDE',
          countBefore,
          countAfter,
          neighbourBefore,
          neighbourAfter,
        };
      });
      if (!deletePendingEditCheck.ok) {
        recordFailure(
          'delete-pending-autosave',
          `Deleting slide with pending edit corrupted neighbour: ${JSON.stringify(deletePendingEditCheck)}`
        );
      }

      console.log('  ✔ desktop UI interactions + visual representers + pending-autosave delete guard');
    }

    // 4. Mobile viewport (375×812) HUD & one-thumb drawer check
    {
      await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
      await page.goto(`${baseUrl}/deck.html?slides=guide.json`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.slide.is-active');

      await page.evaluate(() => {
        const hints = document.getElementById('hints-modal');
        if (hints?.classList.contains('is-open')) {
          document.getElementById('hints-modal-close')?.click();
        }
      });

      const mobileMetrics = await page.evaluate(() => {
        const hud = document.querySelector('.hud');
        const hudRect = hud?.getBoundingClientRect();
        const docOverflow = document.documentElement.scrollWidth > window.innerWidth;
        const edgePrev = document.getElementById('edge-nav-prev');
        const edgeStyle = edgePrev ? getComputedStyle(edgePrev).display : 'none';
        return {
          hudFitsViewport: Boolean(hudRect && hudRect.right <= window.innerWidth && hudRect.left >= 0),
          docOverflow,
          edgeNavVisible: edgeStyle !== 'none',
        };
      });

      if (!mobileMetrics.hudFitsViewport || mobileMetrics.docOverflow || !mobileMetrics.edgeNavVisible) {
        recordFailure('mobile-375x812', `Mobile layout metrics failed: ${JSON.stringify(mobileMetrics)}`);
      }
      console.log('  ✔ mobile viewport (375×812) HUD & edge-nav layout');
    }

    await page.close();
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`\n✖ Smoke suite failed with ${failures.length} issue(s).`);
    process.exitCode = 1;
  } else {
    console.log('\n✔ All smoke checks passed.');
  }
}

runSmoke().catch((err) => {
  console.error('Smoke runner crashed:', err);
  process.exitCode = 1;
});
