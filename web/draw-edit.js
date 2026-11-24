// The words and colours of a part the AI drew (from a component or shapes), edited by hand in the
// Draw settings: each change draws the part again in the project's style guide (src/art/edit.js),
// keeping where the owner put it. A part drawn as plain SVG has no such fields.

import { node, t } from './ui.js';
import { editableOf, applyEdit } from '/src/art/edit.js';
import { colorOf } from '/src/art/style.js';

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The fields for a part, or `otherwise` when it has nothing to edit this way.
 * @param {object} p  the selected part
 * @param {{ D: any, commit: (parts: object[]) => void, say: Function }} board
 * @param {() => HTMLElement} otherwise  what to show for a part with nothing to edit this way
 * @returns {HTMLElement[]}
 */
export function artFields(p, { D, commit, say }, otherwise) {
  const fields = D.style ? editableOf(D.parts, p) : null;
  if (!fields) return [otherwise()];
  const edit = (key, value) => {
    try { commit(applyEdit(D.parts, p.name, key, value, D.style)); } catch (err) { say('draw.editFailed', { reason: err.message }, 'bad'); }
  };
  const out = [];
  if (fields.owner !== p.name) out.push(node('p', 't-caption', t('draw.editsComponent', { part: fields.owner })));
  for (const f of fields.texts) {
    const input = node('input', 'input');
    input.value = f.value; input.maxLength = 40; input.id = `drawText-${f.key.replace(/\W/g, '')}`;
    input.addEventListener('change', () => { if (input.value !== f.value) edit(f.key, input.value); });
    out.push(row(t('draw.text', { key: f.key.replace(/^shapes\.\d+\.text$/, t('draw.label')).replace(/^lines\.(\d+)$/, (_, i) => t('draw.line', { n: Number(i) + 1 })) }), input));
  }
  for (const f of fields.colours) {
    // A palette role keeps the part in the guide; a custom colour is for one-offs.
    const select = node('select', 'select');
    select.id = `drawColour-${f.key.replace(/\W/g, '')}`;
    const roles = Object.keys(D.style.palette);
    const current = f.value && !roles.includes(f.value) ? f.value : null;
    for (const v of ['', ...roles, ...(current ? [current] : [])]) {
      const o = node('option', '', v || t('draw.colourDefault'));
      o.value = v; if (v === f.value) o.selected = true;
      if (v && roles.includes(v)) o.style.background = colorOf(D.style, v);
      select.append(o);
    }
    const custom = node('input', 'sw custom');
    custom.type = 'color';
    try { const c = f.value ? colorOf(D.style, f.value) : ''; custom.value = HEX.test(c) ? c : '#ffffff'; } catch { custom.value = '#ffffff'; }
    custom.setAttribute('aria-label', t('draw.customColour'));
    select.addEventListener('change', () => edit(f.key, select.value));
    custom.addEventListener('change', () => edit(f.key, custom.value.toLowerCase()));
    const line = node('div', 'input-row');
    line.append(select, custom);
    out.push(row(t('draw.colourOf', { key: f.key === 'color' ? t('draw.colourMain') : f.key.replace(/^fill:/, '').replace(/Color$/, '') }), line, select.id));
  }
  return out;
}

function row(label, control, id = control.id) {
  const f = node('div', 'field');
  const l = node('label', '', label);
  l.htmlFor = id;
  f.append(l, control);
  return f;
}
