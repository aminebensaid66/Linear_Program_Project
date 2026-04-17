import type { ParsedLpProblem } from "./lp-problem.interface";
import type { LpSolverResult } from "./lp-solver-result.interface";

export interface LpResponse {
  problem: string;
  parsedProblem: ParsedLpProblem;
  solverResult: LpSolverResult;
  explanation: string;
}