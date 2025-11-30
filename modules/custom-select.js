// ═══════════════════════════════════════════════════════════════════════════
// Custom Select Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Beautiful custom dropdowns that replace ugly browser defaults.
// Spring animations and whimsical micro-interactions.
//
// Usage:
//   import { setupCustomSelect } from './custom-select.js';
//   setupCustomSelect(container, { addTrackedListener });
//
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Setup custom select behavior for all .custom-select elements
 * @param {HTMLElement} container - Parent element containing custom selects
 * @param {Object} options - Configuration options
 * @param {Function} options.addTrackedListener - Optional listener tracking function
 * @param {Function} options.onChange - Callback when selection changes
 */
let customSelectIdCounter = 0;

export function setupCustomSelect(container, options = {}) {
  const {
    addTrackedListener = null,
    onChange = null,
  } = options;

  const selects = container.querySelectorAll('.custom-select');
  if (!selects.length) return;

  selects.forEach((select) => {
    const trigger = select.querySelector('.custom-select__trigger');
    const dropdown = select.querySelector('.custom-select__dropdown');
    const valueDisplay = select.querySelector('.custom-select__value');
    const optionButtons = select.querySelectorAll('.custom-select__option');

    if (!trigger || !dropdown || !valueDisplay) return;

    ensurePopoverWiring(select, trigger, dropdown);
    alignDropdownPosition(trigger, dropdown);

    const supportsPopover = typeof dropdown.showPopover === 'function' && typeof dropdown.hidePopover === 'function';

    const repositionWhileOpen = () => {
      if (isDropdownOpen()) {
        alignDropdownPosition(trigger, dropdown);
      }
    };

    window.addEventListener('resize', repositionWhileOpen);
    window.addEventListener('scroll', repositionWhileOpen, true);

    const isDropdownOpen = () => (supportsPopover ? dropdown.matches(':popover-open') : dropdown.classList.contains('is-open'));

    const closeDropdown = () => {
      if (supportsPopover) {
        if (dropdown.matches(':popover-open')) {
          dropdown.hidePopover();
        }
      } else if (dropdown.classList.contains('is-open')) {
        dropdown.classList.remove('is-open');
        select.classList.remove('is-dropdown-open');
        trigger.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
        syncTriggerState();
      }
    };

    const openDropdown = () => {
      if (supportsPopover) {
        document.querySelectorAll('.custom-select__dropdown:popover-open').forEach((panel) => {
          if (panel !== dropdown) {
            panel.hidePopover();
          }
        });
      } else {
        document.querySelectorAll('.custom-select.is-dropdown-open').forEach((selectEl) => {
          if (selectEl !== select) {
            selectEl.classList.remove('is-dropdown-open');
            selectEl.querySelector('.custom-select__trigger')?.classList.remove('is-open');
            selectEl.querySelector('.custom-select__dropdown')?.classList.remove('is-open');
          }
        });
      }

      if (!isDropdownOpen()) {
        alignDropdownPosition(trigger, dropdown);
        if (supportsPopover) {
          dropdown.showPopover();
        } else {
          dropdown.classList.add('is-open');
          select.classList.add('is-dropdown-open');
          trigger.classList.add('is-open');
          trigger.setAttribute('aria-expanded', 'true');
        }
        syncTriggerState();
        queueMicrotask(() => focusSelectedOption(dropdown));
      }
    };

    const toggleDropdown = (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (isDropdownOpen()) {
        closeDropdown();
      } else {
        openDropdown();
      }
    };

    const handleOptionClick = (event) => {
      const option = event.target.closest('.custom-select__option');
      if (!option) return;

      const value = option.dataset.value;
      const label = option.querySelector('.custom-select__option-label')?.textContent || option.textContent;

      // Update visual selection
      optionButtons.forEach((opt) => opt.classList.remove('is-selected'));
      option.classList.add('is-selected');

      // Update displayed value
      valueDisplay.textContent = label;

      // Store value on the select element for retrieval
      select.dataset.value = value;

      closeDropdown();

      // Trigger change callback if provided
      if (onChange && typeof onChange === 'function') {
        onChange(value, label, select);
      }

      // Dispatch custom event
      const changeEvent = new CustomEvent('customSelectChange', {
        detail: { value, label },
        bubbles: true,
      });
      select.dispatchEvent(changeEvent);
    };

    // Setup listeners using tracked listener if available
    const addEventListener = addTrackedListener || ((el, event, handler) => {
      if (el) el.addEventListener(event, handler);
    });

    const handleTriggerKeydown = (event) => {
      if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'Enter') {
        toggleDropdown(event);
      } else if (event.key === 'ArrowDown') {
        if (!isDropdownOpen()) {
          openDropdown();
        }
        queueMicrotask(() => focusSelectedOption(dropdown, 'next'));
        event.preventDefault();
      } else if (event.key === 'ArrowUp') {
        if (!isDropdownOpen()) {
          openDropdown();
        }
        queueMicrotask(() => focusSelectedOption(dropdown, 'prev'));
        event.preventDefault();
      } else if (event.key === 'Escape') {
        closeDropdown();
        trigger.focus();
      }
    };

    const syncTriggerState = () => {
      const isOpen = isDropdownOpen();
      if (isOpen) {
        alignDropdownPosition(trigger, dropdown);
      }
      trigger.classList.toggle('is-open', isOpen);
      select.classList.toggle('is-dropdown-open', isOpen);
      dropdown.classList.toggle('is-open', isOpen);
      trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    };

    addEventListener(trigger, 'click', toggleDropdown);
    addEventListener(trigger, 'keydown', handleTriggerKeydown);
    addEventListener(dropdown, 'click', handleOptionClick);

    if (supportsPopover) {
      dropdown.addEventListener('toggle', () => {
        const wasWithinDropdown = dropdown.contains(document.activeElement);
        syncTriggerState();
        if (!isDropdownOpen() && wasWithinDropdown) {
          trigger.focus();
        }
      });
    } else {
      const handleOutsideClick = (event) => {
        if (!select.contains(event.target)) {
          closeDropdown();
        }
      };

      const handleEscape = (event) => {
        if (event.key === 'Escape' && isDropdownOpen()) {
          closeDropdown();
          trigger.focus();
        }
      };

      addEventListener(document, 'click', handleOutsideClick);
      addEventListener(document, 'keydown', handleEscape);
    }

    syncTriggerState();
  });
}

