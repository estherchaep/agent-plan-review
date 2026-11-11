import type { ReactNode } from "react";

/** A single value the user (or the agent) can set on a plan step. */
export type PlanValue = string | number | boolean;

/** Every value in the plan, keyed by field key. Keys are shared across steps. */
export type PlanValues = Record<string, PlanValue>;

export type SelectOption = string | { value: string; label?: string };

type FieldBase = {
  /** Key in `PlanValues`. Two steps may share a key to edit the same value. */
  key: string;
  label: string;
  /** Short helper text under the control */
  help?: string;
  /** Blocks confirming the step while empty */
  required?: boolean;
  disabled?: boolean;
  /** Used when neither `initialValues` nor the agent supplies a value */
  defaultValue?: PlanValue;
};

export type FieldRenderContext = {
  value: PlanValue | undefined;
  values: PlanValues;
  setValue: (value: PlanValue) => void;
  setValues: (patch: PlanValues) => void;
  step: PlanStep;
  id: string;
};

export type PlanField =
  | (FieldBase & { kind: "select"; options: SelectOption[] })
  | (FieldBase & { kind: "number"; unit?: string; min?: number; max?: number; step?: number })
  | (FieldBase & {
      kind: "text";
      placeholder?: string;
      /** Regular expression (as a string, so plans stay JSON) the value must match */
      pattern?: string;
      patternMessage?: string;
      /** Normalise input as it is typed, e.g. slugify */
      transform?: (raw: string) => string;
      monospace?: boolean;
    })
  | (FieldBase & { kind: "textarea"; placeholder?: string; rows?: number })
  | (FieldBase & { kind: "toggle" })
  | (FieldBase & { kind: "custom"; render: (ctx: FieldRenderContext) => ReactNode });

export type StepRenderContext = {
  step: PlanStep;
  values: PlanValues;
  setValue: (key: string, value: PlanValue) => void;
  setValues: (patch: PlanValues) => void;
};

/**
 * One step of the agent's plan. Everything except `validate`, `transform`,
 * `render` and `content` is plain data, so an agent can return steps as JSON.
 */
export type PlanStep = {
  id: string;
  /** Short name shown on the rail, e.g. "Connect to sources" */
  label: string;
  /** What the agent will do in this step, in one sentence */
  intent: string;
  /** Why the agent chose this — extra context shown on the active card */
  rationale?: string;
  /** The decisions the user can review or change before confirming */
  fields?: PlanField[];
  /**
   * One line shown once the step is confirmed. A template such as
   * "{{joinType}} on {{key}}", or a function of the values.
   */
  summary?: string | ((values: PlanValues) => string);
  /** A problem that blocks confirming this step (supports `code` and **bold**) */
  validate?: (values: PlanValues) => string | null;
  /** Example change request, shown when the user asks to change this step */
  askHint?: string;
  /** Overrides the confirm button label */
  confirmLabel?: string;
  /** Extra content on the active card, above the fields */
  content?: ReactNode | ((ctx: StepRenderContext) => ReactNode);
  /** The agent is revising this step; the card shows a placeholder and can't be confirmed */
  pending?: boolean;
};

export type StepStatus = "upcoming" | "active" | "done";
