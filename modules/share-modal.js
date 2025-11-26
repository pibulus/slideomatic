import { slides } from './state.js';
import { getCurrentTheme } from './theme-manager.js';
import { deriveDeckName, trapFocus, focusFirstElement } from './utils.js';

/** @type {any} */
var QRCodeStyling;

let previousFocus = null;
let keydownHandler = null;

export function initShareModal() {
  const shareBtn = document.getElementById('share-deck-btn');
  const shareModal = document.getElementById('share-modal');
  const closeBtn = document.getElementById('share-modal-close');
  const backdrop = shareModal?.querySelector('.share-modal__backdrop');
  const copyBtn = document.getElementById('share-copy-btn');
  const urlInput = /** @type {HTMLInputElement} */ (document.getElementById('share-url-input'));
  const qrContainer = document.getElementById('share-qr-code');
  const statusDiv = document.getElementById('share-status');

  if (!shareBtn || !shareModal) return;

  shareBtn.addEventListener('click', async () => {
    await openShareModal();
  });

  closeBtn?.addEventListener('click', closeShareModal);
  backdrop?.addEventListener('click', closeShareModal);

  copyBtn?.addEventListener('click', () => {
    if (urlInput?.value) {
      navigator.clipboard.writeText(urlInput.value).then(() => {
        showShareStatus('✓ Link copied to clipboard!', 'success');
        setTimeout(() => hideShareStatus(), 2000);
      }).catch(() => {
        showShareStatus('⚠️ Failed to copy. Try selecting and copying manually.', 'error');
      });
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
    shareModal.classList.add('is-open');
    shareModal.setAttribute('aria-hidden', 'false');

    // Reset state
    if (urlInput) urlInput.value = '';
    if (qrContainer) qrContainer.innerHTML = '';
    showShareStatus('🔗 Generating share link...', 'loading');

    // Focus management
    focusFirstElement(shareModal);

    if (keydownHandler) document.removeEventListener('keydown', keydownHandler);
    keydownHandler = (e) => {
      if (e.key === 'Escape') {
        closeShareModal();
      } else if (e.key === 'Tab') {
        trapFocus(e, shareModal);
      }
    };
    document.addEventListener('keydown', keydownHandler);

    try {
      const shareUrl = await generateShareUrl();
      if (urlInput) urlInput.value = shareUrl;
      generateQRCode(shareUrl);
      showShareStatus('✓ Ready to share!', 'success');
      setTimeout(() => hideShareStatus(), 3000);
    } catch (error) {
      console.error('Share failed:', error);
      showShareStatus(`❌ ${error.message}`, 'error');
    }
  }

  function closeShareModal() {
    // Restore focus BEFORE hiding the modal
    if (previousFocus && typeof previousFocus.focus === 'function') {
      previousFocus.focus();
      previousFocus = null;
    }

    shareModal.classList.remove('is-open');
    shareModal.setAttribute('aria-hidden', 'true');
    hideShareStatus();

    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }
  }

  async function generateShareUrl() {
    const deckPayload = {
      version: 1,
      slides,
      theme: getCurrentTheme(),
      meta: {
        title: deriveDeckName(slides),
        createdAt: Date.now(),
      },
    };

    let response;
    try {
      response = await fetch('/.netlify/functions/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(deckPayload),
      });
    } catch {
      throw new Error('Share service unavailable. Use `netlify dev` locally or the deployed site.');
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Ignore JSON parse failure; handled below
    }

    if (!response.ok) {
      const message = payload?.error || 'Unable to create share link';
      throw new Error(message);
    }

    if (!payload?.shareUrl && !payload?.id) {
      throw new Error('Share link response missing id');
    }

    return payload.shareUrl || buildShareUrlFromId(payload.id);
  }

  function buildShareUrlFromId(id) {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('share', id);
    return url.toString();
  }

  function generateQRCode(url) {
    if (!qrContainer) return;
    if (typeof QRCodeStyling === 'undefined') {
      qrContainer.innerHTML = '<p style="color: #666;">QR code unavailable</p>';
      return;
    }

    qrContainer.innerHTML = '';

    // Get colors from current theme, or use default pastel gradient
    const themeColors = getThemeColorsForQR();

    // QR code styling matching your QR buddy's approach!
    const qrCode = new QRCodeStyling({
      width: 400,
      height: 400,
      margin: 20,
      type: 'canvas',
      data: url,
      qrOptions: {
        typeNumber: 0,
        mode: 'Byte',
        errorCorrectionLevel: 'Q' // 25% recovery - perfect for styled codes
      },
      dotsOptions: {
        type: 'rounded', // Better for gradients + scans
        gradient: {
          type: 'linear',
          rotation: 0.785, // 45deg
          colorStops: [
            { offset: 0, color: themeColors[0] },
            { offset: 0.5, color: themeColors[1] },
            { offset: 1, color: themeColors[2] }
          ]
        }
      },
      backgroundOptions: {
        color: themeColors[3] // Background color
      },
      cornersSquareOptions: {
        type: 'extra-rounded',
        gradient: {
          type: 'linear',
          rotation: 0.785,
          colorStops: [
            { offset: 0, color: themeColors[0] },
            { offset: 0.5, color: themeColors[1] },
            { offset: 1, color: themeColors[2] }
          ]
        }
      },
      cornersDotOptions: {
        type: 'dot',
        gradient: {
          type: 'linear',
          rotation: 0.785,
          colorStops: [
            { offset: 0, color: themeColors[0] },
            { offset: 0.5, color: themeColors[1] },
            { offset: 1, color: themeColors[2] }
          ]
        }
      }
    });

    qrCode.append(qrContainer);
  }

  function getThemeColorsForQR() {
    // Try to get colors from current theme
    const currentTheme = getCurrentTheme();

    if (currentTheme && currentTheme.palette) {
      const palette = currentTheme.palette;

      // Extract 3-4 vibrant colors from theme
      const colors = [];

      // Look for accent/primary colors first
      if (palette.accent) colors.push(palette.accent);
      if (palette.primary) colors.push(palette.primary);
      if (palette.secondary) colors.push(palette.secondary);

      // Fill in with other theme colors if needed
      if (colors.length < 3 && palette.text) colors.push(palette.text);
      if (colors.length < 3 && palette.background) {
        // Use background but lightened
        colors.push(lightenColor(palette.background, 0.3));
      }

      // Pad with defaults if theme doesn't have enough colors
      while (colors.length < 3) {
        colors.push('#FF73C8', '#9CCAFF', '#FFE26F');
      }

      // Background color (use theme bg or white)
      const bgColor = palette.background || '#FFFFFF';

      return [colors[0], colors[1], colors[2], bgColor];
    }

    // Default pastel gradient (matching your aesthetic)
    return [
      '#FF73C8', // Pink
      '#9CCAFF', // Blue
      '#FFE26F', // Yellow
      '#FFFFFF'  // White bg
    ];
  }

  function lightenColor(color, amount) {
    // Simple color lightener
    const num = parseInt(color.replace('#', ''), 16);
    const r = Math.min(255, ((num >> 16) & 0xFF) + Math.floor(255 * amount));
    const g = Math.min(255, ((num >> 8) & 0xFF) + Math.floor(255 * amount));
    const b = Math.min(255, (num & 0xFF) + Math.floor(255 * amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }
}
