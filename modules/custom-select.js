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
    const options = select.querySelectorAll('.custom-select__option');

    if (!trigger || !dropdown || !valueDisplay) return;

    const closeDropdown = () => {
      trigger.classList.remove('is-open');
      dropdown.classList.remove('is-open');
    };

    const openDropdown = () => {
      // Close any other open custom selects
      document.querySelectorAll('.custom-select__trigger.is-open').forEach((other) => {
        if (other !== trigger) {
          other.classList.remove('is-open');
          other.nextElementSibling?.classList.remove('is-open');
        }
      });

      trigger.classList.add('is-open');
      dropdown.classList.add('is-open');
    };

    const toggleDropdown = (event) => {
      event.stopPropagation();
      const isOpen = trigger.classList.contains('is-open');

      if (isOpen) {
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
      options.forEach((opt) => opt.classList.remove('is-selected'));
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

    addEventListener(trigger, 'click', toggleDropdown);
    addEventListener(dropdown, 'click', handleOptionClick);

    // Close on outside click
    const handleOutsideClick = (event) => {
      if (!select.contains(event.target)) {
        closeDropdown();
      }
    };

    // Use a small delay to prevent immediate closing from trigger click
    setTimeout(() => {
      addEventListener(document, 'click', handleOutsideClick);
    }, 100);

    // Close on escape key
    const handleEscape = (event) => {
      if (event.key === 'Escape' && trigger.classList.contains('is-open')) {
        closeDropdown();
        trigger.focus();
      }
    };

    addEventListener(document, 'keydown', handleEscape);
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
    <button type="button" class="custom-select__trigger">
      <span class="custom-select__value">${selectedLabel}</span>
      <span class="custom-select__arrow">▼</span>
    </button>
    <div class="custom-select__dropdown">
      ${optionsHTML}
    </div>
  `;

  return customSelect;
}
