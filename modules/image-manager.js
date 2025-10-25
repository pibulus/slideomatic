// ═══════════════════════════════════════════════════════════════════════════
// Image Manager Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Centralizes all slide image management logic.
// - Collects image references from slide structures
// - Builds the edit drawer image manager UI
// - Provides pure helpers for removing/reordering images
// - Sets up drag/drop and remove button behaviors
//
// Dependencies: utils.js (formatting helpers), base64-tokens.js (optional metadata)
// Used by: edit-drawer.js, main.js
//
// ═══════════════════════════════════════════════════════════════════════════

import { formatBytes, escapeHtml } from './utils.js';

function collectImagePaths(slide) {
  if (!slide || typeof slide !== 'object') return [];

  const entries = [];
  const push = (path, image) => {
    if (image?.src) {
      entries.push({ path, image });
    }
  };

  push(['image'], slide.image);

  if (Array.isArray(slide.media)) {
    slide.media.forEach((item, index) => {
      push(['media', index, 'image'], item?.image);
    });
  }

  if (Array.isArray(slide.items)) {
    slide.items.forEach((item, index) => {
      push(['items', index, 'image'], item?.image);
    });
  }

  if (slide.left?.image) {
    push(['left', 'image'], slide.left.image);
  }

  if (slide.right?.image) {
    push(['right', 'image'], slide.right.image);
  }

  if (Array.isArray(slide.pillars)) {
    slide.pillars.forEach((pillar, index) => {
      push(['pillars', index, 'image'], pillar?.image);
    });
  }

  return entries;
}

function collectSlideImages(slide) {
  return collectImagePaths(slide).map((entry) => entry.image);
}

function cloneSlide(slide) {
  return JSON.parse(JSON.stringify(slide));
}

function getContainerAtPath(slide, path) {
  if (!Array.isArray(path) || path.length === 0) return null;
  let current = slide;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    if (current == null) return null;
    current = current[key];
  }
  const key = path[path.length - 1];
  return { container: current, key };
}

function removeImageByIndex(imageIndex, slide) {
  if (!slide) return slide;

  const updatedSlide = cloneSlide(slide);
  const imagePaths = collectImagePaths(updatedSlide);
  const target = imagePaths[imageIndex];
  if (!target) {
    console.warn('Image index out of bounds');
    return updatedSlide;
  }

  const location = getContainerAtPath(updatedSlide, target.path);
  if (!location) {
    return updatedSlide;
  }

  if (Array.isArray(location.container) && typeof location.key === 'number') {
    location.container.splice(location.key, 1);
  } else {
    delete location.container[location.key];
  }

  return updatedSlide;
}

function setImageAtPath(slide, path, image) {
  const location = getContainerAtPath(slide, path);
  if (!location) return;
  location.container[location.key] = image;
}

function reorderSlideImages(fromIndex, toIndex, slide) {
  if (!slide) return slide;
  if (fromIndex === toIndex) return slide;

  const updatedSlide = cloneSlide(slide);
  const imagePaths = collectImagePaths(updatedSlide);

  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= imagePaths.length ||
    toIndex >= imagePaths.length
  ) {
    console.warn('Image reorder indexes out of bounds');
    return updatedSlide;
  }

  const fromEntry = imagePaths[fromIndex];
  const toEntry = imagePaths[toIndex];
  const fromImage = fromEntry.image;
  const toImage = toEntry.image;

  setImageAtPath(updatedSlide, fromEntry.path, toImage);
  setImageAtPath(updatedSlide, toEntry.path, fromImage);

  return updatedSlide;
}

function buildImageManager(slide) {
  const images = collectSlideImages(slide);
  if (images.length === 0) return '';

  let html = `
    <div class="edit-drawer__field">
      <label class="edit-drawer__label">Images (${images.length})</label>
      <div class="edit-drawer__image-list">
  `;

  images.forEach((img, index) => {
    const filename = img.originalFilename || img.src?.split('/').pop() || 'image';
    const isBase64 = img.src?.startsWith('data:');
    const size = img.compressedSize ? ` (${formatBytes(img.compressedSize)})` : '';
    const displayName = isBase64 ? `${filename}${size}` : filename;

    html += `
      <div class="edit-drawer__image-item" draggable="true" data-image-index="${index}">
        <span class="edit-drawer__image-icon">📷</span>
        <span class="edit-drawer__image-name">${escapeHtml(displayName)}</span>
        <button type="button" class="edit-drawer__image-remove" data-image-index="${index}" title="Remove image">×</button>
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;

  return html;
}

function setupImageRemoveButtons({ root, onRemove }) {
  if (!root) return;
  const buttons = root.querySelectorAll('.edit-drawer__image-remove');
  buttons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const index = Number.parseInt(button.dataset.imageIndex, 10);
      if (Number.isNaN(index)) return;
      onRemove?.(index);
    });
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.edit-drawer__image-item:not(.dragging)')];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;

    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function setupImageDragReorder({ container, onReorder }) {
  if (!container) return;

  let draggedItem = null;
  let draggedIndex = null;

  container.addEventListener('dragstart', (event) => {
    const target = event.target;
    if (!target || !target.classList.contains('edit-drawer__image-item')) return;

    draggedItem = target;
    draggedIndex = Array.from(container.children).indexOf(draggedItem);

    target.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/html', target.innerHTML);
  });

  container.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const afterElement = getDragAfterElement(container, event.clientY);
    const draggable = container.querySelector('.dragging');

    if (!draggable) return;

    if (afterElement == null) {
      container.appendChild(draggable);
    } else {
      container.insertBefore(draggable, afterElement);
    }
  });

  container.addEventListener('dragend', () => {
    if (!draggedItem) return;

    draggedItem.classList.remove('dragging');
    const newIndex = Array.from(container.children).indexOf(draggedItem);

    if (draggedIndex != null && newIndex !== draggedIndex) {
      onReorder?.(draggedIndex, newIndex);
    }

    draggedItem = null;
    draggedIndex = null;
  });
}

export {
  collectSlideImages,
  collectImagePaths,
  removeImageByIndex,
  reorderSlideImages,
  buildImageManager,
  setupImageRemoveButtons,
  setupImageDragReorder,
};

