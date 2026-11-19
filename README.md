# agent-plan-review

A React component for reviewing an AI agent's plan **one step at a time**.

**[Try the live demo →](https://estherchaep.github.io/agent-plan-review/)**

When an agent proposes a plan, it shouldn't be a wall of text the user can only accept or reject. With `agent-plan-review`, each step becomes a small card the user can:

- **Confirm**. The step collapses to a one-line summary, the rail fills in, and the next step opens.
- **Adjust**. Each step has the fields the agent decided on (selects, numbers, text, toggles or your own controls), so the user can change a value instead of retyping a prompt.
- **Ask to change**. Send a free-text request for that step back to the agent. The step shows a "revising" placeholder until the agent replies with new values.
- **Edit later**. Any confirmed step can be reopened.

Every choice is kept as structured values, so you can hand the agent exact context (`review.context()` as JSON, or `review.describe()` for a prompt) and it can act on what the user actually confirmed.

```
 "Plan a long weekend in Lisbon for two."

 ✓  DATES & BUDGET                                      Edit
 │  Thu, Mar 12 · 3 nights · 2 people · €1,800
 ●  FLIGHTS
 │  ┌──────────────────────────────────────────────┐
 │  │ Find a return flight to Lisbon that fits     │
 │  │ your schedule.                               │
 │  │ Why  Thursday mornings are about €80 cheaper │
 │  │ LHR ┄┄┄┄┄┄┄┄ ✈ ┄┄┄┄┄┄┄┄ LIS   €296 return    │
 │  │ Cabin          [Economy              ▾]      │
 │  │ Outbound time  [Morning              ▾]      │
 │  │ (Confirm & continue)   Ask to change         │
 │  └──────────────────────────────────────────────┘
 3  WHERE TO STAY
 │  Pick a neighborhood and a nightly price.
 4  DAY-BY-DAY PLAN
 5  HOLD & BOOK
```

## Where it's useful

Any time an agent's plan has several decisions that depend on each other, where a wrong guess costs time or money, and where the user knows something the agent doesn't:

- **Travel:** dates, flights, hotel, itinerary, then hold and book
- **Errands & admin:** meal plan → grocery order, inbox cleanup, moving checklist, expense reports
- **Communication:** scheduling a meeting, drafting a letter (tone, length, key points), event invites
- **Work:** campaign launches, hiring loops, onboarding, refunds that need a human sign-off
- **Technical:** data pipelines, deployments, migrations

Anything irreversible, like sending, paying, deleting or deploying, gets its own confirmation step instead of being hidden inside "Accept plan".

## Install

```bash
npm install agent-plan-review framer-motion
```

React 18+ and framer-motion 11+ are peer dependencies. Styling is plain CSS with no Tailwind needed:

```ts
import "agent-plan-review/styles.css";
```

## Usage

```tsx
import { PlanReview, PlanProgress, usePlanReview, type PlanStep } from "agent-plan-review";
import "agent-plan-review/styles.css";

const steps: PlanStep[] = [
  {
    id: "dates",
    label: "Dates & budget",
    intent: "Lock in when you're going, who's coming, and the total you want to spend.",
    rationale: "Mid-March is shoulder season — hotels are about 30% cheaper than April.",
    fields: [
      { kind: "select", key: "depart", label: "Leave on", options: ["Thu, Mar 12", "Fri, Mar 13"] },
      { kind: "number", key: "nights", label: "Nights", unit: "nights", min: 1, max: 7 },
      { kind: "number", key: "budget", label: "Total budget", unit: "euros", min: 200, required: true },
    ],
    summary: "{{depart}} · {{nights}} · {{budget}}",
    validate: (v) => (Number(v.budget) / Number(v.nights) < 150 ? "That budget is **too tight** for Lisbon. Raise it or cut a night." : null),
  },
  {
    id: "stay",
    label: "Where to stay",
    intent: "Pick a neighborhood and shortlist hotels that match.",
    fields: [
      { kind: "select", key: "area", label: "Neighborhood", options: ["Alfama", "Baixa", "Príncipe Real"] },
      { kind: "toggle", key: "freeCancel", label: "Free cancellation only" },
    ],
    summary: "{{area}} · free cancellation: {{freeCancel}}",
  },
  {
    id: "book",
    label: "Hold & book",
    intent: "Hold the flight and hotel, then send you one summary to approve.",
    confirmLabel: "Confirm & hold",
  },
];

function TripPlan({ onBook, onAskAgent }) {
  const review = usePlanReview({
    steps,
    initialValues: { nights: 3, budget: 1800, freeCancel: true },
    onComplete: (values) => onBook(values),
  });

  return (
    <>
      <PlanReview review={review} onAskChange={(step, values) => onAskAgent(step, values)} />
      <PlanProgress review={review} />
    </>
  );
}
```

### Plans as JSON

Apart from `validate`, `transform`, `render` and `content`, a `PlanStep` is plain data. That means you can let the model return steps directly, for example as a tool call's input, and add client-side validation afterwards:

```ts
const steps = agentResult.steps.map((s) => ({ ...s, validate: validators[s.id] }));
```

For example, the model can return this as the input to a `propose_plan` tool:

```json
{
  "id": "flights",
  "label": "Flights",
  "intent": "Find a return flight to Lisbon that fits your schedule.",
  "rationale": "Thursday morning flights are about **€80 cheaper** than Friday evening ones.",
  "fields": [
    { "kind": "select", "key": "cabin", "label": "Cabin", "options": ["Economy", "Premium economy", "Business"] },
    { "kind": "select", "key": "stops", "label": "Stops", "options": ["Nonstop only", "Up to 1 stop"] }
  ],
  "summary": "{{cabin}} · {{stops}}",
  "askHint": "Fly from Gatwick, evening departure"
}
```

Built-in checks for `required`, number `min`/`max` and text `pattern` run without any code.

### Sending context back to the agent

```ts
// After each confirmation, or when the user asks for a change:
review.context();
// { steps: [{ id: "dates", label: "Dates & budget", status: "done", summary: "Thu, Mar 12 · 3 nights · 1800 euros", values: { ... } }, ...],
//   values: { depart: "Thu, Mar 12", nights: 3, budget: 1800, ... } }

review.describe();
// 1. Dates & budget [confirmed] — Thu, Mar 12 · 3 nights · 1800 euros
// 2. Where to stay [in review] — Alfama · free cancellation: on
// 3. Hold & book [not reviewed] — Hold the flight and hotel, then send you one summary to approve.
```

### Ask to change → agent revises

```tsx
const [steps, setSteps] = useState<PlanStep[]>(plan);
const review = usePlanReview({ steps });

async function askAgent(step: PlanStep, request: string) {
  setSteps((p) => p.map((s) => (s.id === step.id ? { ...s, pending: true } : s))); // shows the revising placeholder
  review.edit(step.id);                                                             // keeps that step open
  const { values, rationale } = await agent.reviseStep({ step: step.id, request, plan: review.context() });
  review.setValues(values);                                                         // the agent's new values
  setSteps((p) => p.map((s) => (s.id === step.id ? { ...s, pending: false, rationale } : s)));
}
```

### Streaming plans

Pass steps as they arrive and set `streaming` until the agent has finished. New steps animate in, and `onComplete` won't fire while the plan is still growing.

```ts
usePlanReview({ steps: receivedSoFar, streaming: !done });
```

## API

### `usePlanReview(options)`

| Option | Type | |
| --- | --- | --- |
| `steps` | `PlanStep[]` | The plan. Can change over time. |
| `initialValues` | `PlanValues` | The agent's proposed values. Missing fields use their defaults. |
| `streaming` | `boolean` | The agent is still sending steps. |
| `onStepConfirm` | `(step, values) => void` | Each confirmation. Use it to preview the step's effect or notify the agent. |
| `onComplete` | `(values) => void` | Every step confirmed. |

Returns `steps`, `values`, `activeIndex`, `activeStep`, `statusOf(i)`, `confirmedCount`, `complete`, `problem`, and the actions `setValue`, `setValues`, `confirm`, `edit(idOrIndex)`, `confirmAll`, `reset`, `context`, `describe`.

### `<PlanReview />`

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `review` | `PlanReviewState` | | From `usePlanReview` |
| `onAskChange` | `(step, values) => void` | | Shows **Ask to change** on the active card |
| `readOnly` | `boolean` | `false` | Summaries only, e.g. after the plan has run |
| `autoScroll` | `boolean` | `true` | Scroll the active step into view |
| `stagger` | `number` | `0.07` | Seconds between steps when the plan appears |
| `labels` | `Partial<PlanReviewLabels>` | | Button and status text, for i18n |
| `theme` | `"auto" \| "light" \| "dark"` | `"auto"` | |

### `<PlanProgress />`

The composer bar: "Reviewing plan · step 2 of 5", a progress track, and **Confirm all**. It hides itself once the review is done. Props: `review`, `onConfirmAll`, `confirmAllLabel`, `text(step, total)`, `theme`.

### `PlanStep`

| Field | |
| --- | --- |
| `id`, `label`, `intent` | Identity, rail label, and the one-sentence description of what the agent will do |
| `rationale` | Why the agent chose this. Shown on the active card. |
| `fields` | `select`, `number`, `text`, `textarea`, `toggle`, or `custom` with your own `render` |
| `summary` | `"{{key}} …"` template or `(values) => string`. Shown once confirmed. |
| `validate` | `(values) => string \| null`. A message blocks confirming. Supports `` `code` `` and `**bold**`. |
| `content` | Extra content on the card (schemas, previews, charts) |
| `pending` | The agent is revising the step |
| `askHint`, `confirmLabel` | Example change request, and the button label override |

## Theming

Override any `--apr-*` CSS variable on `.apr-root` / `.apr-progress`. For example:

```css
.apr-root, .apr-progress {
  --apr-accent: #7c3aed;
  --apr-success: #16a34a;
  --apr-card-bg: #faf5ff;
  --apr-radius: 14px;
  --apr-font: "Inter", sans-serif;
}
```

Dark mode follows `prefers-color-scheme` unless you pass `theme`. Animations respect `prefers-reduced-motion`.

## Demo

The demo is hosted at **https://estherchaep.github.io/agent-plan-review/**. `pnpm run deploy:demo` rebuilds it and publishes it to the `gh-pages` branch. To run it locally:

```bash
pnpm install
pnpm dev
```

The demo has two examples you can switch between:

- **Trip planning** (default): a long weekend in Lisbon. It covers dates and budget, flights with a live price card, where to stay (with a check that the hotel leaves enough budget for food and activities), a day-by-day itinerary, and a hold-and-book step that charges nothing until you approve.
- **Data pipeline**: an agent building a stock-out alert pipeline, with source schemas, join keys and output settings.

A mock agent streams each plan in step by step. Try **Ask to change** with requests like "Make it 4 nights and €2,400", "Fly from Gatwick, evening departure" or "More relaxed, and skip Sintra". The step shows a revising placeholder, then the agent fills in the new values. The panel on the right shows the context that would go back to the agent.

The example plans live in [`demo/scenarios/`](demo/scenarios), and the mock agent is in [`demo/mockAgent.ts`](demo/mockAgent.ts).

## License

MIT
