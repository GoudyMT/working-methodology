# Third-Party Plugins and Skills

These are not the owner's work, so the kit links to them instead of copying them. Install what a project needs.

## Plugins from the official marketplace

The marketplace `anthropics/claude-plugins-official` is known to Claude Code by default. In a Claude Code
terminal, run `/plugin` and install, or add each one under `enabledPlugins` in `~/.claude/settings.json`:

| Plugin | Why the owner uses it |
|---|---|
| `superpowers@claude-plugins-official` | Process skills: brainstorming, test-driven development, systematic debugging, writing and executing plans, verification before completion, git worktrees. |
| `frontend-design@claude-plugins-official` | Front-end design guidance. |
| `skill-creator@claude-plugins-official` | Writing and testing new skills. |
| `security-guidance@claude-plugins-official` | Security review guidance (also enabled per project in `.claude/settings.json`). |
| `claude-code-setup@claude-plugins-official` | Automation recommendations for a new setup. |
| `huggingface-skills@claude-plugins-official` | ML work: models, datasets, training. |
| `data-engineering@claude-plugins-official` | Data pipelines and Airflow work. |

## Cloudflare skills (only for projects on Cloudflare)

`agents-sdk`, `cloudflare`, `cloudflare-email-service`, `cloudflare-one`, `cloudflare-one-migrations`,
`durable-objects`, `sandbox-sdk`, `turnstile-spin`, `web-perf`, `workers-best-practices`, `wrangler`.

Source: https://github.com/cloudflare/skills - follow its README to install into `~/.claude/skills/`.
The kit lists these names in `kit.config.json` ("thirdPartySkills") so `fold-back user` does not report them
as the owner's new skills.
