// The page's languages. English is the default for everyone; another language is used only when
// the viewer picked it (it is remembered in this browser). No DOM here, so a test can load it.

export const DEFAULT_LANG = 'en';
export const LANGS = ['en', 'tr'];

/** The language to start in: the one remembered, when it is still offered, else English. */
export const startLang = stored => (LANGS.includes(stored) ? stored : DEFAULT_LANG);

/** A catalog lookup with {name} placeholders; a missing key shows the key, never an empty string. */
export function translate(dict, key, vars = {}) {
  return String(dict?.[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? '') + '');
}
