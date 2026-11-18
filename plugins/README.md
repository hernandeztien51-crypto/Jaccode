# Plugins

A plugin is a folder with a `plugin.json`. jaccode loads them from three places, in this order; a later plugin
with the same name replaces an earlier one:

1. `plugins/` in jaccode itself (bundled)
2. `~/.jaccode/plugins/` (yours, every project)
3. `<project>/.jaccode/plugins/` (this project only; commit it to share with your team)

Run `/plugins` to see what's loaded. To turn plugins on or off, add this to `.jaccode.json`:
`{ "plugins": { "enable": ["jac-format"], "disable": ["git"] } }`

## What a plugin can add

```json
{
  "name": "my-plugin",
  "description": "One line shown in /plugins",
  "enabled": true,
  "prompt": "prompt.md",
  "commands": {
    "deploy-check": {
      "description": "shown in /help",
      "prompt": "Check this project is ready to deploy: run the tests, then ... $ARGS"
    }
  },
  "tools": [
    {
      "name": "run_e2e",
      "description": "Run the end-to-end tests for one page",
      "parameters": { "type": "object", "properties": { "page": { "type": "string" } }, "required": ["page"] },
      "command": "npm run e2e -- {{page}}",
      "readOnly": false,
      "timeout": 300
    }
  ],
  "hooks": {
    "afterEdit": [{ "match": "*.py", "command": "ruff check --fix {{file}}", "timeout": 60 }]
  }
}
```

| Field | What it does |
|---|---|
| `prompt` | A Markdown file whose text is added to the system prompt. Use it for project rules, conventions and "when X, do Y" guidance. |
| `commands` | Slash commands. `/deploy-check staging` sends the `prompt` with `$ARGS` replaced by `staging`. Best for multi-step workflows you repeat. |
| `tools` | New tools the model can call. `parameters` is a JSON Schema, and arguments are validated against it before anything runs. `{{name}}` placeholders are filled with shell-quoted values, so arguments can't inject extra commands. `readOnly: true` tools never ask permission; the rest follow the normal rules. |
| `hooks.afterEdit` | Commands run after the agent writes or edits a matching file, such as a formatter or linter. `{{file}}` is the project-relative path. Output and failures are shown to the model, so it fixes what the linter finds. |

Tool names must be lowercase snake_case and can't reuse a built-in tool's name. A broken `plugin.json` is reported in
`/plugins` and skipped; it never stops jaccode from starting.

## Bundled plugins

| Plugin | Adds |
|---|---|
| `jac-guides` | Guidance on which official `jac guide` to read for which task. `/guide`, `/learn` |
| `jac-workflows` | A Jac quality bar. `/tdd`, `/port`, `/graph`, `/refactor`, `/explain`, `/fixall` |
| `git` | `/review` (finds bugs in uncommitted changes), `/commit` |
| `jac-docs` | Answers from docs.jaseci.org, with links. `/docs` |
| `jac-format` | Runs `jac fmt` after each `.jac` edit. Off by default, because it rewrites whole files. |
