import { AGENTS, AUTOMATION } from "./agents.js";

export type Signal = "author" | "co-author" | "committer" | "message";

export interface Commit {
  sha: string;
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  /** Unix seconds (author date). */
  time: number;
  message: string;
  added: number;
  deleted: number;
  files: { path: string; added: number; deleted: number }[];
}

export type Kind = "ai" | "automation" | "human";

export interface Classification {
  kind: Kind;
  /** Agent ids, in the order they were found. Empty unless kind === "ai". */
  agents: string[];
  signals: Signal[];
  /** The human who drove the session (commit author), when an agent was a co-author. */
  pilot?: string;
}

const TRAILER = /^co-authored-by:\s*(.+)$/gim;

export function coAuthors(message: string): string[] {
  const out: string[] = [];
  for (const m of message.matchAll(TRAILER)) out.push(m[1].trim());
  return out;
}

export function matchAgent(identity: string): string | undefined {
  const id = identity.trim();
  for (const a of AGENTS) if (a.identity.some((r) => r.test(id))) return a.id;
  return undefined;
}

export function classify(c: Pick<Commit, "authorName" | "authorEmail" | "committerName" | "committerEmail" | "message">): Classification {
  const agents: string[] = [];
  const signals: Signal[] = [];
  const add = (id: string | undefined, s: Signal) => {
    if (!id) return;
    if (!agents.includes(id)) agents.push(id);
    if (!signals.includes(s)) signals.push(s);
  };

  const author = `${c.authorName} <${c.authorEmail}>`;
  const committer = `${c.committerName} <${c.committerEmail}>`;
  const authorAgent = matchAgent(author);
  add(authorAgent, "author");
  for (const co of coAuthors(c.message)) add(matchAgent(co), "co-author");
  add(matchAgent(committer), "committer");
  for (const a of AGENTS) if (a.message?.some((r) => r.test(c.message))) add(a.id, "message");

  if (agents.length) {
    return { kind: "ai", agents, signals, pilot: authorAgent ? undefined : c.authorName };
  }
  if (AUTOMATION.some((r) => r.test(author))) return { kind: "automation", agents, signals };
  return { kind: "human", agents, signals };
}
