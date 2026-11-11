import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
import { PlanProgress, PlanReview, stepSummary, usePlanReview, type PlanStep, type PlanValues } from "agent-plan-review";
import "agent-plan-review/styles.css";
import "./demo.css";
import { INITIAL_VALUES, PLAN } from "./plan";

type Msg = { id: number; from: "user" | "agent"; text: string; plan?: boolean };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let nextId = 1;

/**
 * A stand-in for a real agent. Given a change request for a step, it returns
 * new values (and a note) — the same shape a tool call from an LLM would.
 */
function mockRevise(step: PlanStep, request: string, values: PlanValues): { patch: PlanValues; note: string } {
  const r = request.toLowerCase();
  const num = r.match(/\d+(\.\d+)?/)?.[0];
  const patch: PlanValues = {};
  for (const f of step.fields ?? []) {
    if (f.kind === "select") {
      const hit = f.options.map((o) => (typeof o === "string" ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value }))
        .find((o) => r.includes(o.value.toLowerCase()) || r.includes(o.label.toLowerCase().replace(/ join$/, "")));
      if (hit && hit.value !== values[f.key]) patch[f.key] = hit.value;
    }
    if (f.kind === "number" && num && !(Object.keys(patch).some((k) => step.fields?.find((x) => x.key === k)?.kind === "number"))) patch[f.key] = Number(num);
    if (f.kind === "toggle" && /(skip|no|without|don't)/.test(r) && r.includes("slack")) patch[f.key] = false;
    if (f.kind === "text") {
      const name = request.match(/(?:call it|name it|called)\s+([\w.-]+)/i)?.[1];
      if (name) patch[f.key] = name.toLowerCase();
    }
  }
  const changed = Object.keys(patch);
  return {
    patch,
    note: changed.length
      ? `Updated “${step.label}”: ${changed.map((k) => `${step.fields?.find((f) => f.key === k)?.label} → ${stepSummary({ ...step, summary: `{{${k}}}` }, { ...values, ...patch })}`).join(", ")}.`
      : `I couldn't map that to a setting on “${step.label}”, so I left it as is. Try naming a value, e.g. “${step.askHint}”.`,
  };
}

function Dots() {
  return (
    <span className="dots" aria-label="Agent is thinking">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />
      ))}
    </span>
  );
}

function App() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [steps, setSteps] = useState<PlanStep[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [built, setBuilt] = useState(false);
  const [askStep, setAskStep] = useState<PlanStep | null>(null);
  const [draft, setDraft] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const say = (from: Msg["from"], text: string, plan = false) => setMessages((m) => [...m, { id: nextId++, from, text, plan }]);

  const review = usePlanReview({
    steps,
    initialValues: INITIAL_VALUES,
    streaming,
    onComplete: () => {
      setBuilt(true);
      say("agent", "Building the pipeline with the plan you confirmed.");
    },
  });

  // The agent "streams" its plan one step at a time.
  const start = async () => {
    setMessages([]);
    setSteps([]);
    setBuilt(false);
    review.reset(INITIAL_VALUES);
    say("user", "Flag products that are about to run out of stock.");
    setThinking(true);
    await wait(900);
    setThinking(false);
    say("agent", "Here's my plan. Confirm each step or change anything that doesn't look right.", true);
    setStreaming(true);
    for (const s of PLAN) {
      await wait(380);
      setSteps((p) => [...p, s]);
    }
    setStreaming(false);
  };
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, []);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, thinking]);

  const askChange = (step: PlanStep) => {
    setAskStep(step);
    composer.current?.focus();
  };

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    say("user", text);
    const target = askStep ?? review.activeStep;
    setAskStep(null);
    if (!target) {
      setThinking(true);
      await wait(700);
      setThinking(false);
      say("agent", "The plan is confirmed. Use Edit on a step to reopen it.");
      return;
    }
    // While the agent works on it, the step shows a revising placeholder.
    setSteps((p) => p.map((s) => (s.id === target.id ? { ...s, pending: true } : s)));
    review.edit(target.id);
    await wait(1300);
    const { patch, note } = mockRevise(target, text, review.values);
    review.setValues(patch);
    setSteps((p) => p.map((s) => (s.id === target.id ? { ...s, pending: false } : s)));
    say("agent", note);
  };

  const placeholder = askStep
    ? `Change “${askStep.label}” — e.g. ${askStep.askHint}`
    : review.activeStep
      ? `Ask to change “${review.activeStep.label}”…`
      : "Message the agent…";

  return (
    <div className="layout">
      <header className="intro">
        <h1>agent-plan-review</h1>
        <p>
          When an agent returns a plan, the user reviews it one step at a time — confirming each step, adjusting its settings, or asking the agent
          to change it. Every choice flows back to the agent as structured context.
        </p>
        <div className="intro-actions">
          <button className="ghost" onClick={() => void start()}>
            Replay
          </button>
          <a href="https://github.com/estherchaep/agent-plan-review">GitHub</a>
        </div>
      </header>

      <section className="chat" aria-label="Agent chat">
        <div className="thread" ref={thread}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              className={`msg msg-${m.from}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              {m.text}
              {/* The plan sits under the agent message that introduced it */}
              {m.plan && steps.length > 0 && (
                <div className="plan">
                  <div className="plan-head">
                    <span>Proposed plan</span>
                    <span className="plan-count">
                      {review.confirmedCount}/{steps.length} confirmed
                    </span>
                  </div>
                  <PlanReview review={review} readOnly={built} onAskChange={askChange} />
                </div>
              )}
            </motion.div>
          ))}
          {thinking && (
            <div className="msg msg-agent">
              <Dots />
            </div>
          )}
        </div>

        <div className="composer-wrap">
          <PlanProgress review={review} onConfirmAll={() => review.confirmAll()} confirmAllLabel="Confirm all & build" />
          <AnimatePresence>
            {askStep && (
              <motion.div className="ask-chip" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                Changing <strong>{askStep.label}</strong>
                <button aria-label="Cancel change" onClick={() => setAskStep(null)}>
                  ×
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="composer">
            <textarea
              ref={composer}
              rows={2}
              value={draft}
              placeholder={placeholder}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button className="send" onClick={() => void send()} disabled={!draft.trim()} aria-label="Send">
              ↑
            </button>
          </div>
        </div>
      </section>

      <aside className="context" aria-label="Context sent to the agent">
        <h2>Context for the agent</h2>
        <p>
          <code>review.describe()</code>
        </p>
        <pre>{review.describe() || "Waiting for the plan…"}</pre>
        <p>
          <code>review.context()</code>
        </p>
        <pre>{JSON.stringify(review.context().steps.map(({ id, status, values }) => ({ id, status, values })), null, 2)}</pre>
      </aside>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
