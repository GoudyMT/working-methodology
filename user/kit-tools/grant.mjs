#!/usr/bin/env node
// K176 (build 23b): the lead's side of the owner's yes from a card. After the owner taps Yes on the lead thread's card
// for an act a cloud worker handed back, the lead records it as a one-time grant the worker's launcher accepts:
//   node grant.mjs <worker session id> <tool> "<the exact act the guard quoted>" <card id>
// The grant is written under <Claude folder>/kit-grants/ (KIT_CLAUDE_HOME, then CLAUDE_CONFIG_DIR, then ~/.claude: set
// it to the worker's Claude folder). It is good for one hour and one call. A session never grants itself.
import { createRequire } from 'node:module';

const { writeGrant, homeOf, FRESH_MS } = createRequire(import.meta.url)('./owner-grant.cjs');
const [session, tool, act, card] = process.argv.slice(2);
if (!session || !tool || !act || !card) {
	console.error('Usage: node grant.mjs <worker session id> <tool> "<exact act>" <card id>');
	process.exit(2);
}
// The tool shell names the session that runs it: a worker granting itself would be its own yes.
if (process.env.CLAUDE_CODE_SESSION_ID && process.env.CLAUDE_CODE_SESSION_ID === session) {
	console.error('Refused: a session cannot grant itself. Only the lead records the owner\'s tap, for a worker.');
	process.exit(1);
}
try {
	const g = writeGrant({ home: homeOf(), session, tool, act, card });
	console.log(`Grant ${g.id} for ${g.tool} in session ${g.session}, from card ${g.card}, good until ${new Date(Date.parse(g.at) + FRESH_MS).toISOString()}, once: ${g.act}`);
} catch (e) {
	console.error(`Refused: ${e.message}. No grant written.`);
	process.exit(1);
}
