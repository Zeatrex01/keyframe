// The studio's log: levelled lines on stderr, so the MCP server's stdout stays JSON-RPC only.
//
//   KS_LOG_LEVEL   error | warn | info (default) | debug | silent
//   KS_LOG_FORMAT  text (default, one readable line) | json (one object per line, for collectors)
//
// Node-only (layer `core`). Nothing here throws: a log line that cannot be written is dropped.

export const LOG_LEVELS = Object.freeze({ silent: -1, error: 0, warn: 1, info: 2, debug: 3 });

const field = value => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return /[\s"=]/.test(text ?? '') ? JSON.stringify(text) : text;
};

/**
 * @param {{ level?: string, format?: string, stream?: { write(s: string): unknown }, now?: () => Date, fields?: object }} [options]
 */
export function createLogger(options = {}) {
  const env = process.env;
  const level = options.level ?? env.KS_LOG_LEVEL ?? 'info';
  const format = options.format ?? env.KS_LOG_FORMAT ?? 'text';
  const stream = options.stream ?? process.stderr;
  const now = options.now ?? (() => new Date());
  const base = options.fields ?? {};
  const limit = LOG_LEVELS[level] ?? LOG_LEVELS.info;

  const write = (name, message, fields = {}) => {
    if (LOG_LEVELS[name] > limit) return;
    const all = { ...base, ...fields };
    if (all.err instanceof Error) all.err = { message: all.err.message, code: all.err.code, stack: all.err.stack };
    let line;
    if (format === 'json') line = JSON.stringify({ time: now().toISOString(), level: name, msg: message, ...all });
    else {
      const rest = Object.entries(all).filter(([, v]) => v !== undefined)
        .map(([k, v]) => (k === 'err' ? `err=${field(v.message)}${v.stack ? `\n${v.stack}` : ''}` : `${k}=${field(v)}`));
      line = `${now().toISOString()} ${name.toUpperCase().padEnd(5)} ${message}${rest.length ? ' ' + rest.join(' ') : ''}`;
    }
    try { stream.write(line + '\n'); } catch { /* a closed stream: the line is dropped */ }
  };

  return {
    level: limit < 0 ? 'silent' : Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === limit),
    error: (m, f) => write('error', m, f),
    warn: (m, f) => write('warn', m, f),
    info: (m, f) => write('info', m, f),
    debug: (m, f) => write('debug', m, f),
    child: fields => createLogger({ level, format, stream, now, fields: { ...base, ...fields } }),
  };
}

/** A logger that writes nothing (gates, embedding). */
export const silentLogger = createLogger({ level: 'silent' });