/**
 * Get the current value of a custom select
 * @param {HTMLElement} select - The .custom-select element
 * @returns {string|null} The currently selected value
 */
export function getCustomSelectValue(select) {
  if (!select) return null;
  return select.dataset.value || null;
}

/**
 * Set the value of a custom select programmatically
 * @param {HTMLElement} select - The .custom-select element
 * @param {string} value - The value to select
 */
export function setCustomSelectValue(select, value) {
  if (!select || !value) return;

  const option = select.querySelector(`.custom-select__option[data-value="${value}"]`);
  if (!option) return;

  const valueDisplay = select.querySelector('.custom-select__value');
  const label = option.querySelector('.custom-select__option-label')?.textContent || option.textContent;

  // Update selection
  select.querySelectorAll('.custom-select__option').forEach((opt) => {
    opt.classList.remove('is-selected');
  });
  option.classList.add('is-selected');

  // Update display
  if (valueDisplay) {
    valueDisplay.textContent = label;
  }

  select.dataset.value = value;
}

/**
 * Build a custom select from a regular <select> element
 * @param {HTMLSelectElement} selectElement - The native select element
 * @param {Object} options - Configuration
 * @returns {HTMLElement} The custom select element
 */
export function buildCustomSelectFromNative(selectElement, options = {}) {
  const {
    placeholder = 'Select an option...',
    className = '',
  } = options;

  const selectedOption = selectElement.options[selectElement.selectedIndex];
  const selectedValue = selectedOption?.value || '';
  const selectedLabel = selectedOption?.text || placeholder;

  const optionsHTML = Array.from(selectElement.options).map((option) => {
    const value = option.value;
    const label = option.text;
    const description = option.title || '';
    const isSelected = option.selected ? 'is-selected' : '';

    return `
      <button
        type="button"
        class="custom-select__option ${isSelected}"
        data-value="${value}"
        ${description ? `title="${description}"` : ''}
      >
        <span class="custom-select__option-label">${label}</span>
        ${description ? `<span class="custom-select__option-desc">${description}</span>` : ''}
      </button>
    `;
  }).join('');

  const customSelect = document.createElement('div');
  customSelect.className = `custom-select ${className}`;
  customSelect.dataset.value = selectedValue;

  customSelect.innerHTML = `
    <button type="button" class="custom-select__trigger" aria-expanded="false" aria-haspopup="listbox">
      <span class="custom-select__value">${selectedLabel}</span>
      <span class="custom-select__arrow">▼</span>
    </button>
    <div class="custom-select__dropdown" popover="auto" role="listbox" tabindex="-1">
      ${optionsHTML}
    </div>
  `;

  return customSelect;
}

function ensurePopoverWiring(select, trigger, dropdown) {
  const existingId = dropdown.id;
  const popoverId = existingId || `custom-select-popover-${++customSelectIdCounter}`;
  dropdown.id = popoverId;
  dropdown.setAttribute('popover', dropdown.getAttribute('popover') || 'auto');
  dropdown.setAttribute('tabindex', dropdown.getAttribute('tabindex') || '-1');
  dropdown.setAttribute('role', dropdown.getAttribute('role') || 'listbox');
  trigger.setAttribute('aria-controls', popoverId);
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('data-popover-id', popoverId);
  select.classList.add('custom-select--hydrated');
}

function focusSelectedOption(dropdown, direction = 'current') {
  const options = Array.from(dropdown.querySelectorAll('.custom-select__option'));
  if (!options.length) return;

  const currentIndex = options.findIndex((option) => option.classList.contains('is-selected'));
  let target = options[currentIndex >= 0 ? currentIndex : 0];

  if (direction === 'next') {
    target = options[Math.min(options.length - 1, (currentIndex >= 0 ? currentIndex : -1) + 1)];
  } else if (direction === 'prev') {
    target = options[Math.max(0, (currentIndex >= 0 ? currentIndex : options.length) - 1)];
  }

  target?.focus({ preventScroll: true });
}

function alignDropdownPosition(trigger, dropdown) {
  const rect = trigger.getBoundingClientRect();
  const scrollX = window.scrollX || 0;
  const scrollY = window.scrollY || 0;
  dropdown.style.setProperty('--custom-select-left', `${rect.left + scrollX}px`);
  dropdown.style.setProperty('--custom-select-top', `${rect.bottom + scrollY + 6}px`);
  dropdown.style.setProperty('--custom-select-width', `${rect.width}px`);
}
