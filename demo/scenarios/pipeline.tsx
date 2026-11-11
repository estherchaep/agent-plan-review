import type { PlanStep, PlanValues } from "agent-plan-review";
import type { Scenario } from "./types";

// An example plan, as an agent might return it. Everything except `validate`,
// `transform` and `content` is plain JSON.

const TOPIC_FIELDS: Record<string, string[]> = {
  orders: ["order_id", "sku", "quantity", "total"],
  web_orders: ["order_id", "sku", "quantity", "channel"],
  inventory: ["sku", "warehouse", "on_hand", "updated_at"],
  warehouse_stock: ["sku", "warehouse", "on_hand", "reorder_at"],
  shipments: ["shipment_id", "order_id", "carrier", "eta"],
};

function SchemaChips({ topics }: { topics: string[] }) {
  return (
    <div className="schema">
      {topics.map((t) => (
        <div key={t} className="schema-row">
          <span className="schema-topic">{t}</span>
          <span className="schema-fields">
            {(TOPIC_FIELDS[t] ?? []).map((f) => (
              <code key={f}>{f}</code>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

const INITIAL_VALUES: PlanValues = {
  connection: "Kafka retail · dev",
  ordersTopic: "orders",
  stockTopic: "inventory",
  joinType: "inner",
  leftKey: "sku",
  rightKey: "sku",
  window: 60,
  threshold: 3,
  velocity: 14,
  outTopic: "low-stock-alerts",
  notify: true,
  sample: "Last 24 hours",
};

const PLAN: PlanStep[] = [
  {
    id: "sources",
    label: "Connect to sources",
    intent: "Read orders and stock levels, and profile both schemas to find the join key.",
    rationale: "These are the only two topics on this connection with a `sku` column.",
    content: ({ values }) => <SchemaChips topics={[String(values.ordersTopic), String(values.stockTopic)]} />,
    fields: [
      { kind: "select", key: "connection", label: "Connection", options: ["Kafka retail · dev", "Kafka retail · prod"] },
      { kind: "select", key: "ordersTopic", label: "Orders topic", options: ["orders", "web_orders"] },
      { kind: "select", key: "stockTopic", label: "Stock topic", options: ["inventory", "warehouse_stock", "shipments"] },
    ],
    summary: "{{ordersTopic}} + {{stockTopic}} · {{connection}}",
    validate: (v) =>
      v.stockTopic === "shipments"
        ? "`shipments` has no `sku` or stock level, so orders can't be matched to stock. Pick a topic with on-hand stock per SKU."
        : null,
    askHint: "Use warehouse_stock instead of inventory",
  },
  {
    id: "join",
    label: "Join on product",
    intent: "Match each order to the stock level for the same SKU.",
    fields: [
      {
        kind: "select",
        key: "joinType",
        label: "Join type",
        options: [
          { value: "inner", label: "Inner join" },
          { value: "left", label: "Left outer join" },
        ],
      },
      { kind: "select", key: "leftKey", label: "Orders key", options: ["sku", "order_id"] },
      { kind: "select", key: "rightKey", label: "Stock key", options: ["sku", "warehouse"] },
      { kind: "number", key: "window", label: "Match window", unit: "seconds", min: 5, max: 3600, required: true },
    ],
    summary: "{{joinType}} on {{leftKey}} = {{rightKey}} · {{window}} window",
    validate: (v) =>
      v.leftKey !== v.rightKey
        ? `\`${v.leftKey}\` and \`${v.rightKey}\` hold different values, so nothing would match. Join on \`sku\` on both sides.`
        : null,
    askHint: "Use a left join so orders without stock still come through",
  },
  {
    id: "logic",
    label: "Flag low stock",
    intent: "Compute days of cover from recent order velocity and flag SKUs about to run out.",
    rationale: "3 days matches your current restock lead time.",
    fields: [
      { kind: "number", key: "threshold", label: "Flag when days of cover is below", unit: "days", min: 0.5, max: 60, step: 0.5, required: true },
      { kind: "number", key: "velocity", label: "Order velocity window", unit: "days", min: 1, max: 365, required: true },
    ],
    summary: "cover < {{threshold}} · velocity over {{velocity}}",
    askHint: "Flag anything under 5 days of cover",
  },
  {
    id: "output",
    label: "Write the output",
    intent: "Publish flagged SKUs to a new topic.",
    fields: [
      {
        kind: "text",
        key: "outTopic",
        label: "Output topic",
        placeholder: "topic-name",
        monospace: true,
        required: true,
        pattern: "^[a-z0-9][a-z0-9._-]*$",
        patternMessage: "Topic names can only use lowercase letters, numbers, dots, dashes and underscores.",
        transform: (raw) => raw.toLowerCase().replace(/\s+/g, "-"),
      },
      { kind: "toggle", key: "notify", label: "Also post a daily digest to Slack" },
    ],
    summary: (v) => `→ ${v.outTopic}${v.notify ? " + Slack digest" : ""}`,
    askHint: "Call it stockout-watch and skip Slack",
  },
  {
    id: "dryrun",
    label: "Dry run",
    intent: "Check schemas end to end on a sample before the pipeline goes live.",
    fields: [{ kind: "select", key: "sample", label: "Sample", options: ["Last 24 hours", "10,000 records", "Last 7 days"] }],
    summary: "dry run on {{sample}}",
    askHint: "Dry run on the last 7 days instead",
    confirmLabel: "Confirm & build",
  },
];

export const pipeline: Scenario = {
  id: "pipeline",
  name: "Data pipeline",
  prompt: "Flag products that are about to run out of stock.",
  intro: "Here's my plan for the pipeline. Confirm each step or change anything that doesn't look right.",
  steps: PLAN,
  initialValues: INITIAL_VALUES,
  confirmAllLabel: "Confirm all & build",
  done: (v) => `Building the pipeline — flagged SKUs will go to \`${v.outTopic}\`.`,
};
