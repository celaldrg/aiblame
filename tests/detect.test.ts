import { describe, expect, it } from "vitest";
import { classify, coAuthors, matchAgent } from "../src/detect.js";

const base = { authorName: "Ada", authorEmail: "ada@example.com", committerName: "Ada", committerEmail: "ada@example.com", message: "fix bug" };

describe("matchAgent", () => {
  it.each([
    ["Claude <noreply@anthropic.com>", "claude"],
    ["Claude Opus 4.5 <noreply@anthropic.com>", "claude"],
    ["claude[bot] <209825114+claude[bot]@users.noreply.github.com>", "claude"],
    ["Cursor Agent <cursoragent@cursor.com>", "cursor"],
    ["cursor[bot] <206951365+cursor[bot]@users.noreply.github.com>", "cursor"],
    ["Copilot <198982749+Copilot@users.noreply.github.com>", "copilot"],
    ["copilot-swe-agent[bot] <198982749+Copilot@users.noreply.github.com>", "copilot"],
    ["chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>", "codex"],
    ["Paul Gauthier (aider) <paul@example.com>", "aider"],
    ["aider (anthropic/claude-sonnet-4) <noreply@aider.chat>", "aider"],
    ["devin-ai-integration[bot] <158243242+devin-ai-integration[bot]@users.noreply.github.com>", "devin"],
    ["google-labs-jules[bot] <161369871+google-labs-jules[bot]@users.noreply.github.com>", "jules"],
    ["Amp <amp@ampcode.com>", "amp"],
    ["opencode <noreply@opencode.ai>", "opencode"],
    ["factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>", "factory"],
    ["lovable-dev[bot] <lovable@example.com>", "lovable"],
  ])("%s → %s", (id, agent) => expect(matchAgent(id)).toBe(agent));

  it.each([
    "Claude Monet <claude@monet.fr>",
    "Devin Smith <devin@example.com>",
    "Jules Verne <jules@example.com>",
    "Sam Altman <sam@openai.com>",
    "Michael Truell <michael@cursor.com>",
    "Amparo Ruiz <amparo@example.com>",
    "dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>",
    "opencode <opencode@sst.dev>",
  ])("does not flag humans or plain bots: %s", (id) => expect(matchAgent(id)).toBeUndefined());
});

describe("coAuthors", () => {
  it("reads every trailer, any casing", () => {
    const msg = "feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nco-authored-by: Bob <bob@x.io>\n";
    expect(coAuthors(msg)).toEqual(["Claude <noreply@anthropic.com>", "Bob <bob@x.io>"]);
  });
});

describe("classify", () => {
  it("human by default", () => expect(classify(base)).toMatchObject({ kind: "human", agents: [] }));

  it("co-author trailer → ai, author becomes the pilot", () => {
    const c = classify({ ...base, message: "feat\n\nCo-Authored-By: Claude <noreply@anthropic.com>" });
    expect(c).toMatchObject({ kind: "ai", agents: ["claude"], signals: ["co-author"], pilot: "Ada" });
  });

  it("Generated with Claude Code footer", () => {
    const c = classify({ ...base, message: "feat\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)" });
    expect(c.agents).toEqual(["claude"]);
    expect(c.signals).toEqual(["message"]);
  });

  it("opencode's release bot is not the opencode agent", () => {
    const bot = { authorName: "opencode", authorEmail: "opencode@sst.dev", committerName: "opencode", committerEmail: "opencode@sst.dev", message: "release: v1.0.0" };
    expect(classify(bot).agents).toEqual([]);
    const agent = classify({ ...base, message: "feat\n\nCo-Authored-By: opencode <noreply@opencode.ai>" });
    expect(agent.agents).toEqual(["opencode"]);
  });

  it("bot author → ai without pilot", () => {
    const c = classify({ ...base, authorName: "copilot-swe-agent[bot]", authorEmail: "198982749+Copilot@users.noreply.github.com" });
    expect(c).toMatchObject({ kind: "ai", agents: ["copilot"], pilot: undefined });
  });

  it("aider message prefix", () => {
    expect(classify({ ...base, message: "aider: refactor parser" }).agents).toEqual(["aider"]);
  });

  it("multiple agents on one commit", () => {
    const c = classify({ ...base, message: "x\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>\nCo-Authored-By: Claude <noreply@anthropic.com>" });
    expect(c.agents).toEqual(["cursor", "claude"]);
  });

  it("dependabot is automation, not AI", () => {
    expect(classify({ ...base, authorName: "dependabot[bot]", authorEmail: "49699333+dependabot[bot]@users.noreply.github.com" }).kind).toBe("automation");
  });
});
