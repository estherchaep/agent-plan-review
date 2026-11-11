import { stepSummary, type PlanField, type PlanStep, type PlanValues } from "agent-plan-review";

// A stand-in for a real agent. Given a free-text change request for one step,
// it returns new values and a note — the same shape you'd get back from an
// LLM tool call such as `revise_step({ stepId, values, note })`.

const STOP = new Set(["the", "and", "for", "with", "only", "into", "from", "this", "that", "your", "my", "a", "to", "of", "on", "in", "up"]);
const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
const has = (text: string, word: string) => new RegExp(`\\b${word}\\b`).test(text);
const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)`;
const toNum = (s: string) => Number(s.replace(/,/g, ""));

function matchSelect(field: Extract<PlanField, { kind: "select" }>, text: string) {
  const opts = field.options.map((o) => (typeof o === "string" ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value }));
  // Ignore words every option shares ("join" in "Inner join" / "Left outer join").
  const all = opts.map((o) => new Set([...words(o.label), ...words(o.value)]));
  const common = [...all[0]].filter((w) => all.every((s) => s.has(w)));
  let best: { value: string; score: number } | null = null;
  opts.forEach((o, i) => {
    const score = [...all[i]].filter((w) => !common.includes(w) && has(text, w)).length;
    if (score > 0 && (!best || score > best.score)) best = { value: o.value, score };
  });
  return (best as { value: string; score: number } | null)?.value;
}

function matchNumber(field: Extract<PlanField, { kind: "number" }>, text: string, onlyNumberField: boolean) {
  // Look for the number next to its unit or label: "4 nights", "€2,400", "under €150 a night".
  const keys = [field.unit, ...words(field.label)]
    .filter(Boolean)
    .flatMap((k) => [k!, k!.replace(/s$/, "")])
    .map((k) => k.toLowerCase().replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))
    .concat(field.unit?.includes("euro") ? ["€"] : []);
  for (const k of keys) {
    const m = text.match(new RegExp(`${NUM}\\s*${k}`)) ?? text.match(new RegExp(`${k}\\s*${NUM}`));
    if (m) return toNum(m[1]);
  }
  const lone = text.match(new RegExp(NUM));
  return onlyNumberField && lone ? toNum(lone[1]) : undefined;
}

function matchToggle(field: PlanField, text: string) {
  const subject = words(field.label).filter((w) => !["include", "also", "add", "only", "trip"].includes(w));
  if (!subject.some((w) => has(text, w))) return undefined;
  if (/\b(skip|no|without|don'?t|drop|remove|not)\b/.test(text)) return false;
  if (/\b(add|include|with|yes|keep|want)\b/.test(text)) return true;
  return undefined;
}

export function mockRevise(step: PlanStep, request: string, values: PlanValues): { patch: PlanValues; note: string } {
  const text = request.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const fields = step.fields ?? [];
  const numberFields = fields.filter((f) => f.kind === "number").length;
  const patch: PlanValues = {};
  for (const f of fields) {
    let v: string | number | boolean | undefined;
    if (f.kind === "select") v = matchSelect(f, text);
    else if (f.kind === "number") v = matchNumber(f, text, numberFields === 1);
    else if (f.kind === "toggle") v = matchToggle(f, text);
    else if (f.kind === "text") v = request.match(/(?:call it|name it|called)\s+([\w.-]+)/i)?.[1]?.toLowerCase();
    if (v !== undefined && v !== values[f.key]) patch[f.key] = v;
  }

  const changed = Object.keys(patch);
  const next = { ...values, ...patch };
  const show = (key: string) => {
    const f = fields.find((x) => x.key === key);
    const shown = stepSummary({ ...step, summary: `{{${key}}}` }, next);
    return `${f?.label} → **${f?.kind === "select" ? shown.split(" — ")[0] : shown}**`;
  };
  return {
    patch,
    note: changed.length
      ? `Updated “${step.label}”: ${changed.map(show).join(", ")}.`
      : `I couldn't match that to a setting on “${step.label}”, so I left it as is. Try naming a value, e.g. “${step.askHint}”.`,
  };
}
