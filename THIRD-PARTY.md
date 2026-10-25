# Third-Party Plugins and Skills

These are other people's work. The kit installs them from their own sources, and also keeps a credited backup
copy in `vendor/`, so the methodology still works if a source is deleted, moved or down.

**Credit always.** Each copy keeps its LICENSE and a `SOURCE.json` (author, license, source, version, date
copied). [vendor/CREDITS.md](vendor/CREDITS.md) lists them all. A skill we build on top of one of them lives in
`user/skills/` under its own name, says which original it came from, and records what we changed (the Apache 2.0
license asks for that notice; MIT asks that the copyright line travels with the copy).

## Install from the source (normal case)

The marketplace `anthropics/claude-plugins-official` is known to Claude Code by default. In a Claude Code
terminal, run `/plugin` and install, or add each one under `enabledPlugins` in `~/.claude/settings.json`:

| Plugin | Made by | License | Why the owner uses it |
|---|---|---|---|
| `superpowers` | Jesse Vincent | MIT | Process skills: brainstorming, test-driven development, systematic debugging, writing and executing plans, verification before completion, git worktrees. |
| `frontend-design` | Anthropic | Apache-2.0 | Front-end design guidance. |
| `skill-creator` | Anthropic | Apache-2.0 | Writing and testing new skills. |
| `security-guidance` | David Dworken | Apache-2.0 | Security review guidance (also enabled per project in `.claude/settings.json`). |
| `claude-code-setup` | Anthropic | Apache-2.0 | Automation recommendations for a new setup. |
| `huggingface-skills` | Hugging Face | Apache-2.0 | ML work: models, datasets, training. |
| `data-engineering` | Astronomer | Apache-2.0 | Data pipelines and Airflow work. |

**Cloudflare skills** (only for projects on Cloudflare), by Cloudflare, Apache-2.0: `agents-sdk`, `cloudflare`,
`cloudflare-email-service`, `cloudflare-one`, `cloudflare-one-migrations`, `durable-objects`, `sandbox-sdk`,
`turnstile-spin`, `web-perf`, `workers-best-practices`, `wrangler`. Source: https://github.com/cloudflare/skills
(follow its README to install into `~/.claude/skills/`).

## If a source is lost: restore from the backup

```bash
node scripts/kit.mjs restore superpowers
```

```bash
node scripts/kit.mjs restore cloudflare-skills
```

This copies the skills back into `~/.claude/skills/` and never overwrites a skill folder that is already there.
A plugin comes back as plain skills; its hooks and commands stay in `vendor/plugins/<name>/` for reference.

## Keep the backup current

```bash
node scripts/kit.mjs snapshot
```

It copies what is installed on this machine now. Run it when a plugin updates, review the change, then commit and
push. The list of what to copy, and any credit written in by hand, is the `vendor` block in `kit.config.json`.
