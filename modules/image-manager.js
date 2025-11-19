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

import { formatBytes, escapeHtml, deepClone } from './utils.js';

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
  return deepClone(slide);
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

function replaceImageByIndex(imageIndex, slide) {
  if (!slide) return slide;

  const updatedSlide = cloneSlide(slide);
  const imagePaths = collectImagePaths(updatedSlide);
  const target = imagePaths[imageIndex];
  if (!target || !target.image) {
    console.warn('Image index out of bounds');
    return updatedSlide;
  }

  // Clear src but keep the image object with its alt/label/search text
  target.image.src = '';
  delete target.image.originalFilename;
  delete target.image.compressedSize;

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
  let html = '';

  if (images.length > 0) {
    html += `<div class="edit-drawer__image-list">`;

    images.forEach((img, index) => {
      const filename = img.originalFilename || img.src?.split('/').pop() || 'image';
      const isBase64 = img.src?.startsWith('data:');
      const isEmpty = !img.src;
      const size = img.compressedSize ? ` (${formatBytes(img.compressedSize)})` : '';
      const displayName = isBase64 ? `${filename}${size}` : filename;
      const altText = img.alt || img.label || img.search || '';
      const statusIcon = isEmpty ? '⚪' : '📷';

      html += `
        <div class="edit-drawer__image-item" draggable="true" data-image-index="${index}">
          <span class="edit-drawer__image-icon">${statusIcon}</span>
          <div class="edit-drawer__image-details">
            <input
              type="text"
              class="edit-drawer__image-alt-input"
              data-image-index="${index}"
              value="${escapeHtml(altText)}"
              placeholder="${isEmpty ? 'Image title (for search)' : 'Image name'}"
              title="${isEmpty ? 'Image title used for Google search' : 'Image name/alt text'}"
            />
            ${!isEmpty ? `<span class="edit-drawer__image-filename">${escapeHtml(displayName)}</span>` : ''}
          </div>
          ${!isEmpty ? `<button type="button" class="edit-drawer__image-replace" data-image-index="${index}" title="Replace image">↻</button>` : ''}
          <button type="button" class="edit-drawer__image-remove" data-image-index="${index}" title="Remove image slot">×</button>
        </div>
      `;
    });

    html += `</div>`;
  } else {
    html += `
      <div class="edit-drawer__image-dropzone" id="image-dropzone">
        <span class="edit-drawer__image-dropzone-icon">✶</span>
        <p>Add or drop images</p>
      </div>
    `;
  }

  html += `
    <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="add-image-btn">
      Add image
    </button>
  `;

  return html;
}

/**
 * Setup remove buttons using event delegation to prevent listener accumulation
 * Integrates with edit-drawer's tracked listener system
 * @param {Object} params - Configuration object
 * @param {HTMLElement} params.root - Container element
 * @param {Function} params.onRemove - Callback function
 * @param {Function} params.addTrackedListener - Listener tracking function from edit-drawer
 */
function setupImageRemoveButtons({ root, onRemove, addTrackedListener }) {
  if (!root || !addTrackedListener) return;

  // Use event delegation on the root instead of individual buttons
  const handleRemove = (event) => {
    const button = event.target.closest('.edit-drawer__image-remove');
    if (!button) return;

    event.preventDefault();
    const index = Number.parseInt(button.dataset.imageIndex, 10);
    if (Number.isNaN(index)) return;
    onRemove?.(index);
  };

  addTrackedListener(root, 'click', handleRemove);
}

/**
 * Setup replace buttons using event delegation
 * @param {Object} params - Configuration object
 * @param {HTMLElement} params.root - Container element
 * @param {Function} params.onReplace - Callback function
 * @param {Function} params.addTrackedListener - Listener tracking function from edit-drawer
 */
function setupImageReplaceButtons({ root, onReplace, addTrackedListener }) {
  if (!root || !addTrackedListener) return;

  const handleReplace = (event) => {
    const button = event.target.closest('.edit-drawer__image-replace');
    if (!button) return;

    event.preventDefault();
    const index = Number.parseInt(button.dataset.imageIndex, 10);
    if (Number.isNaN(index)) return;
    onReplace?.(index);
  };

  addTrackedListener(root, 'click', handleReplace);
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

/**
 * Setup image drag reordering using tracked listeners
 * Integrates with edit-drawer's tracked listener system to prevent leaks
 * @param {Object} params - Configuration object
 * @param {HTMLElement} params.container - Container element
 * @param {Function} params.onReorder - Callback function
 * @param {Function} params.addTrackedListener - Listener tracking function from edit-drawer
 */
function setupImageDragReorder({ container, onReorder, addTrackedListener }) {
  if (!container || !addTrackedListener) return;

  let draggedItem = null;
  let draggedIndex = null;

  const handleDragStart = (event) => {
    const target = event.target;
    if (!target || !target.classList.contains('edit-drawer__image-item')) return;

    draggedItem = target;
    draggedIndex = Array.from(container.children).indexOf(draggedItem);

    target.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/html', target.innerHTML);
  };

  const handleDragOver = (event) => {
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
  };

  const handleDragEnd = () => {
    if (!draggedItem) return;

    draggedItem.classList.remove('dragging');
    const newIndex = Array.from(container.children).indexOf(draggedItem);

    if (draggedIndex != null && newIndex !== draggedIndex) {
      onReorder?.(draggedIndex, newIndex);
    }

    draggedItem = null;
    draggedIndex = null;
  };

  // Track all three listeners for proper cleanup
  addTrackedListener(container, 'dragstart', handleDragStart);
  addTrackedListener(container, 'dragover', handleDragOver);
  addTrackedListener(container, 'dragend', handleDragEnd);
}

function addImageToSlide(slide, imageData) {
  if (!slide) return slide;

  const updatedSlide = cloneSlide(slide);
  const type = updatedSlide.type || 'standard';

  // Add to first available slot based on slide type
  if (type === 'title' && Array.isArray(updatedSlide.media)) {
    updatedSlide.media.push({ image: imageData });
  } else if (type === 'gallery' && Array.isArray(updatedSlide.items)) {
    updatedSlide.items.push({ image: imageData });
  } else if (type === 'grid' && Array.isArray(updatedSlide.items)) {
    updatedSlide.items.push({ image: imageData });
  } else if (type === 'pillars' && Array.isArray(updatedSlide.pillars)) {
    updatedSlide.pillars.push({ image: imageData });
  } else if (type === 'split') {
    // Add to left if empty, otherwise right
    if (!updatedSlide.left) updatedSlide.left = {};
    if (!updatedSlide.left.image) {
      updatedSlide.left.image = imageData;
    } else {
      if (!updatedSlide.right) updatedSlide.right = {};
      updatedSlide.right.image = imageData;
    }
  } else {
    // Default: add to top-level image
    updatedSlide.image = imageData;
  }

  return updatedSlide;
}

function updateImageAltText(imageIndex, altText, slide) {
  if (!slide) return slide;

  const updatedSlide = cloneSlide(slide);
  const imagePaths = collectImagePaths(updatedSlide);
  const target = imagePaths[imageIndex];

  if (!target || !target.image) {
    console.warn('Image index out of bounds or no image found');
    return updatedSlide;
  }

  // Update the alt text
  target.image.alt = altText;

  return updatedSlide;
}

export {
  collectSlideImages,
  collectImagePaths,
  removeImageByIndex,
  replaceImageByIndex,
  reorderSlideImages,
  addImageToSlide,
  updateImageAltText,
  buildImageManager,
  setupImageRemoveButtons,
  setupImageReplaceButtons,
  setupImageDragReorder,
};
