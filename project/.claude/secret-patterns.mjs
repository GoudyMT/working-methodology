// Secret-shaped file names and values, one home for every check that looks for them: the commit check and first push
// gate (first-push-check.mjs) and the branch scan CI runs (secret-shapes.mjs). A value is never printed by either.
export const SECRET_FILE = /(^|\/)(\.env(\.(?!example$|sample$|template$)[^/]+)?|\.dev\.vars|id_rsa|id_ed25519|credentials\.json)$|\.(pem|key|p12|pfx)$|(^|\/)secrets\//i;
export const SECRET_VALUE = [
	['anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
	['openai-style key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
	['stripe-style key', /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/],
	['github token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
	['aws access key', /\bAKIA[0-9A-Z]{16}\b/],
	['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
	['assigned secret', /(api[_-]?key|secret|token|password|bearer)["']?\s*[:=]\s*["'][^"'\s]{16,}["']/i],
];
