export interface ScenarioDriver {
  name: string;
  currentState: string;
  favourableDevelopment: string;
  adverseDevelopment: string;
  evidenceStatus: "verified" | "estimated" | "assumed" | "unknown";
}
export interface ScenarioInput {
  horizon: string;
  baseline: string;
  drivers: ScenarioDriver[];
}
export interface Scenario {
  id: "optimistic" | "central" | "pessimistic";
  label: string;
  description: string;
  assumptions: string[];
  watchIndicators: string[];
  evidenceGaps: string[];
}

/** Builds qualitative scenarios only; it never invents numeric forecasts. */
export function buildScenarios(input: ScenarioInput): Scenario[] {
  if (!input.horizon.trim() || !input.baseline.trim()) throw new Error("SCENARIO_CONTEXT_REQUIRED");
  if (!input.drivers.length) throw new Error("SCENARIO_DRIVERS_REQUIRED");
  const gaps = input.drivers.filter(d => d.evidenceStatus === "unknown" || d.evidenceStatus === "assumed").map(d => d.name);
  const indicators = input.drivers.map(d => d.name);
  return [
    { id: "optimistic", label: "Scénario favorable", description: input.drivers.map(d => `${d.name} : ${d.favourableDevelopment}`).join(" ; "), assumptions: input.drivers.map(d => `${d.name} : évolution favorable supposée`), watchIndicators: indicators, evidenceGaps: gaps },
    { id: "central", label: "Scénario central", description: input.drivers.map(d => `${d.name} : ${d.currentState}`).join(" ; "), assumptions: ["Les conditions observées se prolongent sur l'horizon retenu."], watchIndicators: indicators, evidenceGaps: gaps },
    { id: "pessimistic", label: "Scénario défavorable", description: input.drivers.map(d => `${d.name} : ${d.adverseDevelopment}`).join(" ; "), assumptions: input.drivers.map(d => `${d.name} : évolution défavorable possible`), watchIndicators: indicators, evidenceGaps: gaps }
  ];
}
