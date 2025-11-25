// ═══════════════════════════════════════════════════════════════════════════
// Constants & Configuration
// ═══════════════════════════════════════════════════════════════════════════

export const CONFIG = {
    DEBUG: false, // Set to true to enable debug logging

    // Image handling
    IMAGE: {
        MAX_BYTES: 2 * 1024 * 1024,        // Hard ceiling per optimized asset (2MB)
        TARGET_BYTES: 400 * 1024,          // Ideal compressed size (400KB)
        DIMENSION_STEPS: [1600, 1400, 1200, 1024, 900, 720],
        QUALITY_STEPS: [0.72, 0.62, 0.55, 0.48, 0.42],
        SETTLE_WINDOW_MS: 10_000,
    },

    // Auto-save (handled in edit-drawer module)
    AUTO_SAVE_DELAY_MS: 1000,

    // Overview mode
    OVERVIEW: {
        MAX_ROWS: 3,
    },
};

// Helper for debug logging
export const debug = (...args) => CONFIG.DEBUG && console.log('[Slideomatic]', ...args);
