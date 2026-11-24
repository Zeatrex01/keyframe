// What each message in the conversation shows, worked out without the DOM so a test can load it:
// the owner's words in a bubble, the AI's words under its name and the spark, and on a delivered
// result a card with the check, the file, up to three notes and the two ways back.

export const MAX_NOTES = 3;

/** The quick changes above the describe box: the button's label key and the text it fills in. */
export const SUGGESTIONS = Object.freeze([
  { label: 'chat.suggest.slower', fill: 'chat.suggest.slowerText' },
  { label: 'chat.suggest.bounce', fill: 'chat.suggest.bounceText' },
  { label: 'chat.suggest.loop', fill: 'chat.suggest.loopText' },
]);

/** The chip for the runtime check of a file, or null when that file's check is not known here. */
export function checkChip(check) {
  if (!check) return null;
  if (check.failed) return { tone: 'bad', key: 'delivery.chipFailed', icon: 'i-alert' };
  if (check.opens) return { tone: 'ok', key: 'delivery.chipOk', icon: 'i-check' };
  return { tone: 'bad', key: 'delivery.chipBad', icon: 'i-alert' };
}

/**
 * The view of one message.
 * @param {any} message as the server keeps it: { id, from, text, time, work?, file?, animation?, notes? }
 * @param {{ name?: string | null, shown?: string | null, check?: any, latest?: boolean }} [context]
 *   name: who the AI is; shown: the file on the stage; check: that file's check; latest: the newest result
 * @returns {{ kind: string, text: string, time: string | null, name?: string | null, stopped?: boolean,
 *   result?: { file: string, animation: string | null, chip: any, notes: string[], actions: boolean } }}
 *   kind is you, ai or result
 */
export function messageView(message, { name = null, shown = null, check = null, latest = false } = {}) {
  const text = typeof message?.text === 'string' ? message.text : '';
  const time = typeof message?.time === 'string' ? message.time : null;
  if (message?.from === 'owner') return { kind: 'you', text, time };
  if (message?.stopped === true) return { kind: 'ai', text, time, name, stopped: true };
  const file = typeof message?.file === 'string' && message.file ? message.file : null;
  if (message?.work !== 'ready' || !file) return { kind: 'ai', text, time, name };
  const notes = (Array.isArray(message.notes) ? message.notes : [])
    .filter(note => typeof note === 'string' && note.trim()).map(note => note.trim()).slice(0, MAX_NOTES);
  const onStage = file === shown;
  return {
    kind: 'result', text, time, name,
    result: {
      file: file.split('/').pop() ?? file,
      animation: typeof message.animation === 'string' && message.animation ? message.animation : null,
      chip: onStage ? checkChip(check) : null,
      notes,
      // The ways back belong to the newest result only, and only while its file is on the stage.
      actions: latest && onStage,
    },
  };
}

/** @type {{ unit: Intl.RelativeTimeFormatUnit, size: number }[]} */
const UNITS = [{ unit: 'year', size: 31_536_000 }, { unit: 'month', size: 2_592_000 }, { unit: 'week', size: 604_800 },
  { unit: 'day', size: 86_400 }, { unit: 'hour', size: 3600 }, { unit: 'minute', size: 60 }];

/** When a message was sent, said the way a person would ("2 minutes ago", "yesterday"). */
export function whenText(time, now = Date.now(), lang = 'en') {
  const at = Date.parse(time ?? '');
  if (!Number.isFinite(at)) return '';
  const seconds = Math.round((at - now) / 1000);
  const format = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (Math.abs(seconds) < 45) return format.format(0, 'second');
  for (const { unit, size } of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(Math.round(seconds / 60) || -1, 'minute');
}

/** The phases a working agent shows, by the key of their label. */
export const LIVE_PHASES = Object.freeze(['starting', 'thinking', 'reading', 'writing', 'checking', 'answering', 'working']);

/**
 * What the director is doing right now, from /api/state's agent slots, or null when it is not working.
 * @param {any} agent  S.state.agent
 * @returns {{ phaseKey: string, tool: string | null, last: string | null, steps: number, seconds: number, text: string } | null}
 */
export function liveView(agent) {
  const slot = (Array.isArray(agent?.slots) ? agent.slots : []).find(s => s?.id === 'director');
  const live = slot?.live;
  if (!live || (slot.status !== 'working' && slot.status !== 'starting')) return null;
  const phase = LIVE_PHASES.includes(live.phase) ? live.phase : 'working';
  return {
    phaseKey: `chat.live.${phase}`,
    tool: typeof live.tool === 'string' && live.tool ? live.tool : null,
    last: typeof live.last === 'string' && live.last ? live.last : null,
    steps: Number.isInteger(live.steps) && live.steps > 0 ? live.steps : 0,
    seconds: Number.isFinite(live.seconds) ? Math.max(0, Math.round(live.seconds)) : 0,
    text: typeof live.text === 'string' ? live.text : '',
  };
}

/**
 * The phase line: the phase, then the tool it is on, or between tools the step it finished last.
 * @param {ReturnType<typeof liveView>} live @param {(key: string, values?: object) => string} t
 */
export function phaseText(live, t) {
  if (!live) return '';
  if (live.tool) return `${t(live.phaseKey)} · ${live.tool}`;
  if (live.last && live.phaseKey === 'chat.live.thinking') return `${t(live.phaseKey)} · ${t('chat.live.after', { tool: live.last, steps: live.steps })}`;
  return t(live.phaseKey);
}

/** "12 s", "1 min 05 s": how long the run has taken. */
export function elapsedText(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}
