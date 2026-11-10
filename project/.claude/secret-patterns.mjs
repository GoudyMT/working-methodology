// Secret-shaped file names and values, one home for every check that looks for them: the commit check and first push
// gate (first-push-check.mjs), the pre-push scan and the branch scan CI runs (secret-shapes.mjs). A value is never
// printed by either. T1 (1.25.0) added the 12 shapes the 1.24.0 scan missed, from the formats the issuers publish; a
// feature-branch push now goes without the owner's yes, so this list is what stands between a key and a public push.
export const SECRET_FILE = /(^|\/)((\.env|[\w.-]+\.env)(\.(?!example$|sample$|template$)[^/]+)?|\.dev\.vars|id_rsa|id_ed25519|credentials\.json)$|\.(pem|key|p12|pfx|ppk)$|(^|\/)secrets\//i;
// The value an assignment holds: no quote, space, $ (a variable), < (a placeholder) or { (a template).
const VALUE = String.raw`[^\s"'$<{]`;
export const SECRET_VALUE = [
	['anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
	['openai-style key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
	['stripe-style key', /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/],
	['stripe webhook secret', /\bwhsec_[A-Za-z0-9]{24,}/],
	['github token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
	['github fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{50,}/],
	['slack token', /\bxox[abposr]-[A-Za-z0-9-]{20,}/],
	['google api key', /\bAIza[A-Za-z0-9_-]{35}\b/],
	['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
	['aws access key', /\bAKIA[0-9A-Z]{16}\b/],
	['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----/],
	// The 1.25.0 sweep: shapes the issuers publish that the list missed.
	['azure storage key', /\bAccountKey=[A-Za-z0-9+/]{40,}={0,2}/],
	['gitlab token', /\bglpat-[A-Za-z0-9_-]{20,}/],
	['hugging face token', /\bhf_[A-Za-z0-9]{30,}/],
	['sendgrid key', /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
	['google oauth secret', /\bGOCSPX-[A-Za-z0-9_-]{20,}/],
	['slack webhook', /hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]{20,}/],
	['putty private key', /PuTTY-User-Key-File-\d+:/],
	['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
	['url with a password', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/$<{]{6,}@[^\s/]+/i],
	['bearer header', new RegExp(String.raw`\bauthorization\s*:\s*(bearer|basic|token)\s+${VALUE}{16,}`, 'i')],
	['assigned secret', /(api[_-]?key|secret|token|password|bearer)["']?\s*[:=]\s*["'][^"'\s]{16,}["']/i],
	// Unquoted: KEY=value and key = value. The value is long, in a key's own characters with a digit among them, and
	// not a name read from elsewhere (process.env.DB_PASSWORD), so code (SECRET_FILE = /.../) does not trip it.
	['assigned secret', /(api[_-]?key|secret|token|passw(or)?d|access[_-]?key)\w*\s*[:=]\s*(?![A-Za-z_]\w*(\.\w+)+\b)(?=[A-Za-z0-9+/=_.~-]*\d)[A-Za-z0-9+/=_.~-]{16,}(?![^\s;,])/i],
];
