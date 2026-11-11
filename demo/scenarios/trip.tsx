import type { PlanStep, PlanValues } from "agent-plan-review";
import type { Scenario } from "./types";

// "Plan a long weekend in Lisbon." The agent proposes dates, flights, a place
// to stay and a day-by-day plan; nothing is booked until the last step.

const ORIGINS = [
  { value: "LHR", label: "London Heathrow (LHR)", price: 148, time: "2h 45m" },
  { value: "LGW", label: "London Gatwick (LGW)", price: 126, time: "2h 50m" },
  { value: "CDG", label: "Paris Charles de Gaulle (CDG)", price: 172, time: "2h 35m" },
];
const CABIN: Record<string, number> = { Economy: 1, "Premium economy": 1.9, Business: 3.4 };

const AREAS = [
  { value: "alfama", label: "Alfama — old town, fado, steep lanes" },
  { value: "baixa", label: "Baixa — central, flat, easy transit" },
  { value: "principe-real", label: "Príncipe Real — quiet, gardens, cafés" },
  { value: "belem", label: "Belém — riverside, museums, 25 min out" },
];
const areaName = (v: unknown) => AREAS.find((a) => a.value === v)?.label.split(" — ")[0] ?? String(v);

const n = (v: unknown) => Number(v) || 0;
const eur = (v: number) => `€${Math.round(v).toLocaleString("en-GB")}`;

function flightPrice(v: PlanValues) {
  const o = ORIGINS.find((x) => x.value === v.from) ?? ORIGINS[0];
  const stopDiscount = v.stops === "Up to 1 stop" ? 35 : 0;
  return { origin: o, perPerson: (o.price - stopDiscount) * (CABIN[String(v.cabin)] ?? 1) };
}

function FlightCard({ values }: { values: PlanValues }) {
  const { origin, perPerson } = flightPrice(values);
  const travelers = n(values.travelers) || 1;
  return (
    <div className="trip-card">
      <div className="trip-route">
        <strong>{origin.value}</strong>
        <span className="trip-line" aria-hidden />
        <strong>LIS</strong>
      </div>
      <div className="trip-meta">
        <span>
          {values.depart} · {String(values.time).toLowerCase()} · {values.stops === "Nonstop only" ? `nonstop, ${origin.time}` : "1 stop, from 4h 10m"}
        </span>
        <span className="trip-price">
          {eur(perPerson * travelers)} <small>return · {travelers} {travelers === 1 ? "traveler" : "travelers"}</small>
        </span>
      </div>
    </div>
  );
}

// Per pace: arrival day, then middle days in order, then departure day.
const ACTIVITIES: Record<string, { arrive: string[]; days: string[][]; leave: string[] }> = {
  relaxed: {
    arrive: ["Check in, sunset at Miradouro da Senhora do Monte"],
    days: [
      ["Slow morning in Alfama", "Lunch at Time Out Market"],
      ["Belém: pastéis de nata & riverside walk"],
      ["Gulbenkian gardens", "Long lunch in Campo de Ourique"],
      ["Beach afternoon in Cascais"],
    ],
    leave: ["Coffee in Príncipe Real", "Head to the airport"],
  },
  balanced: {
    arrive: ["Check in, tram 28 to Alfama", "Dinner & fado"],
    days: [
      ["São Jorge Castle", "LX Factory", "Sunset at Miradouro de Santa Catarina"],
      ["Belém Tower & Jerónimos Monastery", "Pastéis de Belém", "MAAT"],
      ["Gulbenkian Museum", "Príncipe Real shops", "Dinner in Bairro Alto"],
      ["Cascais by train", "Seafood lunch by the harbor"],
    ],
    leave: ["Feira da Ladra flea market", "Head to the airport"],
  },
  packed: {
    arrive: ["Check in, tram 28", "Alfama walking tour", "Late dinner in Bairro Alto"],
    days: [
      ["São Jorge Castle", "Oceanário", "Parque das Nações", "Rooftop bar"],
      ["Belém Tower", "Jerónimos Monastery", "MAAT", "Cooking class"],
      ["Gulbenkian Museum", "Tile Museum", "LX Factory", "Fado night"],
      ["Cascais & Cabo da Roca", "Sunset at Boca do Inferno"],
    ],
    leave: ["Early market run", "Head to the airport"],
  },
};

