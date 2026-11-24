// Findings: the shape every check returns, and the one rule that decides what is refused.
//
// A finding is { level: 'fatal' | 'warn' | 'info', code, where, message, params } (ADR-4).
// `fatal` means the official runtime or the Spine editor cannot read the file, or
// corrupts it. `warn` means it plays, but probably not as intended. `info` is a note that
// asks for nothing (critique_animation's severity 'info').
//
// The base-vs-current rule (ADR-5), ported from legacy spine_gate.js, where it replaced
// seven drifting copies:
//   * identity is `code@where`, never the message (messages carry counts and paths)
//   * only `fatal` counts; a warning never fails a write
//   * a fatal already present in the base is inherited: reported, never a refusal,
//     because the studio did not produce it and does not own the owner's rig

/** @returns {{ level: 'fatal'|'warn'|'info', code: string, where: string, message: string, params: object }} */
export const finding = (level, code, where, message, params = {}) => ({ level, code, where, message, params });

/** The identity of a finding across two versions of a file. */
export const identity = f => `${f.code}@${f.where}`;

export const fatalsOf = findings => (findings ?? []).filter(f => f.level === 'fatal');

/**
 * Split the current fatals against a baseline's.
 * `fresh`: produced by this change; a write refuses on any of them.
 * `inherited`: already in the baseline; reported only.
 * With no baseline every fatal is fresh: nothing has been excused.
 */
export function splitFatals(baselineFindings, currentFindings) {
  const had = new Set(fatalsOf(baselineFindings).map(identity));
  const fatal = fatalsOf(currentFindings);
  return {
    fresh: fatal.filter(f => !had.has(identity(f))),
    inherited: fatal.filter(f => had.has(identity(f))),
  };
}

/** One line per finding, as a refusal shows it: "where: message". */
export const describe = findings => (findings ?? []).map(f => `${f.where}: ${f.message}`);

/** "clean", "2 warnings", "1 fatal, 3 warnings". */
export function summary(findings) {
  const list = findings ?? [];
  const fatal = fatalsOf(list).length;
  const warn = list.length - fatal;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (fatal) return warn ? `${plural(fatal, 'fatal')}, ${plural(warn, 'warning')}` : plural(fatal, 'fatal');
  return warn ? plural(warn, 'warning') : 'clean';
}
