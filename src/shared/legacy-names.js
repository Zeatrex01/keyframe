// The one place legacy (Turkish) names may appear in src/.
//
// Existing projects carry names written by the legacy studio. The new tree WRITES only
// the English names and READS these as aliases, so old projects keep their history,
// references and repair markers (decided 2026-10-28). This file is the single
// exemption from test/language.test.js; every other module imports from here.

/** Legacy backup roots, read as aliases of `.backup/`. */
export const LEGACY_BACKUP_ROOTS = Object.freeze(['studio/history', '.yedek']);

/** Legacy reference-images folder, read as an alias of `reference/`. */
export const LEGACY_REFERENCE_FOLDER = 'referans';

/** Legacy delivery markers inside skeleton JSON, read as aliases of the English markers. */
export const LEGACY_MARKERS = Object.freeze({
  _kfWeights: '_kfAgirlik',
  _kfRecipe: '_kfTarif',
});

/** Legacy field names inside those markers, read as aliases of the English fields. */
export const LEGACY_MARKER_FIELDS = Object.freeze({
  baseSignature: 'tabanImza',
});
