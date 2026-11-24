// ESLint flat config. `npm run lint`; CI fails on any error.
//
// The rules are written out (ESLint's recommended set plus a few of ours) instead of importing
// `@eslint/js`, so the only lint dependency is ESLint itself. Formatting is not linted here:
// .editorconfig states it and test/format.test.js enforces the parts that matter.

const shared = {
  // Possible problems (eslint:recommended).
  'constructor-super': 'error', 'for-direction': 'error', 'getter-return': 'error', 'no-async-promise-executor': 'error',
  'no-class-assign': 'error', 'no-compare-neg-zero': 'error', 'no-cond-assign': ['error', 'except-parens'], 'no-const-assign': 'error',
  'no-constant-binary-expression': 'error', 'no-constant-condition': ['error', { checkLoops: false }], 'no-control-regex': 'off',
  'no-debugger': 'error', 'no-dupe-args': 'error', 'no-dupe-class-members': 'error', 'no-dupe-else-if': 'error', 'no-dupe-keys': 'error',
  'no-duplicate-case': 'error', 'no-empty-character-class': 'error', 'no-empty-pattern': 'error', 'no-ex-assign': 'error',
  'no-fallthrough': 'error', 'no-func-assign': 'error', 'no-import-assign': 'error', 'no-inner-declarations': 'off',
  'no-invalid-regexp': 'error', 'no-irregular-whitespace': 'error', 'no-loss-of-precision': 'error', 'no-misleading-character-class': 'error',
  'no-new-native-nonconstructor': 'error', 'no-obj-calls': 'error', 'no-prototype-builtins': 'error', 'no-self-assign': 'error',
  'no-setter-return': 'error', 'no-sparse-arrays': 'error', 'no-this-before-super': 'error', 'no-undef': 'error',
  'no-unexpected-multiline': 'error', 'no-unreachable': 'error', 'no-unsafe-finally': 'error', 'no-unsafe-negation': 'error',
  'no-unsafe-optional-chaining': 'error', 'no-unused-private-class-members': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
  'no-useless-backreference': 'error', 'use-isnan': 'error', 'valid-typeof': 'error',
  // Suggestions (eslint:recommended).
  'no-case-declarations': 'error', 'no-delete-var': 'error', 'no-empty': ['error', { allowEmptyCatch: true }], 'no-global-assign': 'error',
  'no-nonoctal-decimal-escape': 'error', 'no-octal': 'error', 'no-redeclare': 'error', 'no-regex-spaces': 'error', 'no-shadow-restricted-names': 'error',
  'no-unused-labels': 'error', 'no-useless-catch': 'error', 'no-useless-escape': 'error', 'no-with': 'error', 'require-yield': 'error',
  // Ours.
  'no-var': 'error', 'prefer-const': ['error', { destructuring: 'all' }], 'eqeqeq': ['error', 'always', { null: 'ignore' }],
  'no-eval': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error',
};

const common = ['globalThis', 'console', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'structuredClone', 'fetch', 'Response', 'Request',
  'Headers', 'FormData', 'Blob', 'File', 'atob', 'btoa', 'performance', 'crypto', 'WebSocket', 'Event', 'EventTarget'];
const node = ['process', 'Buffer', 'setImmediate', 'clearImmediate', 'global'];
const browser = ['window', 'self', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage', 'caches', 'clients',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'matchMedia', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement',
  'HTMLCanvasElement', 'HTMLVideoElement', 'Element', 'Node', 'NodeList', 'Image', 'ImageData', 'DOMParser', 'ResizeObserver',
  'IntersectionObserver', 'MutationObserver', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FileReader',
  'XMLHttpRequest', 'alert', 'confirm', 'prompt', 'getSelection', 'OffscreenCanvas', 'createImageBitmap', 'spine'];
const globals = names => Object.fromEntries(names.map(n => [n, 'readonly']));

export default [
  { ignores: ['.claude/**', 'node_modules/**', 'test/fixtures/**', 'examples/**/pack/**', 'coverage/**'] },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals([...common, ...node]) },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: shared,
  },
  {
    files: ['web/**/*.js'],
    languageOptions: { globals: globals([...common, ...browser]) },
  },
  {
    // A classic script on purpose: it must run even when the module graph fails to load.
    files: ['web/boot.js'],
    languageOptions: { sourceType: 'script' },
    rules: { 'no-var': 'off' },
  },
  {
    // The legacy browser kit (examples/kit/*.cjs) is CommonJS scripts that draw in a headless
    // browser: their draw functions are serialized into the page (hence new Function), and
    // sketches keep spare constants. The showcase kit (examples/kit/*.js) is ordinary modules.
    files: ['examples/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals([...common, ...node, ...browser, 'require', 'module', 'exports', '__dirname', '__filename']) },
    rules: { 'no-unused-vars': 'off', 'no-new-func': 'off' },
  },
];
