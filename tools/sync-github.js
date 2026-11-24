#!/usr/bin/env node
// Make the repository's labels and milestones match .github/labels.json and .github/milestones.json,
// and put every open issue that carries a milestone's label into that milestone.
//
//   node tools/sync-github.js            print the plan, change nothing
//   node tools/sync-github.js --apply    carry it out (needs GITHUB_TOKEN with issues: write)
//
// GITHUB_REPOSITORY (owner/name) names the repository; the repo-sync workflow sets both. Nothing is
// ever deleted: a label or milestone that is not in the files is left alone, and an issue that
// already has a milestone keeps it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Read the two files. */
export function readWanted(root = ROOT) {
  const read = name => JSON.parse(fs.readFileSync(path.join(root, '.github', name), 'utf8'));
  return { labels: read('labels.json').labels, milestones: read('milestones.json').milestones };
}

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * What has to change, as a list of steps. Pure: the gate checks it without the network.
 * @param {{ labels: object[], milestones: object[] }} wanted
 * @param {{ labels: Array<{ name: string, color: string, description: string | null }>,
 *   milestones: Array<{ number: number, title: string, description: string | null, state: string }>,
 *   issues: Array<{ number: number, labels: string[], milestone: number | null, pull?: boolean }> }} current
 * @returns {Array<{ kind: string, [key: string]: any }>}
 */
export function plan(wanted, current) {
  const steps = [];
  const names = current.labels.map(l => l.name);
  for (const label of wanted.labels) {
    const exact = current.labels.find(l => same(l.name, label.name));
    const old = exact ? null : current.labels.find(l => (label.from ?? []).some(f => same(f, l.name)));
    const have = exact ?? old;
    const body = { name: label.name, color: label.color.toLowerCase(), description: label.description };
    if (!have) steps.push({ kind: 'create-label', ...body });
    else if (have.name !== label.name || have.color.toLowerCase() !== body.color || (have.description ?? '') !== body.description) {
      steps.push({ kind: 'update-label', current: have.name, ...body });
    }
    if (old) names.splice(names.indexOf(old.name), 1, label.name);
  }

  const numbers = new Map();
  for (const m of wanted.milestones) {
    const have = current.milestones.find(c => same(c.title, m.title));
    if (!have) steps.push({ kind: 'create-milestone', title: m.title, description: m.description });
    else {
      numbers.set(m.title, have.number);
      if ((have.description ?? '') !== m.description) steps.push({ kind: 'update-milestone', number: have.number, title: m.title, description: m.description });
    }
  }

  for (const issue of current.issues) {
    if (issue.pull || issue.milestone !== null) continue;
    const m = wanted.milestones.find(w => w.label && issue.labels.some(l => same(l, w.label)));
    if (m) steps.push({ kind: 'set-milestone', issue: issue.number, title: m.title, number: numbers.get(m.title) ?? null });
  }
  return steps;
}

/** A small REST client on fetch. */
function github(repo, token) {
  const call = async (method, url, body) => {
    const res = await fetch(url.startsWith('http') ? url : `https://api.github.com/repos/${repo}${url}`, {
      method,
      headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'keyframe-studio-sync',
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
    return { data: res.status === 204 ? null : await res.json(), next: /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] };
  };
  const all = async url => {
    const out = [];
    for (let next = `${url}${url.includes('?') ? '&' : '?'}per_page=100`; next;) { const r = await call('GET', next); out.push(...r.data); next = r.next; }
    return out;
  };
  return { call, all };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const repo = process.env.GITHUB_REPOSITORY ?? 'Zeatrex01/keyframe';
  const token = process.env.GITHUB_TOKEN;
  if (apply && !token) { console.error('--apply needs GITHUB_TOKEN.'); process.exit(2); }
  const gh = github(repo, token);
  const current = {
    labels: await gh.all('/labels'),
    milestones: await gh.all('/milestones?state=all'),
    issues: (await gh.all('/issues?state=open')).map(i => ({ number: i.number, labels: i.labels.map(l => l.name), milestone: i.milestone?.number ?? null, pull: !!i.pull_request })),
  };
  const steps = plan(readWanted(), current);
  if (!steps.length) { console.log(`${repo}: labels and milestones already match.`); return; }
  for (const step of steps) console.log(`${apply ? '' : '(plan) '}${step.kind} ${step.name ?? step.title ?? ''}${step.issue ? ` #${step.issue}` : ''}`);
  if (!apply) { console.log(`\n${steps.length} change(s). Run with --apply to make them.`); return; }

  const created = new Map();
  for (const step of steps) {
    const { kind, ...body } = step;
    if (kind === 'create-label') await gh.call('POST', '/labels', body);
    if (kind === 'update-label') await gh.call('PATCH', `/labels/${encodeURIComponent(body.current)}`, { new_name: body.name, color: body.color, description: body.description });
    if (kind === 'create-milestone') created.set(body.title, (await gh.call('POST', '/milestones', body)).data.number);
    if (kind === 'update-milestone') await gh.call('PATCH', `/milestones/${body.number}`, { description: body.description });
    if (kind === 'set-milestone') await gh.call('PATCH', `/issues/${body.issue}`, { milestone: body.number ?? created.get(body.title) });
  }
  console.log(`\n${steps.length} change(s) made.`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('sync-github.js')) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
