// ═══════════════════════════════════════════════════════════════════════════
// PDF Export Helper
// ═══════════════════════════════════════════════════════════════════════════
// Converts every slide in the current deck into a single landscape PDF by
// painting offscreen clones with html2canvas and piping them through jsPDF.
// Both libraries are loaded lazily via ESM CDN so the main bundle stays lean.
// ═══════════════════════════════════════════════════════════════════════════

const HTML2CANVAS_SRC = new URL('./vendor/html2canvas.esm.js', import.meta.url).href;
const JSPDF_SRC = new URL('./vendor/jspdf.umd.min.js', import.meta.url).href;

let html2canvasPromise = null;
let jsPdfPromise = null;

function loadHtml2Canvas() {
  if (!html2canvasPromise) {
    html2canvasPromise = import(HTML2CANVAS_SRC).then((mod) => mod.default || mod);
  }
  return html2canvasPromise;
}

function loadJsPdf() {
  if (!jsPdfPromise) {
    jsPdfPromise = loadScript(JSPDF_SRC, () => window.jspdf?.jsPDF)
      .then((jsPDF) => ({ jsPDF }));
  }
  return jsPdfPromise;
}

function loadScript(src, getGlobal) {
  const existingGlobal = getGlobal();
  if (existingGlobal) {
    return Promise.resolve(existingGlobal);
  }

  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${src}"]`);
    const script = existingScript || document.createElement('script');

    const handleLoad = () => {
      const loadedGlobal = getGlobal();
      if (loadedGlobal) {
        resolve(loadedGlobal);
        return;
      }
      reject(new Error(`Loaded ${src}, but expected global was missing`));
    };

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });

    if (!existingScript) {
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
    } else {
      setTimeout(handleLoad, 0);
    }
  });
}

function sanitizeFileName(name = 'slideomatic') {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'slideomatic'
  );
}

function getDeckName() {
  const nameEl = document.getElementById('deck-name-text') || document.getElementById('deck-name');
  if (!nameEl) return 'slideomatic';
  const text = 'value' in nameEl ? nameEl.value : nameEl.textContent;
  return (text || 'slideomatic').trim() || 'slideomatic';
}

function prepareClone(node, width, height) {
  node.style.position = 'static';
  node.style.visibility = 'visible';
  node.style.opacity = '1';
  node.style.transform = 'none';
  node.style.left = 'auto';
  node.style.top = 'auto';
  node.style.width = `${width}px`;
  node.style.height = `${height}px`;
  node.classList.remove('is-active');
  return node;
}

export async function exportDeckToPdf(filename) {
  const slides = Array.from(document.querySelectorAll('.slide'));
  if (!slides.length) {
    throw new Error('No slides to export');
  }

  try {
    await document.fonts?.ready;
  } catch (error) {
    console.warn('Fonts did not finish loading before PDF render:', error);
  }

  const html2canvas = await loadHtml2Canvas();
  const { jsPDF } = await loadJsPdf();

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: 'a4', compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const tempHost = document.createElement('div');
  tempHost.style.position = 'fixed';
  tempHost.style.left = '-9999px';
  tempHost.style.top = '0';
  tempHost.style.width = `${pageWidth}px`;
  tempHost.style.pointerEvents = 'none';
  tempHost.style.opacity = '0';
  document.body.appendChild(tempHost);

  let rendered = 0;
  const failedSlides = [];
  try {
    for (let i = 0; i < slides.length; i += 1) {
      const slide = slides[i];
      // Render each slide in isolation: one bad slide (CORS image, OOM in
      // html2canvas) should skip that page, not abort the whole export.
      try {
        const rect = slide.getBoundingClientRect();
        const clone = slide.cloneNode(true);
        prepareClone(clone, rect.width || 1920, rect.height || 1080);
        tempHost.appendChild(clone);
        try {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const canvas = await html2canvas(clone, { backgroundColor: '#ffffff', scale: 2, useCORS: true });

          const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
          const imgWidth = canvas.width * ratio;
          const imgHeight = canvas.height * ratio;
          const x = (pageWidth - imgWidth) / 2;
          const y = (pageHeight - imgHeight) / 2;

          if (rendered > 0) {
            pdf.addPage();
          }
          const imgData = canvas.toDataURL('image/png', 1.0);
          pdf.addImage(imgData, 'PNG', x, y, imgWidth, imgHeight, undefined, 'FAST');
          rendered += 1;
        } finally {
          // Always remove the clone, even if html2canvas threw mid-render.
          if (clone.parentNode === tempHost) {
            tempHost.removeChild(clone);
          }
        }
      } catch (slideError) {
        console.warn(`PDF export: skipping slide ${i + 1}`, slideError);
        failedSlides.push(i + 1);
      }
    }
  } finally {
    if (tempHost.parentNode) {
      tempHost.parentNode.removeChild(tempHost);
    }
  }

  if (rendered === 0) {
    throw new Error('PDF export failed: no slides could be rendered.');
  }

  const finalName = `${sanitizeFileName(filename || getDeckName())}.pdf`;
  pdf.save(finalName);
  return { name: finalName, rendered, total: slides.length, failedSlides };
}
