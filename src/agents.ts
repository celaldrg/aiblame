/**
 * Registry of AI coding agents and the fingerprints they leave in git history.
 *
 * Every rule here is based on a *public, self-declared* signal: a commit trailer,
 * a bot account, or a message footer the tool writes on its own. aiblame never
 * guesses from code style. If an agent did not sign its work, it is counted as human.
 */
export interface AgentDef {
  id: string;
  name: string;
  /** ANSI 256 color used in the terminal report and SVG card. */
  color: string;
  /** Matched against author/committer "Name <email>" and every co-author trailer. */
  identity: RegExp[];
  /** Matched against the full commit message (footers such as "Generated with ..."). */
  message?: RegExp[];
}

export const AGENTS: AgentDef[] = [
  {
    id: "claude",
    name: "Claude Code",
    color: "#d97757",
    identity: [/noreply@anthropic\.com/i, /^claude\[bot\]/i, /^claude( code| (opus|sonnet|haiku)\b[^<]*)?\s*<[^>]*(anthropic|claude)/i],
    message: [/generated with \[?claude code\]?/i],
  },
  {
    id: "cursor",
    name: "Cursor",
    color: "#7c8cff",
    identity: [/cursoragent@cursor\.com/i, /^cursor\[bot\]/i, /^cursor agent\s*</i],
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    color: "#6cc644",
    identity: [/copilot-swe-agent/i, /\+copilot@users\.noreply\.github\.com/i, /^copilot(\[bot\])?\s*</i],
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    color: "#10a37f",
    identity: [/chatgpt-codex-connector/i, /^codex(\[bot\])?\s*</i],
  },
  {
    id: "aider",
    name: "Aider",
    color: "#14b8a6",
    identity: [/\(aider\)\s*</i, /noreply@aider\.chat/i],
    message: [/^aider: /m],
  },
  {
    id: "devin",
    name: "Devin",
    color: "#38bdf8",
    identity: [/devin-ai-integration/i, /^devin ai\s*</i],
  },
  {
    id: "jules",
    name: "Google Jules",
    color: "#a78bfa",
    identity: [/google-labs-jules/i],
  },
  {
    id: "gemini",
    name: "Gemini",
    color: "#4285f4",
    identity: [/gemini-code-assist/i, /^gemini( cli| code assist)?(\[bot\])?\s*</i],
  },
  {
    id: "amp",
    name: "Amp",
    color: "#f43f5e",
    identity: [/amp@ampcode\.com/i],
  },
  {
    id: "opencode",
    name: "opencode",
    color: "#eab308",
    identity: [/noreply@opencode\.ai/i, /^opencode(\[bot\])?\s*</i],
  },
  {
    id: "factory",
    name: "Factory Droid",
    color: "#f97316",
    identity: [/factory-droid/i],
  },
  {
    id: "windsurf",
    name: "Windsurf",
    color: "#22d3ee",
    identity: [/^(windsurf|cascade)(\[bot\])?\s*</i],
  },
  {
    id: "junie",
    name: "JetBrains Junie",
    color: "#ec4899",
    identity: [/^junie(\[bot\])?\s*<[^>]*jetbrains/i],
  },
  {
    id: "lovable",
    name: "Lovable",
    color: "#ff6b9d",
    identity: [/lovable-dev\[bot\]/i, /gpt-engineer-app\[bot\]/i],
  },
  {
    id: "v0",
    name: "v0",
    color: "#e5e7eb",
    identity: [/^v0\[bot\]/i],
  },
];

/** Plain automation: real bots, but not AI authorship. Reported separately, never counted as AI. */
export const AUTOMATION: RegExp[] = [
  /dependabot/i,
  /renovate/i,
  /github-actions/i,
  /pre-commit-ci/i,
  /greenkeeper/i,
  /snyk-bot/i,
  /semantic-release/i,
  /\[bot\]/i,
];

export const AGENT_BY_ID = new Map(AGENTS.map((a) => [a.id, a]));
