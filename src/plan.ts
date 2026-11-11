import type { PlanField, PlanStep, PlanValue, PlanValues, SelectOption, StepStatus } from "./types.js";

// Pure helpers: defaults, validation, summaries and the context handed back to the agent.

export const optionValue = (o: SelectOption) => (typeof o === "string" ? o : o.value);
export const optionLabel = (o: SelectOption) => (typeof o === "string" ? o : (o.label ?? o.value));

export function defaultValueFor(field: PlanField): PlanValue | undefined {
  if (field.defaultValue !== undefined) return field.defaultValue;
  switch (field.kind) {
    case "select":
      return field.options.length ? optionValue(field.options[0]) : "";
    case "number":
      return field.min ?? 0;
    case "toggle":
      return false;
    case "custom":
      return undefined;
    default:
      return "";
  }
}

/** Fill in a value for every field that has none yet. */
export function withDefaults(steps: PlanStep[], values: PlanValues): PlanValues {
  let out: PlanValues | null = null;
  for (const s of steps) {
    for (const f of s.fields ?? []) {
      if (f.key in values || (out && f.key in out)) continue;
      const d = defaultValueFor(f);
      if (d === undefined) continue;
      out ??= { ...values };
      out[f.key] = d;
    }
  }
  return out ?? values;
}

const isEmpty = (v: PlanValue | undefined) => v === undefined || v === "";

export function fieldProblem(field: PlanField, value: PlanValue | undefined): string | null {
  if (field.required && isEmpty(value)) return `**${field.label}** is required.`;
  if (isEmpty(value)) return null;
  if (field.kind === "number") {
    const n = Number(value);
    if (Number.isNaN(n)) return `**${field.label}** must be a number.`;
    const unit = field.unit ? ` ${field.unit}` : "";
    if (field.min !== undefined && n < field.min) return `**${field.label}** must be at least ${field.min}${unit}.`;
    if (field.max !== undefined && n > field.max) return `**${field.label}** must be at most ${field.max}${unit}.`;
  }
  if (field.kind === "text" && field.pattern && !new RegExp(field.pattern).test(String(value))) {
    return field.patternMessage ?? `**${field.label}** isn't in the expected format.`;
  }
  return null;
}

/** The first problem that blocks confirming the step, or null. */
export function stepProblem(step: PlanStep, values: PlanValues): string | null {
  for (const f of step.fields ?? []) {
    const p = fieldProblem(f, values[f.key]);
    if (p) return p;
  }
  return step.validate?.(values) ?? null;
}

function displayValue(step: PlanStep, key: string, values: PlanValues): string {
  const v = values[key];
  const field = step.fields?.find((f) => f.key === key);
  if (field?.kind === "select") {
    const o = field.options.find((x) => optionValue(x) === v);
    if (o) return optionLabel(o);
  }
  if (field?.kind === "toggle") return v ? "on" : "off";
  if (field?.kind === "number" && field.unit && !isEmpty(v)) return `${v} ${field.unit}`;
  return v === undefined ? "" : String(v);
}

/** The one-line summary shown when the step is confirmed. */
export function stepSummary(step: PlanStep, values: PlanValues): string {
  if (typeof step.summary === "function") return step.summary(values);
  if (typeof step.summary === "string") {
    return step.summary.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_, key: string) => displayValue(step, key, values));
  }
  const parts = (step.fields ?? [])
    .filter((f) => f.kind !== "custom" && !isEmpty(values[f.key]))
    .map((f) => `${f.label}: ${displayValue(step, f.key, values)}`);
  return parts.length ? parts.join(" · ") : step.intent;
}

export type StepContext = {
  id: string;
  label: string;
  status: StepStatus;
  summary: string;
  values: PlanValues;
};

/**
 * The reviewed plan as plain JSON, to send back to the agent: each step's
 * status, a readable summary, and the values the user chose for it.
 */
export function planContext(
  steps: PlanStep[],
  values: PlanValues,
  statusOf: (index: number) => StepStatus,
): { steps: StepContext[]; values: PlanValues } {
  return {
    steps: steps.map((s, i) => {
      const own: PlanValues = {};
      for (const f of s.fields ?? []) if (values[f.key] !== undefined) own[f.key] = values[f.key];
      return { id: s.id, label: s.label, status: statusOf(i), summary: stepSummary(s, values), values: own };
    }),
    values,
  };
}

/** The reviewed plan as a short numbered list, ready to drop into a prompt. */
export function describePlan(steps: PlanStep[], values: PlanValues, statusOf: (index: number) => StepStatus): string {
  const mark: Record<StepStatus, string> = { done: "confirmed", active: "in review", upcoming: "not reviewed" };
  return steps.map((s, i) => `${i + 1}. ${s.label} [${mark[statusOf(i)]}] — ${stepSummary(s, values)}`).join("\n");
}
