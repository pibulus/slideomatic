import globals from 'globals';
import pluginJs from '@eslint/js';

export default [
  {
    languageOptions: { 
      globals: {
        ...globals.browser,
        ...globals.node,
        imageCompression: 'readonly',
        QRCodeStyling: 'readonly'
      },
      ecmaVersion: 2022,
      sourceType: 'module'
    }
  },
  {
    ignores: ['admin.js', 'node_modules/**', 'js/vendor/**', 'netlify/functions/**']
  },
  pluginJs.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_'
      }],
      'no-undef': 'error',
      'semi': ['error', 'always'],
      'quotes': ['warn', 'single', { 'avoidEscape': true }]
    }
  }
];
