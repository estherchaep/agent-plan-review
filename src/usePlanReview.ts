import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describePlan, planContext, stepProblem, withDefaults, type StepContext } from "./plan.js";
import type { PlanStep, PlanValue, PlanValues, StepStatus } from "./types.js";

export type PlanReviewOptions = {
  /** The agent's plan. May grow while `streaming` is true. */
  steps: PlanStep[];
  /** Values the agent proposed. Missing fields fall back to their defaults. */
  initialValues?: PlanValues;
  /** The agent is still sending steps; the review won't complete until it stops. */
  streaming?: boolean;
  /** A step was confirmed — a good moment to show its effect or tell the agent. */
  onStepConfirm?: (step: PlanStep, values: PlanValues) => void;
  /** Every step is confirmed. */
  onComplete?: (values: PlanValues) => void;
};

export type PlanReviewState = {
  steps: PlanStep[];
  values: PlanValues;
  /** Index of the step under review, or null when none is */
  activeIndex: number | null;
  activeStep: PlanStep | null;
  statusOf: (index: number) => StepStatus;
  confirmedCount: number;
  /** Every step is confirmed and the agent has finished sending steps */
  complete: boolean;
  streaming: boolean;
  /** The problem blocking the active step, if any */
  problem: string | null;
  setValue: (key: string, value: PlanValue) => void;
  /** Merge values — e.g. when the agent sends back more context */
  setValues: (patch: PlanValues) => void;
  /** Confirm the active step. Returns false if a problem blocks it. */
  confirm: () => boolean;
  /** Reopen a step (by id or index) for review */
  edit: (step: string | number) => void;
  /** Confirm every remaining step; stops at the first one with a problem. */
  confirmAll: () => boolean;
  reset: (values?: PlanValues) => void;
  /** The review as JSON for the agent */
  context: () => { steps: StepContext[]; values: PlanValues };
  /** The review as a numbered list for a prompt */
  describe: () => string;
};

export function usePlanReview({
  steps,
  initialValues,
  streaming = false,
  onStepConfirm,
  onComplete,
}: PlanReviewOptions): PlanReviewState {
  const [raw, setRaw] = useState<PlanValues>(() => initialValues ?? {});
  const values = useMemo(() => withDefaults(steps, raw), [steps, raw]);
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(() => new Set());
  const [focusId, setFocusId] = useState<string | null>(null);

  // The step in review: the one the user reopened, else the first unconfirmed one.
  const focused = focusId ? steps.findIndex((s) => s.id === focusId && !confirmed.has(s.id)) : -1;
  const firstOpen = steps.findIndex((s) => !confirmed.has(s.id));
  const activeIndex = focused >= 0 ? focused : firstOpen >= 0 ? firstOpen : null;
  const activeStep = activeIndex === null ? null : steps[activeIndex];
  const confirmedCount = steps.filter((s) => confirmed.has(s.id)).length;
  const complete = steps.length > 0 && confirmedCount === steps.length && !streaming;
  const problem = activeStep ? (activeStep.pending ? null : stepProblem(activeStep, values)) : null;

  const statusOf = useCallback(
    (i: number): StepStatus => (i === activeIndex ? "active" : steps[i] && confirmed.has(steps[i].id) ? "done" : "upcoming"),
    [activeIndex, steps, confirmed],
  );

  const cb = useRef({ onStepConfirm, onComplete });
  cb.current = { onStepConfirm, onComplete };

  const setValue = useCallback((key: string, value: PlanValue) => setRaw((v) => ({ ...v, [key]: value })), []);
  const setValues = useCallback((patch: PlanValues) => setRaw((v) => ({ ...v, ...patch })), []);

  const confirm = () => {
    if (!activeStep || activeStep.pending || problem) return false;
    setConfirmed((c) => new Set(c).add(activeStep.id));
    setFocusId(null);
    cb.current.onStepConfirm?.(activeStep, values);
    return true;
  };

  const edit = (target: string | number) => {
    const id = typeof target === "number" ? steps[target]?.id : target;
    if (!id) return;
    setConfirmed((c) => {
      const n = new Set(c);
      n.delete(id);
      return n;
    });
    setFocusId(id);
  };

  const confirmAll = () => {
    const open = steps.filter((s) => !confirmed.has(s.id));
    const blocked = open.find((s) => s.pending || stepProblem(s, values));
    const ok = blocked ? open.slice(0, open.indexOf(blocked)) : open;
    if (ok.length) {
      setConfirmed((c) => {
        const n = new Set(c);
        ok.forEach((s) => n.add(s.id));
        return n;
      });
      ok.forEach((s) => cb.current.onStepConfirm?.(s, values));
    }
    setFocusId(blocked ? blocked.id : null);
    return !blocked;
  };

  const reset = (next?: PlanValues) => {
    setRaw(next ?? initialValues ?? {});
    setConfirmed(new Set());
    setFocusId(null);
  };

  // Fire onComplete once per completion (it can re-fire after an Edit).
  const fired = useRef(false);
  useEffect(() => {
    if (complete && !fired.current) cb.current.onComplete?.(values);
    fired.current = complete;
  }, [complete, values]);

  return {
    steps,
    values,
    activeIndex,
    activeStep,
    statusOf,
    confirmedCount,
    complete,
    streaming,
    problem,
    setValue,
    setValues,
    confirm,
    edit,
    confirmAll,
    reset,
    context: () => planContext(steps, values, statusOf),
    describe: () => describePlan(steps, values, statusOf),
  };
}
