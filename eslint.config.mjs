/**
 * @file ESLint flat configuration for Your Own Personal DJ.
 *
 * The project spans three JavaScript environments, each declared explicitly:
 *  - main.js / preload.js        → Electron main process (Node.js, CommonJS)
 *  - renderer.js / audio-renderer.js → Browser renderer (classic scripts)
 *  - audio-analysis-worker.js    → Web Worker (ES module)
 *
 * Run with: npm run lint
 */
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**']
  },
  {
    files: ['main.js', 'preload.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        Response: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly'
      }
    }
  },
  {
    files: ['renderer.js', 'audio-renderer.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        indexedDB: 'readonly',
        IDBKeyRange: 'readonly',
        Worker: 'readonly',
        FileReader: 'readonly',
        navigator: 'readonly',
        atob: 'readonly',
        AudioContext: 'readonly',
        OfflineAudioContext: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Float32Array: 'readonly',
        Uint8Array: 'readonly'
      }
    }
  },
  {
    files: ['audio-analysis-worker.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        self: 'readonly',
        postMessage: 'readonly',
        console: 'readonly',
        Float32Array: 'readonly'
      }
    }
  },
  {
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }]
    }
  }
];
