// Records what the real gh answers to every read the merge gate makes, for the contract test in
// tests/merge-gate.test.mjs. The gate's own tests use a canned gh; this file is how they stay true to the real one.
// Re-record after every gh upgrade, and whenever the gate asks gh for a new field.
//   node scripts/record-gh-contracts.mjs <merged pr number> <release tag>     (from the kit source, signed in to gh)
// Reads only: gh pr view, gh release view and gh api GETs. PR titles and bodies are kept as their length only.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'contracts', 'gh.json');
const [pr, tag] = process.argv.slice(2);
if (!/^\d+$/.test(pr || '') || !tag) {
	console.error('usage: node scripts/record-gh-contracts.mjs <merged pr number> <release tag>');
	process.exit(2);
}
const gh = (...args) => {
	const r = spawnSync('gh', args, { cwd: ROOT, encoding: 'utf8' });
	let json = null;
	try { json = JSON.parse(r.stdout); } catch { json = null; } // an error answer is kept as its stderr
	return { args, status: r.status, stderr: (r.stderr || '').trim().slice(0, 300), json };
};
const prose = (o) => {
	for (const k of ['title', 'body']) if (o && typeof o[k] === 'string') o[k] = `(${o[k].length} characters)`;
	return o;
};

const src = fs.readFileSync(path.join(ROOT, 'user', 'kit-tools', 'merge-gate.mjs'), 'utf8');
const lists = [...new Set([...src.matchAll(/'--json', '([^']+)'/g)].map((m) => m[1]))];
const calls = [];
for (const l of lists) {
	const c = l.split(',').includes('tagName') ? gh('release', 'view', tag, '--json', l) : gh('pr', 'view', pr, '--json', l);
	calls.push({ ...c, json: prose(c.json) });
}
const repo = gh('api', 'repos/{owner}/{repo}');
calls.push(repo);
const name = repo.json && repo.json.full_name;
for (const p of ['branches/main/protection/required_status_checks', 'rules/branches/main']) calls.push(gh('api', `repos/${name}/${p}`));
// The gate reads only the tip from the branch answer; the commit's author is account detail.
const branch = gh('api', `repos/${name}/branches/main`);
branch.json = branch.json && { name: branch.json.name, commit: { sha: branch.json.commit && branch.json.commit.sha } };
calls.push(branch);
// Only what the gate reads from the repo answer is kept; the rest is account detail.
const keep = ['full_name', 'html_url', 'allow_auto_merge', 'delete_branch_on_merge'];
repo.json = repo.json && Object.fromEntries(keep.map((k) => [k, repo.json[k]]));
const version = spawnSync('gh', ['--version'], { encoding: 'utf8' }).stdout.split('\n')[0].trim();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
// The owner's account name never goes into the kit (the scrub refuses it): the repo reads as o/r.
const text = JSON.stringify({ version, recorded: new Date().toISOString().slice(0, 10), pr: Number(pr), tag, calls }, null, 1);
fs.writeFileSync(OUT, (name ? text.split(name).join('o/r').split(name.split('/')[0]).join('o') : text) + '\n');
// A base held only by a ruleset has no classic protection; that 404 is a real answer, not a failure.
const bad = calls.filter((c) => c.status !== 0 && !(c.args[1] || '').endsWith('/protection/required_status_checks'));
console.log(`recorded ${calls.length} answers from ${version} in tests/contracts/gh.json${bad.length ? `; ${bad.length} failed: ${bad.map((c) => c.args.join(' ')).join('; ')}` : ''}`);
process.exit(bad.length ? 1 : 0);
