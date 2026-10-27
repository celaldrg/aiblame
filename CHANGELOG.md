# Changelog

## v0.1.0 (2026-10-27)

First release.

- `aiblame [path | owner/repo | url]`: AI share of the code at HEAD, using `git blame` over every text file
- 15 agents detected from self-declared signals: Claude Code, Cursor, GitHub Copilot, OpenAI Codex, Aider, Devin, Google Jules, Gemini, Amp, opencode, Factory Droid, Windsurf, JetBrains Junie, Lovable, v0
- Per-agent shares, 12-month sparkline, most AI-written files, top pilots, first AI commit
- Outputs: terminal, `--json`, `--markdown`, `--card` (SVG report card), `--badge` (SVG badge)
- `--fast`, `--since`, `--rev`, `--max-files`, `--fail-above` CI gate
- Skips lockfiles, vendored/generated code and `linguist-generated` / `linguist-vendored` paths
- Composite GitHub Action
- Zero runtime dependencies
