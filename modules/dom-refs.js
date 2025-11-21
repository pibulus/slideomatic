// ═══════════════════════════════════════════════════════════════════════════
// DOM References Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Centralizes shared document queries so multiple modules can reuse the same
// elements without re-querying or depending on main.js globals.
//
// ═══════════════════════════════════════════════════════════════════════════

export const slidesRoot = document.getElementById('slides');
export const currentCounter = document.querySelector('[data-counter-current]');
export const totalCounter = document.querySelector('[data-counter-total]');
export const progressBar = document.querySelector('[data-progress]');
