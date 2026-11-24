// wait_for_message / reply — the agent's side of the conversation the owner has in the page.

import { projectOf } from '../project.js';
import { waitForOwner, appendMessage, touchAgent, readAgent, WORK_STATES } from '../../core/chat.js';
import { readFocus } from '../../core/focus.js';
import { proofOf } from '../../core/proof.js';
import { StudioError } from '../../shared/errors.js';

export const waitForMessageTool = {
  name: 'wait_for_message',
  tier: 'core',
  writes: true,
  summary: 'Waits for what the owner types in the studio page and returns it; call it again whenever it returns nothing.',
  description: 'The owner describes the motion they want, and what to change, in the studio page. This call blocks until they send something (or `timeoutSec` passes) and returns their unread messages, oldest first. While you are waiting the page shows the agent as connected. The working loop: wait_for_message -> reply {work:"writing"} with one short line -> do the work with the other tools -> reply {work:"checking"} while you check and look -> reply {work:"ready", file, animation} saying in one or two sentences what changed -> wait_for_message again. An empty `messages` means nobody wrote yet: call it again. Keep replies short; the owner judges the motion on the stage, not the text.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      timeoutSec: { type: 'number', minimum: 1, maximum: 300, short: 'seconds to wait (default 50)', description: 'How long to wait before returning nothing (1-300, default 50). Keep it under your client\'s tool timeout.' },
      name: { type: 'string', short: 'your name, shown in the page', description: 'How the page names you, e.g. "Claude" or "Codex".' },
    },
  },
  async run({ timeoutSec = 50, name }, { session, signal }) {
    const project = projectOf(session);
    const messages = await waitForOwner(project.dir, { timeoutMs: timeoutSec * 1000, signal, name });
    // A mark is news once: later, unrelated messages do not carry it again.
    const marked = readFocus(project.dir);
    const focus = marked && marked.time !== readAgent(project.dir).focusSeen ? marked : null;
    if (focus && messages.length) touchAgent(project.dir, { focusSeen: focus.time });
    return messages.length
      ? { messages: messages.map(({ id, text, time }) => ({ id, text, time })),
        ...(focus ? { markedInReference: focus, markedNote: 'The owner marked this part of the reference; the reference tools use it by default (measure_reference with no arguments).' } : {}), next: 'reply with work:"writing", do the work, then reply with work:"ready".' }
      : { messages: [], next: 'Nothing yet. Call wait_for_message again.' };
  },
};

export const replyTool = {
  name: 'reply',
  tier: 'core',
  writes: true,
  summary: 'Says one short thing to the owner in the studio page and sets the work state shown there (writing, checking, ready).',
  description: 'Appends your message to the conversation in the studio page. `work` drives the three-step indicator the owner watches: "writing" when you start, "checking" while you check and look at frames, "ready" when the delivery is written and proven (refused with `not-proven` until check_skeleton and critique_animation ran on a clip after its last write, or critique_art on a drawing; refused with `weak-verdict` after a "faulty" critique, and after a "mechanical" one unless `weak` says what is still weak); with "ready" pass the delivery `file` and the `animation` so the page loads and plays exactly that. "idle" clears the indicator (use it for a plain answer or a question). One or two sentences: what you did or what you need; numbers only when they help the owner decide.',
  inputSchema: {
    type: 'object', required: ['text'], additionalProperties: false,
    properties: {
      text: { type: 'string', description: 'What to tell the owner, in their language. One or two sentences.' },
      work: { type: 'string', enum: [...WORK_STATES], short: 'idle | writing | checking | ready', description: 'The work state the page shows. Default: unchanged.' },
      file: { type: 'string', short: 'delivery file, with work:"ready"', description: 'Project-relative delivery file the page should show (with work:"ready").' },
      animation: { type: 'string', short: 'animation to play, with work:"ready"', description: 'Animation the page should play (with work:"ready").' },
      weak: { type: 'string', short: 'what stays weak, when the critique said mechanical', description: 'With work "ready" on a clip whose last critique_animation verdict was "mechanical": one plain sentence for the owner on what is still weak and why it was not fixed. Leave it out after a revision that critiques "good".' },
    },
  },
  run({ text, work, file, animation, weak }, { session }) {
    const project = projectOf(session);
    if (file) project.resolve(file);
    // "Ready" is a claim about the file: refused for a delivery written and not proven since.
    if (work === 'ready' && file) {
      const { missing, verdict } = proofOf(project.dir, file, animation ?? null);
      if (missing.length) {
        throw new StudioError('not-proven', `${file}${animation ? ` (${animation})` : ''} was written and not proven since: run ${missing.join(' and ')} on it, look at what they say, then reply ready.`,
          { file, ...(animation ? { animation } : {}), missing });
      }
      // A weak critique is revised, or said plainly: never passed off as done.
      if (verdict === 'faulty') throw new StudioError('weak-verdict', `The last critique of ${file}${animation ? ` (${animation})` : ''} found errors: fix them, critique again, then reply ready.`, { file, verdict });
      if (verdict === 'mechanical' && !(typeof weak === 'string' && weak.trim())) {
        throw new StudioError('weak-verdict', `The last critique of ${file}${animation ? ` (${animation})` : ''} said "mechanical": revise what it found and critique again, or reply ready with \`weak\` saying plainly what is still weak.`, { file, verdict });
      }
    }
    if (weak && typeof weak === 'string' && weak.trim()) text = `${text}\n\nStill weak: ${weak.trim()}`;
    const state = work ?? readAgent(project.dir).work;
    const message = appendMessage(project.dir, { from: 'agent', text, work: state, ...(file ? { file } : {}), ...(animation ? { animation } : {}), ...(typeof session.slot === 'string' && session.slot ? { slot: session.slot } : {}) });
    // The cursor is not moved here: an owner message that arrived while the agent worked is still
    // unread, and wait_for_message returns it next (it steps over the agent's own lines itself).
    touchAgent(project.dir, { work: state });
    return { sent: message.id, work: state };
  },
};
