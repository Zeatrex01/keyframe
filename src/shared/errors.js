// A failure that stops an operation, with a stable code the caller can branch on.
// The MCP layer turns it into a refusal; nothing in the tree matches on message text.

export class StudioError extends Error {
  /**
   * @param {string} code    stable, kebab-case identifier (e.g. 'runtime-version')
   * @param {string} message plain English for a human or an agent
   * @param {object} [details] machine-readable context
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'StudioError';
    this.code = code;
    this.details = details;
  }
}

export const isStudioError = (err, code) =>
  err instanceof StudioError && (code === undefined || err.code === code);
