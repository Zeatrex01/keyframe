// ask_team — the Director hands one task to a helper slot of the studio and gets its answer.
// Served only to the embedded Director when the owner set up helpers (src/agent/hub.js passes
// the team with --team); any other client has no team and is told so.

import { projectOf } from '../project.js';
import { postAsk, waitAnswer, MAX_TASK } from '../../core/team.js';
import { StudioError } from '../../shared/errors.js';

export const askTeamTool = {
  name: 'ask_team',
  tier: 'advanced',
  writes: true,
  summary: 'Hands one task to a helper of your team (the Art Director, the Senior Animator, the Researcher) and returns its answer.',
  description: 'The owner set up helpers under you in the studio\'s Settings. Give one of them one task in plain words with everything it needs (the file, the animation, what the owner asked, what to deliver); it works with its own studio tools in this project and answers here, and its answer is also shown to the owner. The Art Director draws and judges art (style_guide, draw_rig, critique_art, export_art); the Senior Animator writes and polishes motion (write_animation, set_curves, add_effect, critique_animation, see_animation); the Researcher studies references and clips and answers in numbers. You stay responsible: look at what a helper delivered (critique and see it) before you reply ready. One task per call; the call waits until the helper is done.',
  inputSchema: {
    type: 'object', required: ['slot', 'task'], additionalProperties: false,
    properties: {
      slot: { type: 'string', short: 'helper slot id, e.g. art-director', description: 'The helper\'s slot id: art-director, senior-animator, researcher, or another slot the owner added (start_here lists your team).' },
      task: { type: 'string', maxLength: MAX_TASK, description: 'The task in plain words, with the file names and what to deliver.' },
      timeoutSec: { type: 'number', minimum: 30, maximum: 1800, short: 'longest wait (default 900)', description: 'How long to wait for the helper (30-1800 seconds, default 900).' },
    },
  },
  async run({ slot, task, timeoutSec = 900 }, { session, signal }) {
    const project = projectOf(session);
    const team = Array.isArray(session.team) ? session.team : [];
    if (!team.length) throw new StudioError('no-team', 'You have no team here: helpers are set up in the studio\'s Settings (AI connection), and only the studio\'s own Director can ask them. Do the work yourself.');
    const member = team.find(m => m.id === slot);
    if (!member) throw new StudioError('unknown-slot', `There is no helper "${slot}" in your team: ${team.map(m => `${m.id} (${m.role})`).join(', ')}.`, { slot, team: team.map(m => m.id) });
    if (typeof task !== 'string' || !task.trim()) throw new StudioError('bad-argument', 'ask_team needs a task.');
    const id = postAsk(project.dir, { slot, task: task.trim().slice(0, MAX_TASK) });
    const answer = await waitAnswer(project.dir, id, { timeoutMs: timeoutSec * 1000, signal });
    if (signal?.aborted) return { cancelled: true };
    if (!answer) throw new StudioError('team-timeout', `${slot} did not answer within ${timeoutSec} seconds; do the work yourself or ask again with a smaller task.`, { slot });
    if (!answer.ok) throw new StudioError(answer.code === 'agent-busy' ? 'agent-busy' : 'team-failed', `${slot} could not do it: ${answer.message ?? 'no answer'}.`, { slot, code: answer.code });
    return { slot, role: member.role, answer: answer.text ?? '', toolCalls: answer.tools ?? 0,
      next: 'Look at what the helper delivered (critique_animation, see_animation or critique_art) before you reply ready.' };
  },
};
