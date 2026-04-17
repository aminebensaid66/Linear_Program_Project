export type ConstraintOperator = "<=" | ">=" | "=";

export interface ObjectiveFunction {
  coefficients: Record<string, number>;
  sense: "minimize" | "maximize";
}

export interface VariableBounds {
  lower?: number | null;
  upper?: number | null;
}

export interface Constraint {
  coefficients: Record<string, number>;
  operator: ConstraintOperator;
  rhs: number;
  label?: string | null;
}

export interface ParsedLpProblem {
  title: string | null;
  objective: ObjectiveFunction;
  constraints: Constraint[];
  variables: string[];
  variable_bounds?: Record<string, VariableBounds> | null;
}