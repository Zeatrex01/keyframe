// The page's theme: the system's light or dark, or the one the viewer chose in Settings (remembered
// in this browser, like the language). No DOM here, so a test can load it; web/boot.js applies the
// same rule before the first paint, so a light page never flashes dark.

export const THEMES = ['system', 'dark', 'light'];
export const DEFAULT_THEME = 'system';
export const THEME_KEY = 'keyframe.theme';

/** The theme to start in: the one remembered, when it is still offered, else the system's. */
export const startTheme = stored => (THEMES.includes(stored) ? stored : DEFAULT_THEME);

/** The value of `<html data-theme>` for a stored choice; null leaves it to the system. */
export const themeAttribute = stored => {
  const theme = startTheme(stored);
  return theme === 'system' ? null : theme;
};
