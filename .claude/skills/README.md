# Agent Skills

Project-scoped skills for AI coding agents (Claude Code and compatible),
available to every session that works in this repo.

Source: [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)
— vendored here so they apply automatically to this project. Each skill is
MIT-licensed (see the `license` field in its `SKILL.md`); attribution and
license are retained in each folder.

Installed:

- **react-best-practices** — React/Next performance rules
- **composition-patterns** — component composition patterns
- **react-view-transitions** — the View Transitions API
- **deploy-to-vercel** — deploying to Vercel
- **vercel-cli-with-tokens** — Vercel CLI with tokens
- **vercel-optimize** — audit a Vercel project for cost/performance
- **web-design-guidelines** — web design / UX / accessibility review
- **writing-guidelines** — writing guidance

To make these available across all your projects (not just this repo), install
them once on your own machine into `~/.claude/skills/`, or use the skills.sh
installer referenced in the source repo.
