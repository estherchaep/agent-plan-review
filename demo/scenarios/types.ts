import type { PlanStep, PlanValues } from "agent-plan-review";

/** One example conversation: what the user asks, and the plan the agent returns. */
export type Scenario = {
  id: string;
  name: string;
  prompt: string;
  intro: string;
  steps: PlanStep[];
  initialValues: PlanValues;
  confirmAllLabel: string;
  /** What the agent says once every step is confirmed */
  done: (values: PlanValues) => string;
};
