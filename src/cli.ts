#!/usr/bin/env node
import { writeFileSync, readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { parseArgs } from "node:util";
import { blameLines, cloneRemote, git, readLog, remoteUrl } from "./git.js";
import { buildReport } from "./report.js";
import { renderBadge, renderCard, renderMarkdown, renderTerminal } from "./render.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string;

const HELP = `aiblame ${VERSION} — how much of this repo did AI write?

Usage
  aiblame [path | owner/repo | git-url] [options]

Examples
  aiblame                         # current repo
  aiblame vercel/next.js          # any public GitHub repo (bare clone to a temp dir)
  aiblame --card card.svg --badge badge.svg
  aiblame --json > report.json

Options
  --fast              skip git blame; report share of added lines instead of surviving lines
  --since <date>      only commits after a date ("2025-01-01", "6 months ago"); implies --fast
  --rev <rev>         branch, tag or commit to analyse (default: HEAD)
  --max-files <n>     blame at most n files, largest first (default: 3000)
  --json              print the full report as JSON
  --markdown          print a Markdown summary (great for PR comments / job summaries)
  --card <file.svg>   write a shareable SVG report card
  --badge <file.svg>  write a shields-style badge
  --badge-label <s>   badge label (default: "AI-written")
  --fail-above <pct>  exit 1 if the headline percentage is above pct (CI policy gate)
  --no-color          disable colors (also respects NO_COLOR)
  -v, --version
  -h, --help

aiblame only counts agents that sign their work (co-author trailers, bot accounts,
"Generated with" footers). It never guesses from code style.`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      fast: { type: "boolean", default: false },
      since: { type: "string" },
      rev: { type: "string", default: "HEAD" },
      "max-files": { type: "string", default: "3000" },
      json: { type: "boolean", default: false },
      markdown: { type: "boolean", default: false },
      card: { type: "string" },
      badge: { type: "string" },
      "badge-label": { type: "string", default: "AI-written" },
      "fail-above": { type: "string" },
      "no-color": { type: "boolean", default: false },
      version: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values.version) {
    console.log(VERSION);
    return 0;
  }

  const target = positionals[0] ?? ".";
  const tty = process.stderr.isTTY && !values.json && !values.markdown;
  const status = (msg: string) => {
    if (tty) process.stderr.write(`\r\x1b[2K  ${msg}`);
  };
  const clear = () => tty && process.stderr.write("\r\x1b[2K");

  let cwd = resolve(target);
  let name = target === "." ? basename(cwd) : target;
  let cleanup = () => {};
  const url = remoteUrl(target);
  if (url) {
    status(`cloning ${url} …`);
    const c = await cloneRemote(url);
    cwd = c.dir;
    cleanup = c.cleanup;
    name = url.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  } else {
    try {
      await git(cwd, ["rev-parse", "--git-dir"]);
    } catch {
      console.error(`aiblame: ${cwd} is not a git repository`);
      return 2;
    }
    const top = (await git(cwd, ["rev-parse", "--show-toplevel"]).catch(() => cwd)).trim();
    name = basename(top || cwd);
  }

  try {
    const rev = values.rev!;
    status("reading history …");
    const commits = await readLog(cwd, { rev, since: values.since });
    if (commits.length === 0) {
      clear();
      console.error("aiblame: no commits found");
      return 2;
    }
    const fast = values.fast || !!values.since;
    let blame;
    if (!fast) {
      blame = await blameLines(cwd, rev, {
        maxFiles: Number(values["max-files"]),
        onProgress: (d, total) => status(`blaming files ${d}/${total} …`),
      });
    }
    clear();
    const report = buildReport(name, rev, commits, blame);

    if (values.card) writeFileSync(values.card, renderCard(report));
    if (values.badge) writeFileSync(values.badge, renderBadge(report, values["badge-label"]));

    if (values.json) console.log(JSON.stringify(report, null, 2));
    else if (values.markdown) console.log(renderMarkdown(report));
    else {
      const color = !values["no-color"] && !process.env.NO_COLOR && process.stdout.isTTY === true;
      console.log(renderTerminal(report, { color: color || process.env.FORCE_COLOR === "1" }));
      if (values.card) console.log(`  card  → ${values.card}`);
      if (values.badge) console.log(`  badge → ${values.badge}`);
    }

    if (values["fail-above"] !== undefined && report.headline.percent > Number(values["fail-above"])) {
      console.error(`aiblame: ${report.headline.percent}% is above the --fail-above limit of ${values["fail-above"]}%`);
      return 1;
    }
    return 0;
  } finally {
    cleanup();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(`aiblame: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  },
);
