import type { Report } from "./report.js";
import { pct } from "./report.js";

export interface Style {
  color: boolean;
  width?: number;
}

const ESC = "\x1b[";
const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function paint(s: Style) {
  const wrap = (open: string, close: string) => (t: string) => (s.color ? `${ESC}${open}m${t}${ESC}${close}m` : t);
  return {
    bold: wrap("1", "22"),
    dim: wrap("2", "22"),
    hex: (hex: string) => (t: string) => {
      if (!s.color) return t;
      const [r, g, b] = hexToRgb(hex);
      return `${ESC}38;2;${r};${g};${b}m${t}${ESC}39m`;
    },
  };
}

export const fmt = (n: number) => n.toLocaleString("en-US");
const SPARK = "▁▂▃▄▅▆▇█";

export function lastMonths(report: Report, n = 12): { month: string; share: number; commits: number }[] {
  const by = new Map(report.timeline.map((b) => [b.month, b]));
  const last = report.timeline.at(-1)?.month;
  if (!last) return [];
  let [y, m] = last.split("-").map(Number);
  const out: { month: string; share: number; commits: number }[] = [];
  for (let i = 0; i < n; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const b = by.get(key);
    out.unshift({ month: key, share: b && b.commits ? b.aiCommits / b.commits : 0, commits: b?.commits ?? 0 });
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
  }
  return out;
}

export function sparkline(values: number[]): string {
  return values.map((v) => (v <= 0 ? "·" : SPARK[Math.min(SPARK.length - 1, Math.floor(v * SPARK.length))])).join("");
}

function bar(fraction: number, width: number): string {
  const cells = fraction * width;
  const full = Math.floor(cells);
  const parts = "▏▎▍▌▋▊▉";
  const rem = cells - full;
  const tail = rem > 0.0625 && full < width ? parts[Math.min(parts.length - 1, Math.floor(rem * 8))] : "";
  return "█".repeat(full) + tail;
}

const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

export function renderTerminal(r: Report, s: Style): string {
  const p = paint(s);
  const L: string[] = [];
  const t = r.totals;
  const basis = r.headline.basis === "surviving-lines" ? "of the code at HEAD was written with AI" : "of all added lines were written with AI";
  L.push("");
  L.push(`  ${p.bold("aiblame")} ${p.dim("·")} ${r.repo} ${p.dim(`@ ${r.rev}`)}`);
  L.push("");
  L.push(`  ${p.bold(p.hex("#f5a524")(`${r.headline.percent}%`))} ${basis}`);
  L.push(
    p.dim(
      `  ${fmt(t.aiCommits)} of ${fmt(t.commits)} commits (${pct(t.aiCommits, t.commits)}%) were AI-assisted · ${fmt(t.automationCommits)} by plain bots`,
    ),
  );
  L.push("");
  if (r.agents.length === 0) {
    L.push(`  ${p.dim("No AI agent signatures found. Either humans wrote it all, or the agents didn't sign.")}`);
  } else {
    const useHead = r.headline.basis === "surviving-lines";
    const total = useHead ? t.linesAtHead ?? 0 : t.linesAdded;
    const nameW = Math.max(...r.agents.map((a) => a.name.length));
    L.push(p.dim(`  ${"agent".padEnd(nameW)}  ${"share".padEnd(24)}  ${"lines".padStart(9)}  ${"commits".padStart(7)}  active`));
    for (const a of r.agents) {
      const lines = useHead ? a.linesSurviving ?? 0 : a.linesAdded;
      const f = total ? lines / total : 0;
      L.push(
        `  ${p.hex(a.color)(a.name.padEnd(nameW))}  ${p.hex(a.color)(bar(f, 20).padEnd(20))} ${String(pct(lines, total)).padStart(4)}%  ${fmt(lines).padStart(9)}  ${fmt(a.commits).padStart(7)}  ${p.dim(`${date(a.firstSeen)} → ${date(a.lastSeen)}`)}`,
      );
    }
  }
  const months = lastMonths(r);
  if (months.length && r.totals.aiCommits > 0) {
    L.push("");
    L.push(`  ${p.dim("AI share of commits, last 12 months")}  ${p.hex("#f5a524")(sparkline(months.map((m) => m.share)))}  ${p.dim(`${months[0].month} → ${months.at(-1)!.month}`)}`);
  }
  if (r.topFiles.length) {
    L.push("");
    L.push(`  ${p.dim("Most AI-written files")}`);
    for (const f of r.topFiles) L.push(`  ${String(pct(f.aiLines, f.lines)).padStart(5)}%  ${f.path} ${p.dim(`(${fmt(f.aiLines)}/${fmt(f.lines)} lines)`)}`);
  }
  if (r.pilots.length) {
    L.push("");
    L.push(`  ${p.dim("Top pilots")}  ${r.pilots.map((x) => `${x.name} ${p.dim(`(${x.commits})`)}`).join(p.dim(" · "))}`);
  }
  if (r.firstAiCommit) {
    L.push(`  ${p.dim("First AI commit")}  ${r.firstAiCommit.sha.slice(0, 8)} ${p.dim(`on ${date(r.firstAiCommit.time)}`)}`);
  }
  if (r.blame?.skipped) L.push(p.dim(`  note: blamed the ${fmt(r.blame.files)} largest files, skipped ${fmt(r.blame.skipped)} (raise with --max-files)`));
  L.push("");
  return L.join("\n");
}

