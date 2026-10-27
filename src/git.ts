import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Commit } from "./detect.js";

const RS = "\x1e";
const US = "\x1f";

/** Files whose churn says nothing about who wrote the code. */
export const IGNORED_FILES = [
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|flake\.lock|mix\.lock|pubspec\.lock|Podfile\.lock|packages\.lock\.json)$/,
  /(^|\/)(node_modules|vendor|vendored|third[_-]?party|external|dist|build|out|\.next|\.yarn|__snapshots__|_generated|generated|gen)\//i,
  /[._-](generated|gen|pb|g)\.[a-z0-9]+$/i,
  /\.min\.(js|css)$/,
  /\.(map|snap|lock|svg|csv|tsv)$/,
];

/** Files larger than this at HEAD are almost always generated or vendored. */
export const MAX_FILE_LINES = 20000;

export const isIgnored = (path: string) => IGNORED_FILES.some((r) => r.test(path));

export function git(cwd: string, args: string[], maxBuffer = 1024 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args[0]} failed: ${stderr.trim() || err.message}`));
      else resolve(stdout);
    });
  });
}

export function parseLog(raw: string): Commit[] {
  const commits: Commit[] = [];
  for (const rec of raw.split(RS)) {
    if (!rec.trim()) continue;
    const parts = rec.split(US);
    if (parts.length < 8) continue;
    const [sha, an, ae, cn, ce, at, message, stat] = parts;
    const files: Commit["files"] = [];
    let added = 0;
    let deleted = 0;
    for (const line of stat.split("\n")) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!m) continue;
      if (m[1] === "-") continue; // binary
      const path = renamedTarget(m[3]);
      if (isIgnored(path)) continue;
      const a = Number(m[1]);
      const d = Number(m[2]);
      files.push({ path, added: a, deleted: d });
      added += a;
      deleted += d;
    }
    commits.push({
      sha: sha.trim(),
      authorName: an,
      authorEmail: ae,
      committerName: cn,
      committerEmail: ce,
      time: Number(at),
      message: message.trim(),
      added,
      deleted,
      files,
    });
  }
  return commits;
}

/** numstat prints renames as "src/{a => b}/x.ts" or "a => b". Keep the new path. */
export function renamedTarget(p: string): string {
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(p);
  if (brace) return (brace[1] + brace[3] + brace[4]).replace(/\/\//g, "/").replace(/^\//, "");
  const plain = /^(.*) => (.*)$/.exec(p);
  return plain ? plain[2] : p;
}

export interface LogOptions {
  rev?: string;
  since?: string;
  merges?: boolean;
}

export async function readLog(cwd: string, opts: LogOptions = {}): Promise<Commit[]> {
  const args = ["-c", "core.quotepath=off", "log", `--format=${RS}%H${US}%an${US}%ae${US}%cn${US}%ce${US}%at${US}%B${US}`, "--numstat", "-M"];
  if (!opts.merges) args.push("--no-merges");
  if (opts.since) args.push(`--since=${opts.since}`);
  args.push(opts.rev ?? "HEAD");
  return parseLog(await git(cwd, args));
}

/** Count surviving lines per commit at `rev` using git blame. */
export async function blameLines(
  cwd: string,
  rev: string,
  opts: { maxFiles?: number; maxLines?: number; concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ perCommit: Map<string, number>; perFile: Map<string, Map<string, number>>; files: number; skipped: number }> {
  const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  const stat = await git(cwd, ["-c", "core.quotepath=off", "diff", "--numstat", "--no-renames", EMPTY_TREE, rev]);
  let files = stat
    .split("\n")
    .map((l) => /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m && m[1] !== "-" && m[1] !== "0")
    .map((m) => ({ path: m[3], lines: Number(m[1]) }))
    .filter((f) => !isIgnored(f.path) && f.lines <= (opts.maxLines ?? MAX_FILE_LINES));
  files = await dropLinguistExcluded(cwd, rev, files);
  const maxFiles = opts.maxFiles ?? 3000;
  let skipped = 0;
  if (files.length > maxFiles) {
    // keep the biggest files: they hold most of the code
    files.sort((a, b) => b.lines - a.lines);
    skipped = files.length - maxFiles;
    files = files.slice(0, maxFiles);
  }
  const perCommit = new Map<string, number>();
  const perFile = new Map<string, Map<string, number>>();
  const header = /^([0-9a-f]{40}) \d+ \d+ (\d+)$/;
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < files.length) {
      const f = files[next++];
      let out: string;
      try {
        out = await git(cwd, ["blame", "--porcelain", rev, "--", f.path]);
      } catch {
        done++;
        continue;
      }
      const counts = new Map<string, number>();
      for (const line of out.split("\n")) {
        const m = header.exec(line);
        if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + Number(m[2]));
      }
      perFile.set(f.path, counts);
      for (const [sha, n] of counts) perCommit.set(sha, (perCommit.get(sha) ?? 0) + n);
      opts.onProgress?.(++done, files.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 8) }, worker));
  return { perCommit, perFile, files: files.length, skipped };
}

/** Honour .gitattributes `linguist-generated` / `linguist-vendored`, like GitHub's language bar does. */
async function dropLinguistExcluded<T extends { path: string }>(cwd: string, rev: string, files: T[]): Promise<T[]> {
  if (!files.length) return files;
  const out = await new Promise<string>((resolve) => {
    const args = ["check-attr", "--stdin", "-z", "linguist-generated", "linguist-vendored"];
    // bare clones have no work tree: read attributes from the tree at `rev`
    const p = spawn("git", ["-c", "core.quotepath=off", ...args.slice(0, 1), `--source=${rev}`, ...args.slice(1)], { cwd });
    let buf = "";
    p.stdout.on("data", (d) => (buf += d));
    p.on("error", () => resolve(""));
    p.on("close", (code) => resolve(code === 0 ? buf : ""));
    p.stdin.on("error", () => {});
    p.stdin.end(files.map((f) => f.path).join("\0") + "\0");
  });
  const drop = new Set<string>();
  const parts = out.split("\0");
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const [path, , value] = [parts[i], parts[i + 1], parts[i + 2]];
    if (value === "set" || value === "true") drop.add(path);
  }
  return drop.size ? files.filter((f) => !drop.has(f.path)) : files;
}

const REMOTE = /^(https?:\/\/|git@|ssh:\/\/)/;
const SHORTHAND = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function remoteUrl(target: string): string | undefined {
  if (REMOTE.test(target)) return target;
  if (SHORTHAND.test(target) && !existsSync(target)) return `https://github.com/${target}.git`;
  return undefined;
}

/** Bare-clone a remote repository into a temp dir. Returns the dir and a cleanup function. */
export async function cloneRemote(url: string, onLine?: (s: string) => void): Promise<{ dir: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "aiblame-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  await new Promise<void>((resolve, reject) => {
    const p = spawn("git", ["clone", "--bare", "--quiet", "--single-branch", url, join(dir, "repo.git")], {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let err = "";
    p.stderr.on("data", (d) => {
      err += d;
      onLine?.(String(d));
    });
    p.on("close", (code) => (code === 0 ? resolve() : (cleanup(), reject(new Error(`git clone failed: ${err.trim()}`)))));
  });
  return { dir: join(dir, "repo.git"), cleanup };
}