function DayPlan({ values }: { values: PlanValues }) {
  const days = Math.min(n(values.nights), 7) + 1;
  const plan = ACTIVITIES[String(values.pace)] ?? ACTIVITIES.balanced;
  return (
    <ol className="trip-days">
      {Array.from({ length: days }, (_, i) => {
        const items =
          i === 0
            ? plan.arrive
            : i === days - 1
              ? plan.leave
              : values.sintra && i === 1
                ? ["Day trip to Sintra: Pena Palace & Quinta da Regaleira"]
                : plan.days[(i - 1) % plan.days.length];
        return (
          <li key={i}>
            <span className="trip-day">Day {i + 1}</span>
            <span>{items.join(" · ")}</span>
          </li>
        );
      })}
    </ol>
  );
}

const STEPS: PlanStep[] = [
  {
    id: "dates",
    label: "Dates & budget",
    intent: "Lock in when you're going, who's coming, and the total you want to spend.",
    rationale: "Mid-March is shoulder season — mild weather and hotels about 30% cheaper than April.",
    fields: [
      { kind: "select", key: "depart", label: "Leave on", options: ["Thu, Mar 12", "Fri, Mar 13", "Sat, Mar 14"] },
      { kind: "number", key: "nights", label: "Nights", unit: "nights", min: 1, max: 7, required: true },
      { kind: "number", key: "travelers", label: "Travelers", unit: "people", min: 1, max: 8, required: true },
      { kind: "number", key: "budget", label: "Total budget", unit: "euros", min: 200, step: 50, required: true },
      { kind: "toggle", key: "flexible", label: "My dates are flexible by a day", help: "Lets me move the trip a day if it's noticeably cheaper." },
    ],
    summary: (v) => `${v.depart} · ${v.nights} nights · ${v.travelers} ${n(v.travelers) === 1 ? "person" : "people"} · ${eur(n(v.budget))}`,
    validate: (v) => {
      const perNight = n(v.budget) / Math.max(1, n(v.travelers) * n(v.nights));
      return perNight < 120
        ? `That's **${eur(perNight)}** per person per night for flights, hotel, food and activities — too tight for Lisbon. Raise the budget or cut a night.`
        : null;
    },
    askHint: "Make it 4 nights and €2,400",
  },
  {
    id: "flights",
    label: "Flights",
    intent: "Find a return flight to Lisbon that fits your schedule.",
    rationale: "Thursday morning flights are about **€80 cheaper** than Friday evening ones.",
    content: ({ values }) => <FlightCard values={values} />,
    fields: [
      { kind: "select", key: "from", label: "From", options: ORIGINS.map(({ value, label }) => ({ value, label })) },
      { kind: "select", key: "cabin", label: "Cabin", options: Object.keys(CABIN) },
      { kind: "select", key: "stops", label: "Stops", options: ["Nonstop only", "Up to 1 stop"] },
      { kind: "select", key: "time", label: "Outbound time", options: ["Morning", "Afternoon", "Evening"] },
    ],
    summary: (v) => {
      const { origin, perPerson } = flightPrice(v);
      return `${origin.value} → LIS · ${v.cabin} · ${String(v.stops).toLowerCase()} · ${eur(perPerson * (n(v.travelers) || 1))}`;
    },
    askHint: "Fly from Gatwick, evening departure",
  },
  {
    id: "stay",
    label: "Where to stay",
    intent: "Pick a neighborhood and a nightly price, then shortlist hotels that match.",
    rationale: "Alfama fits “walkable to restaurants”, but it's hilly — say so if that's a problem.",
    fields: [
      { kind: "select", key: "area", label: "Neighborhood", options: AREAS },
      { kind: "number", key: "nightly", label: "Up to", unit: "euros a night", min: 40, max: 1000, step: 10, required: true },
      { kind: "textarea", key: "mustHaves", label: "Must-haves", placeholder: "e.g. quiet at night, air conditioning, a view", rows: 2 },
      { kind: "toggle", key: "freeCancel", label: "Free cancellation only" },
    ],
    summary: (v) => `${areaName(v.area)} · up to ${eur(n(v.nightly))}/night${v.freeCancel ? " · free cancellation" : ""}`,
    validate: (v) => {
      const stay = n(v.nightly) * n(v.nights);
      const { perPerson } = flightPrice(v);
      const left = n(v.budget) - stay - perPerson * (n(v.travelers) || 1);
      return left < 120 * n(v.nights)
        ? `**${eur(stay)}** on the hotel plus flights leaves **${eur(Math.max(0, left))}** for food and activities. Lower the nightly price or raise the budget in step 1.`
        : null;
    },
    askHint: "Somewhere flat and central, under €150 a night",
  },
  {
    id: "days",
    label: "Day-by-day plan",
    intent: "Draft an itinerary around your pace and what you like doing.",
    content: ({ values }) => <DayPlan values={values} />,
    fields: [
      {
        kind: "select",
        key: "pace",
        label: "Pace",
        options: [
          { value: "relaxed", label: "Relaxed — one or two things a day" },
          { value: "balanced", label: "Balanced" },
          { value: "packed", label: "Packed — see as much as possible" },
        ],
      },
      { kind: "toggle", key: "sintra", label: "Include a Sintra day trip" },
      { kind: "number", key: "dinners", label: "Dinner reservations to book", unit: "dinners", min: 0, max: 7 },
    ],
    summary: (v) =>
      `${String(v.pace)[0].toUpperCase()}${String(v.pace).slice(1)} pace${v.sintra ? " · Sintra day trip" : ""} · ${v.dinners} dinner${n(v.dinners) === 1 ? "" : "s"} booked`,
    askHint: "More relaxed, and skip Sintra",
  },
  {
    id: "book",
    label: "Hold & book",
    intent: "Hold the flight and hotel, then send you one summary to approve.",
    rationale: "Nothing is charged until you approve the summary.",
    fields: [
      { kind: "toggle", key: "hold", label: "Hold bookings for 24 hours before paying" },
      { kind: "select", key: "sendTo", label: "Send the summary by", options: ["Email", "Text message", "Here in chat"] },
      { kind: "toggle", key: "calendar", label: "Add the trip to my calendar" },
    ],
    summary: (v) => `${v.hold ? "Hold 24h" : "Book now"} · summary by ${String(v.sendTo).toLowerCase()}${v.calendar ? " · added to calendar" : ""}`,
    askHint: "Don't hold — book it now and text me",
    confirmLabel: "Confirm & hold",
  },
];

