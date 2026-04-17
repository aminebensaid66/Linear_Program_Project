export type SolverStatus = "optimal" | "infeasible" | "unbounded" | "error";

export interface LpSolverResult {
  status: SolverStatus;
  objective_value: number | null;
  variables: Record<string, number> | null;
  message: string;
}

export interface ParsedLpProblem {
  title: string | null;
  objective: {
    coefficients: Record<string, number>;
    sense: "minimize" | "maximize";
  };
  constraints: Array<{
    coefficients: Record<string, number>;
    operator: "<=" | ">=" | "=";
    rhs: number;
    label?: string | null;
  }>;
  variables: string[];
  variable_bounds?: Record<
    string,
    {
      lower?: number | null;
      upper?: number | null;
    }
  > | null;
}

export interface LpResponse {
  problem: string;
  parsedProblem: ParsedLpProblem;
  solverResult: LpSolverResult;
  explanation: string;
}

export type MessageRole = "user" | "assistant" | "error";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  lpResponse?: LpResponse;
}