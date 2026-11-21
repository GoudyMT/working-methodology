// The sweep meter (build 22): the price table, the ceiling lines in a reviewer's brief and the split slices. Each case
// is a way a reviewer ran unmetered, unstartable or unread. prices.cjs and the dollar ceilings are new on this branch,
// so a test that needs them asserts they are there before it uses them.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const require = createRequire(import.meta.url);

// why: catches an unknown model metered cheaper than a known one, so a dollar ceiling lets its run go on
test('an unknown model id is priced at least as dear as every known model, in every usage kind', () => {
	let prices;
	assert.doesNotThrow(() => { prices = require('../user/kit-hooks/prices.cjs'); }, 'user/kit-hooks/prices.cjs loads');
	const KINDS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
	for (const kind of KINDS) {
		const unknown = prices.dollars({ [kind]: 1e6 }, 'claude-mystery-9');
		for (const key of Object.keys(prices.PRICE)) {
			const known = prices.dollars({ [kind]: 1e6 }, key);
			assert.ok(unknown >= known, `${kind}: an unknown model costs ${unknown} per million, ${key} costs ${known}`);
		}
	}
	const empty = prices.dollars({ cache_creation_input_tokens: 1e6 }, '');
	assert.equal(empty, prices.dollars({ cache_creation_input_tokens: 1e6 }, 'claude-mystery-9'), 'no model at all is unknown too');
});
