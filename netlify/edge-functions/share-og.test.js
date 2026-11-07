import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteShareHeadHtml } from './share-og.js';

const deckHtml = fs.readFileSync(path.resolve(process.cwd(), 'deck.html'), 'utf8');

test('rewriteShareHeadHtml injects per-deck OpenGraph, Twitter, canonical, and theme-color tags', () => {
  const meta = {
    id: 'velvetpanda42',
    passwordProtected: false,
    title: 'Pastel Punk Architecture',
    description: 'Zero-build slide engine with spring physics.',
    image: 'https://slideomatic.app/.netlify/images?url=asset-123&fm=webp',
    imageAlt: 'Pastel Punk Hero Card',
    slideCount: 12,
    themeAccent: '#7c3aed',
  };

  const out = rewriteShareHeadHtml(
    deckHtml,
    meta,
    'https://slideomatic.app/s/velvetpanda42',
    'https://slideomatic.app'
  );

  assert.ok(out.includes('<title>Pastel Punk Architecture — Slide-o-Matic</title>'));
  assert.ok(out.includes('<meta name="description" content="Zero-build slide engine with spring physics." />'));
  assert.ok(out.includes('<link rel="canonical" href="https://slideomatic.app/s/velvetpanda42" />'));
  assert.ok(out.includes('<meta property="og:url" content="https://slideomatic.app/s/velvetpanda42" />'));
  assert.ok(out.includes('<meta property="og:title" content="Pastel Punk Architecture — Slide-o-Matic" />'));
  assert.ok(out.includes('<meta property="og:image" content="https://slideomatic.app/.netlify/images?url=asset-123&amp;fm=webp" />'));
  assert.ok(out.includes('<meta property="og:image:type" content="image/webp" />'));
  assert.ok(out.includes('<meta property="og:image:alt" content="Pastel Punk Hero Card" />'));
  assert.ok(out.includes('<meta name="twitter:title" content="Pastel Punk Architecture — Slide-o-Matic" />'));
  assert.ok(out.includes('<meta name="theme-color" content="#7c3aed" />'));
});

test('rewriteShareHeadHtml never leaks title, description, or image for password-protected shares', () => {
  const lockedMeta = {
    id: 'secret-deck',
    passwordProtected: true,
    title: 'Should Be Ignored Even If Passed',
    description: 'Secret description',
    image: 'https://slideomatic.app/secret.png',
    themeAccent: '#123456',
  };

  const out = rewriteShareHeadHtml(
    deckHtml,
    lockedMeta,
    'https://slideomatic.app/s/secret-deck',
    'https://slideomatic.app'
  );

  assert.ok(out.includes('<title>Locked Deck — Slide-o-Matic</title>'));
  assert.ok(out.includes('<meta property="og:title" content="Locked Deck — Slide-o-Matic" />'));
  assert.ok(out.includes('<meta property="og:image" content="https://slideomatic.app/og-image.jpg" />'));
  assert.ok(!out.includes('Should Be Ignored'));
  assert.ok(!out.includes('Secret description'));
  assert.ok(!out.includes('secret.png'));
});

test('rewriteShareHeadHtml preserves literal dollar signs ($&, $\', $`, $$) and blocks non-http image schemes', () => {
  const trickyMeta = {
    id: 'cash-rules',
    passwordProtected: false,
    title: "Save $100 $' $` $& $$ today",
    description: "Cost is $50 $' $& $$ total",
    image: 'javascript:alert(1)',
    imageAlt: "Price $' $&",
  };

  const out = rewriteShareHeadHtml(
    deckHtml,
    trickyMeta,
    'https://slideomatic.app/s/cash-rules',
    'https://slideomatic.app'
  );

  assert.ok(out.includes('<title>Save $100 $&#39; $` $&amp; $$ today — Slide-o-Matic</title>'));
  assert.ok(out.includes('<meta name="description" content="Cost is $50 $&#39; $&amp; $$ total" />'));
  assert.ok(out.includes('<meta property="og:image" content="https://slideomatic.app/og-image.jpg" />'));
});
