import { Fragment, useEffect, useId, useRef, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { optionLabel, optionValue, stepSummary } from "./plan.js";
import type { PlanReviewState } from "./usePlanReview.js";
import type { PlanField, PlanStep, PlanValue, PlanValues, StepStatus } from "./types.js";

// The agent's plan as a sequence of confirmation steps: the active step is an
// editable card, confirmed steps collapse to a one-line summary with Edit, and
// upcoming steps stay dimmed until the review reaches them.

const EASE = [0.42, 0, 0.58, 1] as const;

export type PlanReviewLabels = {
  confirm: string;
  confirmContinue: string;
  askChange: string;
  edit: string;
  revising: string;
  why: string;
};

const DEFAULT_LABELS: PlanReviewLabels = {
  confirm: "Confirm",
  confirmContinue: "Confirm & continue",
  askChange: "Ask to change",
  edit: "Edit",
  revising: "Revising this step…",
  why: "Why",
};

/** Renders `code` and **bold** — enough for agent-written messages. */
export function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") && p.length > 1 ? (
          <code key={i} className="apr-code">{p.slice(1, -1)}</code>
        ) : p.startsWith("**") && p.endsWith("**") && p.length > 3 ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function Chevron() {
  return (
    <svg aria-hidden className="apr-chevron" width="10" height="6" viewBox="0 0 10 6" fill="none">
      <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FieldControl({
  field,
  id,
  value,
  values,
  step,
  setValue,
  setValues,
}: {
  field: PlanField;
  id: string;
  value: PlanValue | undefined;
  values: PlanValues;
  step: PlanStep;
  setValue: (v: PlanValue) => void;
  setValues: (patch: PlanValues) => void;
}) {
  switch (field.kind) {
    case "select":
      return (
        <div className="apr-select">
          <select id={id} className="apr-input" value={String(value ?? "")} disabled={field.disabled} onChange={(e) => setValue(e.target.value)}>
            {field.options.map((o) => (
              <option key={optionValue(o)} value={optionValue(o)}>
                {optionLabel(o)}
              </option>
            ))}
          </select>
          <Chevron />
        </div>
      );
    case "number":
      return (
        <div className="apr-number">
          <input
            id={id}
            type="number"
            className="apr-input"
            value={value === undefined ? "" : String(value)}
            min={field.min}
            max={field.max}
            step={field.step}
            disabled={field.disabled}
            onChange={(e) => setValue(e.target.value === "" ? "" : Number(e.target.value))}
          />
          {field.unit && <span className="apr-unit">{field.unit}</span>}
        </div>
      );
    case "textarea":
      return (
        <textarea
          id={id}
          className="apr-input apr-textarea"
          rows={field.rows ?? 3}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          disabled={field.disabled}
          onChange={(e) => setValue(e.target.value)}
        />
      );
    case "toggle":
      return (
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={Boolean(value)}
          className="apr-switch"
          disabled={field.disabled}
          onClick={() => setValue(!value)}
        >
          <motion.span className="apr-switch-thumb" layout transition={{ duration: 0.18, ease: EASE }} />
        </button>
      );
    case "custom":
      return <>{field.render({ value, values, setValue, setValues, step, id })}</>;
    default:
      return (
        <input
          id={id}
          className={`apr-input${field.monospace ? " apr-mono" : ""}`}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          disabled={field.disabled}
          onChange={(e) => setValue(field.transform ? field.transform(e.target.value) : e.target.value)}
        />
      );
  }
}

function StepMarker({ status, n }: { status: StepStatus; n: number }) {
  if (status === "done") {
    return (
      <motion.svg
        key="done"
        className="apr-marker apr-marker-done"
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        initial={{ scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 26 }}
        aria-hidden
      >
        <circle cx="9" cy="9" r="9" fill="currentColor" />
        <motion.path
          d="M5.2 9.2l2.6 2.6 5-5.4"
          stroke="white"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.25, delay: 0.05, ease: EASE }}
        />
      </motion.svg>
    );
  }
  return (
    <span className={`apr-marker apr-marker-${status}`} aria-hidden>
      {n}
    </span>
  );
}

export type PlanReviewProps = {
  /** State from `usePlanReview` */
  review: PlanReviewState;
  /** Summaries only — e.g. once the agent has run the plan */
  readOnly?: boolean;
  /** Shows "Ask to change" on the active card. Send the request to your agent. */
  onAskChange?: (step: PlanStep, values: PlanValues) => void;
  /** Scroll the active step into view as the review advances (default true) */
  autoScroll?: boolean;
  /** Seconds between steps as the plan first appears (default 0.07) */
  stagger?: number;
  labels?: Partial<PlanReviewLabels>;
  theme?: "light" | "dark" | "auto";
  className?: string;
};

