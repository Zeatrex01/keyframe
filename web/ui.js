// Small helpers every part of the page uses: the API call, DOM builders, formatting and the language.

import { DEFAULT_LANG, startLang, translate } from './i18n.js';
import { THEME_KEY, startTheme, themeAttribute } from './theme.js';
import { S, el } from './store.js';
import { renderAll } from './sync.js';
import { renderProjects } from './projects.js';
import { renderSettings } from './views.js';
import { renderDraw } from './draw.js';
import { renderAgentSlots } from './agent-slots.js';
import { renderUpdate } from './update.js';

// ---------- small helpers ----------

export async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error?.message || `HTTP ${res.status}`), { code: body?.error?.code });
  return body;
}
export const fileUrl = rel => '/files/' + rel.split('/').map(encodeURIComponent).join('/');
export const baseName = rel => rel.split('/').pop();
// The player hands its error over as escaped HTML; read it back as text (nothing is inserted as markup).
export const plainText = value => new DOMParser().parseFromString(String(value ?? ''), 'text/html').documentElement.textContent.trim();
export const t = (key, vars = {}) => translate(S.dict, key, vars);

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${name}`);
  svg.append(use);
  return svg;
}
export function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}
export function button(className, label, iconName) {
  const b = node('button', className);
  b.type = 'button';
  if (iconName) b.append(icon(iconName));
  b.append(node('span', '', label));
  return b;
}
export function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
export function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? '');
  return new Intl.DateTimeFormat(S.lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

// ---------- language ----------

export function storedLang() {
  try { return startLang(localStorage.getItem('keyframe.lang')); } catch { return DEFAULT_LANG; }
}
export async function setLang(lang) {
  S.dict = await api(`/locale/${lang}.json`);
  S.lang = lang;
  try { localStorage.setItem('keyframe.lang', lang); } catch { /* private mode */ }
  document.documentElement.lang = lang;
  for (const n of document.querySelectorAll('[data-i18n]')) if (n instanceof HTMLElement) n.textContent = t(n.dataset.i18n);
  for (const n of document.querySelectorAll('[data-i18n-label]')) if (n instanceof HTMLElement) { n.setAttribute('aria-label', t(n.dataset.i18nLabel)); n.title = t(n.dataset.i18nLabel); }
  for (const n of document.querySelectorAll('[data-i18n-placeholder]')) if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) n.placeholder = t(n.dataset.i18nPlaceholder);
  for (const b of el.settingsLang.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  if (S.projects) renderProjects();
  if (S.settings) renderSettings();
  // Everything drawn from the catalog is drawn again, so no label stays in the old language
  // (the agent slots' roles, the update box). test/i18n-leak.test.js keeps this list whole.
  renderAgentSlots();
  renderUpdate();
  renderDraw();
  renderAll();
}

// ---------- theme ----------

export function storedTheme() {
  try { return startTheme(localStorage.getItem(THEME_KEY)); } catch { return startTheme(null); }
}
/** Apply a theme choice (system, dark or light) and remember it in this browser. */
export function setTheme(theme) {
  const choice = startTheme(theme);
  try { localStorage.setItem(THEME_KEY, choice); } catch { /* private mode */ }
  const attribute = themeAttribute(choice);
  if (attribute) document.documentElement.dataset.theme = attribute; else delete document.documentElement.dataset.theme;
  for (const b of el.settingsTheme.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.themeChoice === choice));
  // The browser's own chrome (title bar, address bar) takes the surface colour of the theme in use.
  const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  if (surface) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', surface);
}
