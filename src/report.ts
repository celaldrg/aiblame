import { AGENT_BY_ID } from "./agents.js";
import { classify, type Classification, type Commit } from "./detect.js";

export interface AgentStats {
  id: string;
  name: string;
  color: string;
  commits: number;
  linesAdded: number;
  /** Lines still present at HEAD (only when blame ran). */
  linesSurviving?: number;
  firstSeen: number;
  lastSeen: number;
}

export interface MonthBucket {
  month: string; // YYYY-MM
  commits: number;
  aiCommits: number;
}

export interface Report {
  repo: string;
  rev: string;
  generatedAt: string;
  totals: {
    commits: number;
    aiCommits: number;
    automationCommits: number;
    humanCommits: number;
    linesAdded: number;
    aiLinesAdded: number;
    /** Present when blame ran. */
    linesAtHead?: number;
    aiLinesAtHead?: number;
  };
  /** Share of current code written in AI-assisted commits (blame), else share of added lines. */
  headline: { percent: number; basis: "surviving-lines" | "added-lines" };
  agents: AgentStats[];
  pilots: { name: string; commits: number }[];
  topFiles: { path: string; aiLines: number; lines: number }[];
  timeline: MonthBucket[];
  firstAiCommit?: { sha: string; time: number; agent: string };
  blame?: { files: number; skipped: number };
}

export interface BlameResult {
  perCommit: Map<string, number>;
  perFile: Map<string, Map<string, number>>;
  files: number;
  skipped: number;
}

const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);

function month(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function buildReport(repo: string, rev: string, commits: Commit[], blame?: BlameResult, now = new Date()): Report {
  const cls = new Map<string, Classification>();
  for (const c of commits) cls.set(c.sha, classify(c));

  const agents = new Map<string, AgentStats>();
  const pilots = new Map<string, number>();
  const months = new Map<string, MonthBucket>();
  const t = { commits: 0, aiCommits: 0, automationCommits: 0, humanCommits: 0, linesAdded: 0, aiLinesAdded: 0 };
  let firstAi: Report["firstAiCommit"];

  for (const c of commits) {
    const k = cls.get(c.sha)!;
    t.commits++;
    t.linesAdded += c.added;
    const m = month(c.time);
    const b = months.get(m) ?? { month: m, commits: 0, aiCommits: 0 };
    b.commits++;
    months.set(m, b);
    if (k.kind === "automation") t.automationCommits++;
    else if (k.kind === "human") t.humanCommits++;
    else {
      t.aiCommits++;
      t.aiLinesAdded += c.added;
      b.aiCommits++;
      if (k.pilot) pilots.set(k.pilot, (pilots.get(k.pilot) ?? 0) + 1);
      if (!firstAi || c.time < firstAi.time) firstAi = { sha: c.sha, time: c.time, agent: k.agents[0] };
      // a commit signed by several agents is credited to the first signature
      // (author, then the first co-author trailer) so shares add up to the headline
      for (const id of k.agents.slice(0, 1)) {
        const def = AGENT_BY_ID.get(id)!;
        const s = agents.get(id) ?? { id, name: def.name, color: def.color, commits: 0, linesAdded: 0, firstSeen: c.time, lastSeen: c.time };
        s.commits++;
        s.linesAdded += c.added;
        s.firstSeen = Math.min(s.firstSeen, c.time);
        s.lastSeen = Math.max(s.lastSeen, c.time);
        agents.set(id, s);
      }
    }
  }

  const totals: Report["totals"] = { ...t };
  let topFiles: Report["topFiles"] = [];
  let headline: Report["headline"] = { percent: pct(t.aiLinesAdded, t.linesAdded), basis: "added-lines" };

  if (blame) {
    let atHead = 0;
    let aiAtHead = 0;
    for (const s of agents.values()) s.linesSurviving = 0;
    for (const [sha, n] of blame.perCommit) {
      atHead += n;
      const k = cls.get(sha);
      if (k?.kind === "ai") {
        aiAtHead += n;
        agents.get(k.agents[0])!.linesSurviving! += n;
      }
    }
    totals.linesAtHead = atHead;
    totals.aiLinesAtHead = aiAtHead;
    headline = { percent: pct(aiAtHead, atHead), basis: "surviving-lines" };
    for (const [path, counts] of blame.perFile) {
      let lines = 0;
      let ai = 0;
      for (const [sha, n] of counts) {
        lines += n;
        if (cls.get(sha)?.kind === "ai") ai += n;
      }
      if (ai > 0) topFiles.push({ path, aiLines: ai, lines });
    }
    topFiles.sort((a, b) => b.aiLines - a.aiLines || a.path.localeCompare(b.path));
    topFiles = topFiles.slice(0, 5);
  }

  return {
    repo,
    rev,
    generatedAt: now.toISOString(),
    totals,
    headline,
    agents: [...agents.values()].sort((a, b) => (b.linesSurviving ?? b.linesAdded) - (a.linesSurviving ?? a.linesAdded) || b.commits - a.commits),
    pilots: [...pilots.entries()].map(([name, commits]) => ({ name, commits })).sort((a, b) => b.commits - a.commits).slice(0, 5),
    topFiles,
    timeline: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    firstAiCommit: firstAi,
    blame: blame ? { files: blame.files, skipped: blame.skipped } : undefined,
  };
}

export { pct };