export default function PlanReview({
  review,
  readOnly = false,
  onAskChange,
  autoScroll = true,
  stagger = 0.07,
  labels: labelOverrides,
  theme = "auto",
  className,
}: PlanReviewProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const uid = useId();
  const { steps, values, activeIndex, problem } = review;

  // Stagger the steps in when the plan first arrives; steps streamed in later appear right away.
  const firstPaint = useRef(true);
  useEffect(() => {
    firstPaint.current = false;
  }, []);

  // Bring the step under review into view as the review advances.
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!autoScroll || readOnly || activeIndex === null) return;
    const t = window.setTimeout(() => activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 120);
    return () => window.clearTimeout(t);
  }, [activeIndex, autoScroll, readOnly]);

  return (
    <MotionConfig reducedMotion="user">
      <ol className={`apr-root${className ? ` ${className}` : ""}`} data-theme={theme === "auto" ? undefined : theme} aria-label="Plan">
        {steps.map((s, i) => {
          const raw = review.statusOf(i);
          const status: StepStatus = readOnly && raw === "active" ? "upcoming" : raw;
          const isLast = i === steps.length - 1;
          const summary = stepSummary(s, values);
          const setOne = (key: string, v: PlanValue) => review.setValue(key, v);
          return (
            <motion.li
              key={s.id}
              ref={status === "active" ? activeRef : undefined}
              className={`apr-step apr-step-${status}`}
              aria-current={status === "active" ? "step" : undefined}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, ease: EASE, delay: firstPaint.current ? i * stagger : 0 }}
            >
              {!isLast && (
                <span className="apr-rail" aria-hidden>
                  <motion.span
                    className="apr-rail-fill"
                    initial={false}
                    animate={{ scaleY: status === "done" ? 1 : 0 }}
                    transition={{ duration: 0.4, ease: EASE }}
                  />
                </span>
              )}
              <div className="apr-marker-slot">
                <StepMarker status={status} n={i + 1} />
              </div>

              <div className="apr-body">
                <div className="apr-head">
                  <p className="apr-label">{s.label}</p>
                  {status === "done" && !readOnly && (
                    <button type="button" className="apr-link" onClick={() => review.edit(s.id)} aria-label={`${labels.edit} ${s.label}`}>
                      {labels.edit}
                    </button>
                  )}
                </div>

                {status === "done" && (
                  <motion.p
                    key="summary"
                    className="apr-summary"
                    title={summary}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2, delay: 0.1 }}
                  >
                    {summary}
                  </motion.p>
                )}
                {status === "upcoming" && <p className="apr-intent-muted">{s.intent}</p>}

                <AnimatePresence initial={false}>
                  {status === "active" && (
                    <motion.div
                      key="card"
                      className="apr-card-clip"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.28, ease: EASE }}
                    >
                      <div className="apr-card">
                        <p className="apr-intent">{s.intent}</p>
                        {s.rationale && (
                          <p className="apr-rationale">
                            <span>{labels.why}</span> <InlineMarkdown text={s.rationale} />
                          </p>
                        )}

                        {s.pending ? (
                          <div className="apr-pending" role="status">
                            <span className="apr-shimmer" />
                            <span className="apr-shimmer apr-shimmer-short" />
                            <p>{labels.revising}</p>
                          </div>
                        ) : (
                          <>
                            {s.content &&
                              (typeof s.content === "function"
                                ? s.content({ step: s, values, setValue: setOne, setValues: review.setValues })
                                : s.content)}

                            {s.fields && s.fields.length > 0 && (
                              <div className="apr-fields">
                                {s.fields.map((f) => {
                                  const id = `${uid}-${s.id}-${f.key}`;
                                  return (
                                    <div key={f.key} className={`apr-field apr-field-${f.kind}`}>
                                      <label htmlFor={id} className="apr-field-label">
                                        {f.label}
                                      </label>
                                      <FieldControl
                                        field={f}
                                        id={id}
                                        value={values[f.key]}
                                        values={values}
                                        step={s}
                                        setValue={(v) => setOne(f.key, v)}
                                        setValues={review.setValues}
                                      />
                                      {f.help && <p className="apr-help">{f.help}</p>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}

                        <AnimatePresence initial={false}>
                          {problem && (
                            <motion.div
                              key="problem"
                              className="apr-problem"
                              role="alert"
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2, ease: EASE }}
                            >
                              <div className="apr-problem-inner">
                                <svg width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden>
                                  <path d="M6 .8l5.4 10H.6L6 .8z" fill="currentColor" />
                                  <path d="M6 4.6v2.6" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
                                  <circle cx="6" cy="8.9" r=".7" fill="white" />
                                </svg>
                                <span>
                                  <InlineMarkdown text={problem} />
                                </span>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <div className="apr-actions">
                          <button type="button" className="apr-button" onClick={review.confirm} disabled={!!problem || !!s.pending}>
                            {s.confirmLabel ?? (isLast && !review.streaming ? labels.confirm : labels.confirmContinue)}
                          </button>
                          {onAskChange && (
                            <button type="button" className="apr-link apr-link-strong" onClick={() => onAskChange(s, values)} disabled={!!s.pending}>
                              {labels.askChange}
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </MotionConfig>
  );
}

export type PlanProgressProps = {
  review: PlanReviewState;
  /** Defaults to `review.confirmAll` */
  onConfirmAll?: () => void;
  confirmAllLabel?: string;
  /** e.g. (n, total) => `Step ${n} of ${total}` */
  text?: (step: number, total: number) => ReactNode;
  theme?: "light" | "dark" | "auto";
  className?: string;
};

/** A bar for the composer area: "Reviewing plan · step 2 of 5" with Confirm all. Hidden once the review is complete. */
export function PlanProgress({
  review,
  onConfirmAll,
  confirmAllLabel = "Confirm all",
  text = (n, total) => `Reviewing plan · step ${n} of ${total}`,
  theme = "auto",
  className,
}: PlanProgressProps) {
  const total = review.steps.length;
  const show = total > 0 && review.activeIndex !== null;
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {show && (
          <motion.div
            key="progress"
            className={`apr-progress${className ? ` ${className}` : ""}`}
            data-theme={theme === "auto" ? undefined : theme}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <p aria-live="polite">{text((review.activeIndex ?? 0) + 1, total)}</p>
            <motion.span className="apr-progress-track" aria-hidden>
              <motion.span
                className="apr-progress-fill"
                initial={false}
                animate={{ scaleX: total ? review.confirmedCount / total : 0 }}
                transition={{ duration: 0.4, ease: EASE }}
              />
            </motion.span>
            <button type="button" className="apr-button apr-button-small" onClick={onConfirmAll ?? review.confirmAll}>
              {confirmAllLabel}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