export function renderMarkdown(r: Report): string {
  const t = r.totals;
  const useHead = r.headline.basis === "surviving-lines";
  const total = useHead ? t.linesAtHead ?? 0 : t.linesAdded;
  const out = [
    `## aiblame report: \`${r.repo}\``,
    "",
    `**${r.headline.percent}%** ${useHead ? "of the code at HEAD" : "of all added lines"} was written in AI-assisted commits. ${t.aiCommits} of ${t.commits} commits (${pct(t.aiCommits, t.commits)}%) carry an AI agent signature.`,
    "",
  ];
  if (r.agents.length) {
    out.push("| Agent | Share | Lines | Commits | Active |", "|---|---:|---:|---:|---|");
    for (const a of r.agents) {
      const lines = useHead ? a.linesSurviving ?? 0 : a.linesAdded;
      out.push(`| ${a.name} | ${pct(lines, total)}% | ${fmt(lines)} | ${fmt(a.commits)} | ${date(a.firstSeen)} → ${date(a.lastSeen)} |`);
    }
    out.push("");
  }
  out.push(`<sub>Generated by [aiblame](https://github.com/celaldrg/aiblame) at ${r.generatedAt}. Counts only agents that sign their commits.</sub>`, "");
  return out.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Approximate text width for Verdana 11px (shields.io style). */
function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ilI.,:;|!'1]/.test(ch) ? 3.5 : /[mwMW%@]/.test(ch) ? 10 : /[A-Z0-9]/.test(ch) ? 7.5 : 6.5;
  return Math.ceil(w);
}

export function badgeColor(percent: number): string {
  if (percent >= 75) return "#8b5cf6";
  if (percent >= 50) return "#d97757";
  if (percent >= 25) return "#f5a524";
  if (percent > 0) return "#4c9a2a";
  return "#9f9f9f";
}

export function renderBadge(r: Report, label = "AI-written"): string {
  const value = `${r.headline.percent}%`;
  const lw = textWidth(label) + 12;
  const vw = textWidth(value) + 12;
  const w = lw + vw;
  const color = badgeColor(r.headline.percent);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(label)}: ${value}">
<title>${esc(label)}: ${value}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(label)}</text><text x="${lw / 2}" y="14">${esc(label)}</text>
<text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text><text x="${lw + vw / 2}" y="14">${value}</text>
</g></svg>
`;
}

/** A shareable report card (dark, 640px wide). */
export function renderCard(r: Report): string {
  const W = 640;
  const useHead = r.headline.basis === "surviving-lines";
  const total = useHead ? r.totals.linesAtHead ?? 0 : r.totals.linesAdded;
  const agents = r.agents.slice(0, 6);
  const rows = agents.length || 1;
  const months = lastMonths(r);
  const H = 214 + rows * 30 + (months.length ? 86 : 0);
  const font = `font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"`;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="aiblame: ${r.headline.percent}% AI-written">`);
  parts.push(`<rect width="${W}" height="${H}" rx="14" fill="#0d1117"/><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="#30363d"/>`);
  parts.push(`<circle cx="28" cy="26" r="6" fill="#ff5f57"/><circle cx="48" cy="26" r="6" fill="#febc2e"/><circle cx="68" cy="26" r="6" fill="#28c840"/>`);
  parts.push(`<text x="${W - 24}" y="31" text-anchor="end" ${font} font-size="13" fill="#8b949e">${esc(r.repo)}</text>`);
  parts.push(`<text x="28" y="104" ${font} font-size="56" font-weight="700" fill="#f5a524">${r.headline.percent}%</text>`);
  parts.push(`<text x="28" y="132" ${font} font-size="15" fill="#e6edf3">${useHead ? "of the code at HEAD was written with AI" : "of all added lines were written with AI"}</text>`);
  parts.push(`<text x="28" y="156" ${font} font-size="13" fill="#8b949e">${fmt(r.totals.aiCommits)} of ${fmt(r.totals.commits)} commits AI-assisted · ${r.agents.length} agent${r.agents.length === 1 ? "" : "s"} detected</text>`);
  let y = 196;
  if (!agents.length) {
    parts.push(`<text x="28" y="${y}" ${font} font-size="13" fill="#8b949e">No AI agent signatures found.</text>`);
  }
  for (const a of agents) {
    const lines = useHead ? a.linesSurviving ?? 0 : a.linesAdded;
    const f = total ? lines / total : 0;
    const bw = Math.max(f > 0 ? 3 : 0, Math.round(f * 300));
    parts.push(`<text x="28" y="${y}" ${font} font-size="14" fill="${a.color}">${esc(a.name)}</text>`);
    parts.push(`<rect x="200" y="${y - 12}" width="300" height="14" rx="3" fill="#161b22"/><rect x="200" y="${y - 12}" width="${bw}" height="14" rx="3" fill="${a.color}"/>`);
    parts.push(`<text x="${W - 24}" y="${y}" text-anchor="end" ${font} font-size="14" fill="#e6edf3">${pct(lines, total)}%</text>`);
    y += 30;
  }
  if (months.length) {
    y += 8;
    parts.push(`<text x="28" y="${y}" ${font} font-size="12" fill="#8b949e">AI share of commits · ${months[0].month} → ${months.at(-1)!.month}</text>`);
    const bw = (W - 56) / months.length;
    months.forEach((m, i) => {
      const h = Math.max(2, Math.round(m.share * 36));
      parts.push(`<rect x="${(28 + i * bw + 2).toFixed(1)}" y="${y + 46 - h}" width="${(bw - 4).toFixed(1)}" height="${h}" rx="2" fill="${m.share > 0 ? "#f5a524" : "#30363d"}"/>`);
    });
    y += 54;
  }
  parts.push(`<text x="28" y="${H - 18}" ${font} font-size="11" fill="#6e7681">npx github:celaldrg/aiblame</text>`);
  parts.push(`<text x="${W - 24}" y="${H - 18}" text-anchor="end" ${font} font-size="11" fill="#6e7681">${r.generatedAt.slice(0, 10)}</text>`);
  parts.push(`</svg>\n`);
  return parts.join("\n");
}
