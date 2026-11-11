# agent-plan-review

A React component for reviewing an AI agent's plan **one step at a time**.

When an agent proposes a plan, it shouldn't be a wall of text the user can only accept or reject. With `agent-plan-review`, each step becomes a small card the user can:

- **Confirm**. The step collapses to a one-line summary, the rail fills in, and the next step opens.
- **Adjust**. Each step has the fields the agent decided on (selects, numbers, text, toggles or your own controls), so the user can change a value instead of retyping a prompt.
- **Ask to change**. Send a free-text request for that step back to the agent. The step shows a "revising" placeholder until the agent replies with new values.
- **Edit later**. Any confirmed step can be reopened.

Every choice is kept as structured values, so you can hand the agent exact context (`review.context()` as JSON, or `review.describe()` for a prompt) and it can act on what the user actually confirmed.

```
 ✓  CONNECT TO SOURCES                                  Edit
 │  orders + inventory · Kafka retail · dev
 ●  JOIN ON PRODUCT
 │  ┌──────────────────────────────────────────────┐
 │  │ Match each order to the stock level for the  │
 │  │ same SKU.                                    │
 │  │ Join type      [Inner join            ▾]     │
 │  │ Match window   [60] seconds                  │
 │  │ (Confirm & continue)   Ask to change         │
 │  └──────────────────────────────────────────────┘
 3  FLAG LOW STOCK
    Compute days of cover and flag SKUs about to run out.
```

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
    id: "sources",
    label: "Connect to sources",
    intent: "Read orders and stock levels, and profile both schemas.",
    rationale: "These are the only topics with a `sku` column.",
    fields: [
      { kind: "select", key: "ordersTopic", label: "Orders topic", options: ["orders", "web_orders"] },
      { kind: "select", key: "stockTopic", label: "Stock topic", options: ["inventory", "warehouse_stock"] },
    ],
    summary: "{{ordersTopic}} + {{stockTopic}}",
  },
  {
    id: "logic",
    label: "Flag low stock",
    intent: "Flag SKUs whose days of cover drop below a threshold.",
    fields: [{ kind: "number", key: "threshold", label: "Days of cover below", unit: "days", min: 0.5, max: 60 }],
    summary: "cover < {{threshold}}",
  },
];

function AgentPlan({ onRun, onAskAgent }) {
  const review = usePlanReview({
    steps,
    initialValues: { threshold: 3 },
    onComplete: (values) => onRun(values),
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

Built-in checks for `required`, number `min`/`max` and text `pattern` run without any code.

### Sending context back to the agent

```ts
// After each confirmation, or when the user asks for a change:
review.context();
// { steps: [{ id: "sources", label: "...", status: "done", summary: "orders + inventory", values: { ... } }, ...],
//   values: { ordersTopic: "orders", ... } }

review.describe();
// 1. Connect to sources [confirmed] — orders + inventory
// 2. Flag low stock [in review] — cover < 3 days
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

```bash
pnpm install
pnpm dev
```

The demo runs a mock agent. It streams a plan in, lets you confirm or change each step, revises a step when you ask, and shows the context it would send back to the agent.

## License

MIT
