import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
import { InlineMarkdown, PlanProgress, PlanReview, usePlanReview, type PlanStep } from "agent-plan-review";
import "agent-plan-review/styles.css";
import "./demo.css";
import { mockRevise } from "./mockAgent";
import { pipeline } from "./scenarios/pipeline";
import { trip } from "./scenarios/trip";
import type { Scenario } from "./scenarios/types";

type Msg = { id: number; from: "user" | "agent"; text: string; plan?: boolean };

const SCENARIOS: Scenario[] = [trip, pipeline];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let nextId = 1;

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
  const [scenario, setScenario] = useState<Scenario>(trip);
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
    initialValues: scenario.initialValues,
    streaming,
    onComplete: (values) => {
      setBuilt(true);
      say("agent", scenario.done(values));
    },
  });

  // The agent "streams" its plan one step at a time.
  // Each run gets a token, so switching scenarios mid-stream stops the old one.
  const run = useRef(0);
  const start = async (sc: Scenario) => {
    const token = ++run.current;
    const live = () => run.current === token;
    setScenario(sc);
    setMessages([]);
    setSteps([]);
    setBuilt(false);
    setAskStep(null);
    setDraft("");
    review.reset(sc.initialValues);
    say("user", sc.prompt);
    setThinking(true);
    await wait(900);
    if (!live()) return;
    setThinking(false);
    say("agent", sc.intro, true);
    setStreaming(true);
    for (const s of sc.steps) {
      await wait(380);
      if (!live()) return;
      setSteps((p) => [...p, s]);
    }
    setStreaming(false);
  };
  useEffect(() => {
    void start(trip);
    return () => {
      run.current++;
    };
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
    const token = run.current;
    await wait(1300);
    if (run.current !== token) return;
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
          <div className="tabs" role="tablist" aria-label="Example">
            {SCENARIOS.map((sc) => (
              <button
                key={sc.id}
                role="tab"
                aria-selected={sc.id === scenario.id}
                className={sc.id === scenario.id ? "tab tab-on" : "tab"}
                onClick={() => void start(sc)}
              >
                {sc.name}
              </button>
            ))}
          </div>
          <button className="ghost" onClick={() => void start(scenario)}>
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
              <InlineMarkdown text={m.text} />
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
          <PlanProgress review={review} onConfirmAll={() => review.confirmAll()} confirmAllLabel={scenario.confirmAllLabel} />
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
