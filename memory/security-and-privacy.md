---
name: security-and-privacy
description: Read before committing, before a PR merge, and whenever a test or script touches a route that reaches a live service.
metadata:
  type: feedback
---

**Privacy and security rank above everything.** Personal data stays on the device by default; no third-party trackers; no ads; secrets never ship to the client (a backend proxies paid calls).

**Two-tier security gate**
- **Before every commit**: scan the staged diff for account-specific ids, secrets, tokens, keys, any logging or echo of user input, and any new data-gathering or egress surface. Show the check passing.
- **Before every PR merge**: the full pre-PR deep sweep with the adversarial security lens up front - prove nothing personal ships and nothing is gatherable from the code by a malicious reader.
- **Committed config uses placeholders**; real ids stay local or come at deploy.
- **Never print secret values**; list key names only. Mask ids in any diff or dry run.

**A dev server is not a sandbox when it holds live keys.** A form submitted there can send real email or reach a paid service. In any scripted walkthrough, stub every route that reaches an outward or paid service before the first page loads, and prove the stub with a control (a counter on the handler). Read a route's handler for outbound calls before submitting its form. Branch preview builds carry live secrets too.

**Dependency advisories**: an unfixable high gets removal researched first; a scoped, documented ignore for that single advisory is risk acceptance of a non-risk, not turning the audit off. Keep the lockfile diff minimal after any override experiment.

**Machine guards back the rules.** A pre-tool hook that asks before any push in any spelling, or any write call to the code host, catches what a literal-prefix permission rule misses. Prove the guard with a case suite after every edit. It asks; it never replaces naming the act and waiting for the owner.

**Safety-critical constants** (crisis numbers, official links) are verified against the official source, never memory.

**Zero operator cost.** A project with no revenue never ships a cost that scales with use. Paid synthesis is bring-your-own-key, stored encrypted on the client and sent straight to the provider. Any operator tier degrades to the free path, never bills, and needs a hard cap. Reject providers that train on prompts.

Related: [[review-and-sweeps]], [[remote-and-outward-actions]], [[release-and-deploy]].