export const trip: Scenario = {
  id: "trip",
  name: "Trip planning",
  prompt: "Plan a long weekend in Lisbon for two — we like food, old neighborhoods and not rushing.",
  intro: "Here's a plan for Lisbon. Check each step — I'll only hold bookings once you confirm the last one.",
  steps: STEPS,
  initialValues: {
    depart: "Thu, Mar 12",
    nights: 3,
    travelers: 2,
    budget: 1800,
    flexible: true,
    from: "LHR",
    cabin: "Economy",
    stops: "Nonstop only",
    time: "Morning",
    area: "alfama",
    nightly: 160,
    mustHaves: "Walkable to restaurants, quiet at night",
    freeCancel: true,
    pace: "balanced",
    sintra: true,
    dinners: 2,
    hold: true,
    sendTo: "Email",
    calendar: true,
  },
  confirmAllLabel: "Confirm all & hold",
  done: (v) =>
    v.hold
      ? `Done — your flight from ${v.from} and a hotel in ${areaName(v.area)} are on hold for 24 hours. I've sent the summary by ${String(v.sendTo).toLowerCase()}; nothing is charged until you approve it.`
      : `Booked — your flight from ${v.from} and a hotel in ${areaName(v.area)} are confirmed. The summary is on its way by ${String(v.sendTo).toLowerCase()}.`,
};
