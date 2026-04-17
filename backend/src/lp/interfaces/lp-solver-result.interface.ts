export type SolverStatus = "optimal" | "infeasible" | "unbounded" | "error";

export interface LpSolverResult {
  status: SolverStatus;
  objective_value: number | null;
  variables: Record<string, number> | null;
  message: string;
}