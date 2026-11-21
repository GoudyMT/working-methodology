// K182 (build 22): the one price table the call-cap hook and approve.mjs read, so a reviewer's spend is counted in
// list-price dollars. A token count weighs a cache re-read like new work: on the kit's own sweep log re-reads were 84%
// of reviewer tokens and 12% of the dollars (2026-11-21), so a token ceiling stopped big-diff reviewers early.
// $ per million tokens: input, output, cache write (5 min), cache read. Anthropic list prices, 2026-11.
const PRICE = {
	'opus-5-5': [4, 20, 5, 0.2], 'sonnet-5-5': [2, 10, 2.5, 0.1], 'haiku-5-5': [0.1, 0.5, 0.125, 0.01],
	'opus-5': [5, 25, 6.25, 0.5], 'sonnet-5': [2, 10, 2.5, 0.2], 'opus-4': [5, 25, 6.25, 0.5],
};
// An unknown model is priced at the dearest row of each column (no one row is dearest in all four), so a ceiling never
// lets a run go on cheaper than it is. DEAREST is only the table key its past roles are grouped under.
const DEAREST = 'opus-5-5';
const MAX_PRICE = [0, 1, 2, 3].map((i) => Math.max(...Object.values(PRICE).map((p) => p[i])));

/**
 * The prices for a model id, the most specific key first (opus-5-5 is never read as opus-5).
 *
 * Args:
 *     model: a model id as a transcript or a contract writes it (claude-opus-5-5, sonnet, ...)
 *
 * Returns:
 *     { input, output, cacheWrite, cacheRead } in $ per million tokens, whether the model was known, and its table key
 */
function price(model) {
	const m = String(model || '').toLowerCase();
	const key = Object.keys(PRICE).sort((a, b) => b.length - a.length).find((k) => m.includes(k));
	const [input, output, cacheWrite, cacheRead] = key ? PRICE[key] : MAX_PRICE;
	return { input, output, cacheWrite, cacheRead, known: Boolean(key), key: key || DEAREST };
}

/**
 * The list-price dollars of one call's usage (a transcript's usage block) or of a role's split.
 *
 * Args:
 *     usage: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens } or
 *         { input, output, cacheWrite, cacheRead }
 *     model: the model id
 *
 * Returns:
 *     dollars, a number
 */
function dollars(usage, model) {
	const u = usage || {};
	const p = price(model);
	const n = (a, b) => Number(u[a] ?? u[b]) || 0;
	return (n('input_tokens', 'input') * p.input + n('output_tokens', 'output') * p.output
		+ n('cache_creation_input_tokens', 'cacheWrite') * p.cacheWrite + n('cache_read_input_tokens', 'cacheRead') * p.cacheRead) / 1e6;
}

// Room for a reviewer's report after its last tool call: 5,000 output tokens, as the token ceiling kept.
const REPORT_TOKENS = 5000;
const reportDollars = (model) => (REPORT_TOKENS * price(model).output) / 1e6;

module.exports = { PRICE, price, dollars, reportDollars };
