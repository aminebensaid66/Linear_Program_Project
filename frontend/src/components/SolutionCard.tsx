import type { LpResponse } from "../types/lp";

type SolutionCardProps = {
  response: LpResponse;
};

const statusLabel: Record<string, string> = {
  optimal: "Optimal",
  infeasible: "Infeasible",
  unbounded: "Unbounded",
  error: "Error"
};

function formatValue(value: number | null): string {
  if (value === null) {
    return "-";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

export function SolutionCard({ response }: SolutionCardProps) {
  const result = response.solverResult;
  const statusClass = `status-${result.status}`;
  const variableCount = Object.keys(response.parsedProblem.objective.coefficients).length;
  const constraintCount = response.parsedProblem.constraints.length;
  const hasOptimal = result.status === "optimal" && Boolean(result.variables);
  const variables = result.variables ?? {};

  return (
    <section className={`solution-card ${statusClass}`}>
      <header className="solution-header">
        <strong className="status-text">{statusLabel[result.status] ?? result.status}</strong>
        <span className="sense-pill">{response.parsedProblem.objective.sense.toUpperCase()}</span>
      </header>

      <div className="solution-metrics">
        <span>{variableCount} vars</span>
        <span>{constraintCount} constraints</span>
        <span>Objective: {formatValue(result.objective_value)}</span>
      </div>

      {hasOptimal ? (
        <div className="solution-body">
          <div className="solution-block">
            <h4>Variables</h4>
            <div className="var-grid">
              {Object.entries(variables).map(([name, value]) => (
                <div key={name} className="var-chip">
                  <span>{name}</span>
                  <b>{formatValue(value)}</b>
                </div>
              ))}
            </div>
          </div>

          <div className="solution-block">
            <h4>Objective</h4>
            <p className="objective-text">Z = {formatValue(result.objective_value)}</p>
          </div>
        </div>
      ) : (
        <p className="solver-message">{result.message}</p>
      )}
    </section>
  );
}