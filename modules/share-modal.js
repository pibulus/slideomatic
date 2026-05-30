import { slides } from './state.js';
import { getCurrentTheme } from './theme-manager.js';
import { downloadDeck } from './slide-actions.js';
import { deriveDeckName, trapFocus, focusFirstElement } from './utils.js';

const SHARE_IMAGE_PLACEHOLDER_SRC = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="#fffdf7"/><rect x="36" y="36" width="1128" height="603" fill="none" stroke="#111" stroke-width="18" stroke-dasharray="34 22"/><text x="600" y="318" text-anchor="middle" font-family="Arial, sans-serif" font-size="54" font-weight="700" fill="#111">Image not included in share link</text><text x="600" y="392" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" fill="#555">Download JSON backup for the full deck</text></svg>'
)}`;

let previousFocus = null;
let keydownHandler = null;

export function initShareModal() {
  const shareBtn = document.getElementById('share-deck-btn');
  const shareModal = document.getElementById('share-modal');
  const closeBtn = document.getElementById('share-modal-close');
  const backdrop = shareModal?.querySelector('.share-modal__backdrop');
  const copyBtn = document.getElementById('share-copy-btn');
  const urlInput = /** @type {HTMLInputElement} */ (document.getElementById('share-url-input'));
  const statusDiv = document.getElementById('share-status');
  const generateBtn = document.getElementById('share-generate-btn');
  const exportJsonBtn = document.getElementById('share-export-json-btn');
  const details = document.getElementById('share-details');

  if (!shareBtn || !shareModal) return;

  shareBtn.addEventListener('click', async () => {
    await openShareModal();
  });

  closeBtn?.addEventListener('click', closeShareModal);
  backdrop?.addEventListener('click', closeShareModal);

  generateBtn?.addEventListener('click', async () => {
    await generateLink();
  });

  exportJsonBtn?.addEventListener('click', () => {
    downloadDeck();
    showShareStatus('JSON backup downloaded.', 'success');
    setTimeout(() => hideShareStatus(), 1800);
  });

  copyBtn?.addEventListener('click', async () => {
    if (urlInput?.value) {
      if (navigator.share) {
        try {
          await navigator.share({
            title: deriveDeckName(slides),
            text: 'Slide-o-Matic deck',
            url: urlInput.value,
          });
        } catch (error) {
          if (error?.name !== 'AbortError') {
            await copyShareUrl();
          }
        }
        return;
      }

      await copyShareUrl();
    }
  });

  function showShareStatus(message, type) {
    if (!statusDiv) return;
    statusDiv.textContent = message;
    statusDiv.className = `share-modal__status is-visible is-${type}`;
  }

  function hideShareStatus() {
    if (!statusDiv) return;
    statusDiv.className = 'share-modal__status';
  }

  async function openShareModal() {
    previousFocus = document.activeElement;
    shareModal.removeAttribute('inert');
    shareModal.classList.add('is-open');
    shareModal.setAttribute('aria-hidden', 'false');

    resetShareModalState();
    showShareStatus('Generating share link...', 'loading');

    focusFirstElement(shareModal);
    await generateLink();

    if (keydownHandler) document.removeEventListener('keydown', keydownHandler);
    keydownHandler = (e) => {
      if (e.key === 'Escape') {
        closeShareModal();
      } else if (e.key === 'Tab') {
        trapFocus(e, shareModal);
      }
    };
    document.addEventListener('keydown', keydownHandler);
  }

  function closeShareModal() {
    if (previousFocus && typeof previousFocus.focus === 'function') {
      previousFocus.focus({ preventScroll: true });
      previousFocus = null;
    }

    shareModal.classList.remove('is-open');
    shareModal.setAttribute('aria-hidden', 'true');
    shareModal.setAttribute('inert', '');
    hideShareStatus();

    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }
    generateBtn?.removeAttribute('data-loading');
  }

  function resetShareModalState() {
    if (urlInput) urlInput.value = '';
    updateShareDetails(null);
    if (copyBtn) {
      copyBtn.textContent = navigator.share ? 'Share' : 'Copy';
      copyBtn.disabled = true;
    }
    if (generateBtn) {
      generateBtn.textContent = 'Generate link';
    }
  }

  async function generateLink() {
    if (generateBtn?.getAttribute('data-loading') === 'true') return;
    generateBtn?.setAttribute('data-loading', 'true');
    showShareStatus('\ud83d\udd17 Generating share link\u2026', 'loading');
    try {
      const result = await buildShareUrl();
      if (urlInput) urlInput.value = result.url;
      updateShareDetails(result);
      if (copyBtn) copyBtn.disabled = false;
      if (generateBtn) generateBtn.textContent = 'Regenerate link';
      showShareStatus(
        result.mode === 'server' ? '\u2713 Short share link ready!' : '\u2713 Fallback share link ready!',
        'success'
      );
      setTimeout(() => hideShareStatus(), 3000);
    } catch (error) {
      console.error('Share failed:', error);
      showShareStatus(`\u274c ${error.message}`, 'error');
    } finally {
      generateBtn?.removeAttribute('data-loading');
    }
  }

  async function copyShareUrl() {
    if (!urlInput?.value) return;
    try {
      await navigator.clipboard.writeText(urlInput.value);
      showShareStatus('\u2713 Link copied to clipboard!', 'success');
      setTimeout(() => hideShareStatus(), 2000);
    } catch {
      urlInput.select();
      showShareStatus('Could not copy automatically. The link is selected for manual copy.', 'error');
    }
  }

  function updateShareDetails(result) {
    if (!details) return;
    if (!result) {
      details.hidden = true;
      details.textContent = '';
      details.classList.remove('is-warning');
      return;
    }
    details.hidden = false;
    details.classList.toggle('is-warning', result.mode === 'client' && (result.strippedCount > 0 || result.fallbackReason));
    if (result.mode === 'server') {
      const bytes = result.bytes ? ` Stored deck: ${formatShareBytes(result.bytes)}.` : '';
      details.textContent = `Short hosted link ready.${bytes} Anyone who opens it gets a local copy. JSON backup keeps a full offline copy too.`;
      return;
    }
    if (result.strippedCount > 0) {
      const plural = result.strippedCount === 1 ? 'image was' : 'images were';
      details.textContent = `Using fallback URL link. ${result.strippedCount} inline ${plural} replaced with placeholders. Download JSON backup to keep the full deck.`;
      return;
    }
    details.textContent = result.fallbackReason
      ? 'Using fallback URL link. JSON backup keeps a full offline copy too.'
      : 'URL link is ready. JSON backup keeps a full offline copy too.';
  }

  async function buildShareUrl() {
    if (!Array.isArray(slides) || slides.length === 0) {
      throw new Error('No slides to share.');
    }

    const payload = {
      slides: JSON.parse(JSON.stringify(slides)),
      theme: getCurrentTheme() || undefined,
      meta: {
        title: deriveDeckName(slides),
        createdAt: Date.now(),
      },
    };

    if (shouldAttemptHostedShare()) {
      try {
        return await buildServerShareUrl(payload);
      } catch (error) {
        console.warn('Hosted share unavailable; falling back to URL share', error);
        return buildClientShareUrl(payload, error.message);
      }
    }

    return buildClientShareUrl(payload, 'Hosted sharing skipped on static local server');
  }

  function shouldAttemptHostedShare() {
    const host = window.location.hostname;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
    if (!isLocalHost) return window.location.protocol === 'https:' || window.location.protocol === 'http:';

    const params = new URLSearchParams(window.location.search);
    return window.location.port === '8888' ||
      params.has('hostedShare') ||
      new URLSearchParams(window.location.hash.replace(/^#/, '')).has('hostedShare');
  }

  async function buildServerShareUrl(payload) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    let response;
    let body = null;

    try {
      response = await fetch('/.netlify/functions/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('Share service timed out');
      }
      throw new Error(error?.message || 'Share service unavailable');
    } finally {
      window.clearTimeout(timeoutId);
    }

    try {
      body = await response.json();
    } catch {
      // Non-JSON responses happen under plain static servers.
    }

    if (!response.ok) {
      throw new Error(body?.error || `Share service unavailable (${response.status})`);
    }

    if (!body?.shareUrl) {
      throw new Error('Share service returned no link');
    }

    return {
      url: new URL(body.shareUrl, window.location.origin).toString(),
      mode: 'server',
      strippedCount: 0,
      bytes: body.bytes || 0,
      optimization: body.optimization || null,
    };
  }

  async function buildClientShareUrl(payload, fallbackReason = '') {
    // Strip inline images to keep the URL manageable.
    // Slides with data-URL images would bloat the payload beyond URL limits.
    const { slides: cleanSlides, strippedCount } = stripDataUrls(payload.slides);
    const clientPayload = {
      ...payload,
      slides: cleanSlides,
    };

    const json = JSON.stringify(clientPayload);
    const encoded = await compressAndEncode(json);

    const url = new URL(window.location.href);
    // Clear existing params to get a clean share link
    url.search = '';
    url.hash = '';
    url.searchParams.set('data', encoded);

    // Check URL length — most browsers support ~2MB but proxies/servers cap at ~8KB
    if (url.toString().length > 100_000) {
      throw new Error(
        'Deck is too large to share via URL. Download a JSON backup instead.'
      );
    }

    return {
      url: url.toString(),
      mode: 'client',
      strippedCount,
      fallbackReason,
    };
  }

  function formatShareBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  /**
   * Strip large data-URL images from slides so the share payload stays small.
   * Replaces `image.src` values that start with `data:` with a tiny placeholder
   * so the recipient deck still validates and opens.
   */
  function stripDataUrls(slideArray) {
    let strippedCount = 0;
    const cleanSlides = JSON.parse(JSON.stringify(slideArray, (key, value) => {
      if (key === 'src' && typeof value === 'string' && value.startsWith('data:')) {
        strippedCount += 1;
        return SHARE_IMAGE_PLACEHOLDER_SRC;
      }
      return value;
    }));
    return { slides: cleanSlides, strippedCount };
  }

  /**
   * Compress JSON string with gzip via CompressionStream, then base64url-encode.
   * Falls back to plain base64 if CompressionStream is unavailable.
   */
  async function compressAndEncode(jsonString) {
    if (typeof CompressionStream !== 'undefined') {
      try {
        const stream = new Blob([jsonString])
          .stream()
          .pipeThrough(new CompressionStream('gzip'));
        const compressed = await new Response(stream).arrayBuffer();
        return 'gz.' + arrayBufferToBase64Url(compressed);
      } catch (err) {
        console.warn('CompressionStream failed, falling back to plain base64', err);
      }
    }

    // Fallback: plain base64 (no compression prefix)
    return btoa(unescape(encodeURIComponent(jsonString)));
  }

  function arrayBufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    // Use URL-safe base64 (no +/= characters that break URL params)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}
