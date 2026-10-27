import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blameLines, parseLog, readLog, renamedTarget } from "../src/git.js";
import { buildReport } from "../src/report.js";
import { renderBadge, renderCard, renderMarkdown, renderTerminal, sparkline } from "../src/render.js";

let dir: string;
const g = (args: string[], env: Record<string, string> = {}) =>
  execFileSync("git", args, { cwd: dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: dir, ...env }, encoding: "utf8" });

function commit(file: string, lines: number, who: { name: string; email: string }, message: string, date: string) {
  mkdirSync(join(dir, file, ".."), { recursive: true });
  writeFileSync(join(dir, file), Array.from({ length: lines }, (_, i) => `line ${i} of ${file}`).join("\n") + "\n");
  g(["add", "-A"]);
  g(["commit", "-q", "-m", message], {
    GIT_AUTHOR_NAME: who.name,
    GIT_AUTHOR_EMAIL: who.email,
    GIT_COMMITTER_NAME: who.name,
    GIT_COMMITTER_EMAIL: who.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
}

const ada = { name: "Ada", email: "ada@example.com" };

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aiblame-test-"));
  g(["init", "-q", "-b", "main"]);
  commit("README.md", 10, ada, "init", "2025-01-10T10:00:00Z");
  commit("src/app.ts", 60, ada, "feat: app\n\nCo-Authored-By: Claude <noreply@anthropic.com>", "2025-02-10T10:00:00Z");
  commit("src/ui.ts", 20, { name: "copilot-swe-agent[bot]", email: "198982749+Copilot@users.noreply.github.com" }, "feat: ui", "2025-03-10T10:00:00Z");
  commit("package-lock.json", 500, { name: "dependabot[bot]", email: "49699333+dependabot[bot]@users.noreply.github.com" }, "chore: bump", "2025-03-11T10:00:00Z");
  commit("src/human.ts", 10, ada, "handwritten", "2025-04-10T10:00:00Z");
});

describe("multi-agent commits", () => {
  it("credit the first signature so shares add up to the headline", () => {
    const base = { authorName: "Ada", authorEmail: "a@x", committerName: "Ada", committerEmail: "a@x", time: 1_700_000_000, files: [] };
    const r = buildReport("x", "HEAD", [
      { ...base, sha: "a".repeat(40), added: 10, deleted: 0, message: "x\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\nCo-Authored-By: Claude <noreply@anthropic.com>" },
      { ...base, sha: "b".repeat(40), added: 10, deleted: 0, message: "y" },
    ]);
    expect(r.agents.map((a) => [a.id, a.linesAdded])).toEqual([["cursor", 10]]);
    expect(r.headline.percent).toBe(50);
  });
});

describe("generated code", () => {
  it("skips linguist-generated files and *.gen.* in blame", async () => {
    const d2 = mkdtempSync(join(tmpdir(), "aiblame-gen-"));
    const run = (args: string[]) => execFileSync("git", args, { cwd: d2, env: { ...process.env, GIT_AUTHOR_NAME: "A", GIT_AUTHOR_EMAIL: "a@x", GIT_COMMITTER_NAME: "A", GIT_COMMITTER_EMAIL: "a@x" } });
    run(["init", "-q"]);
    writeFileSync(join(d2, ".gitattributes"), "schema.ts linguist-generated\n");
    writeFileSync(join(d2, "schema.ts"), "a\nb\n");
    writeFileSync(join(d2, "api.gen.ts"), "a\nb\n");
    writeFileSync(join(d2, "main.ts"), "a\n");
    run(["add", "-A"]);
    run(["commit", "-qm", "x"]);
    const b = await blameLines(d2, "HEAD");
    expect([...b.perFile.keys()].sort()).toEqual([".gitattributes", "main.ts"]);
    rmSync(d2, { recursive: true, force: true });
  });
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("readLog", () => {
  it("parses commits with numstat and ignores lockfiles", async () => {
    const commits = await readLog(dir);
    expect(commits).toHaveLength(5);
    const bump = commits.find((c) => c.message === "chore: bump")!;
    expect(bump.added).toBe(0); // package-lock.json is ignored
    const app = commits.find((c) => c.message.startsWith("feat: app"))!;
    expect(app.added).toBe(60);
    expect(app.files[0].path).toBe("src/app.ts");
  });

  it("respects --since", async () => {
    expect(await readLog(dir, { since: "2025-03-01" })).toHaveLength(3);
  });
});

describe("report", () => {
  it("computes headline from blame and per-agent stats", async () => {
    const commits = await readLog(dir);
    const blame = await blameLines(dir, "HEAD");
    const r = buildReport("demo", "HEAD", commits, blame, new Date("2025-05-01T00:00:00Z"));
    expect(r.totals).toMatchObject({ commits: 5, aiCommits: 2, automationCommits: 1, humanCommits: 2, linesAtHead: 100, aiLinesAtHead: 80 });
    expect(r.headline).toEqual({ percent: 80, basis: "surviving-lines" });
    expect(r.agents.map((a) => [a.id, a.linesSurviving])).toEqual([
      ["claude", 60],
      ["copilot", 20],
    ]);
    expect(r.pilots).toEqual([{ name: "Ada", commits: 1 }]);
    expect(r.topFiles[0]).toEqual({ path: "src/app.ts", aiLines: 60, lines: 60 });
    expect(r.firstAiCommit?.agent).toBe("claude");
    expect(r.timeline.map((m) => m.month)).toEqual(["2025-01", "2025-02", "2025-03", "2025-04"]);
  });

  it("falls back to added lines without blame", async () => {
    const r = buildReport("demo", "HEAD", await readLog(dir));
    expect(r.headline).toEqual({ percent: 80, basis: "added-lines" });
  });

  it("renders every output format", async () => {
    const r = buildReport("demo", "HEAD", await readLog(dir), await blameLines(dir, "HEAD"));
    const term = renderTerminal(r, { color: false });
    expect(term).toContain("80% of the code at HEAD was written with AI");
    expect(term).toContain("Claude Code");
    expect(term).not.toContain("\x1b[");
    expect(renderTerminal(r, { color: true })).toContain("\x1b[");
    expect(renderMarkdown(r)).toContain("| Claude Code | 60% |");
    const card = renderCard(r);
    expect(card.startsWith("<svg")).toBe(true);
    expect(card).toContain("80%");
    expect(renderBadge(r)).toContain("AI-written: 80%");
  });
});

describe("helpers", () => {
  it("renamedTarget", () => {
    expect(renamedTarget("src/{old => new}/a.ts")).toBe("src/new/a.ts");
    expect(renamedTarget("a.ts => b.ts")).toBe("b.ts");
    expect(renamedTarget("{lib => }/x.ts")).toBe("x.ts");
  });
  it("sparkline", () => expect(sparkline([0, 0.5, 1])).toBe("·▅█"));
  it("parseLog tolerates junk", () => expect(parseLog("garbage")).toEqual([]));
});
