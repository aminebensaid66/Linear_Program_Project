import logging

import pulp

from app.models.schemas import LPProblem, SolverResult

logger = logging.getLogger(__name__)


def solve_lp(problem: LPProblem) -> SolverResult:
    """Solve an LP problem with PuLP and return normalized status payload."""

    try:
        sense = (
            pulp.LpMinimize
            if problem.objective.sense == "minimize"
            else pulp.LpMaximize
        )
        lp = pulp.LpProblem(problem.title or "lp_problem", sense)

        variables = {}
        for name in problem.variables:
            bounds = problem.variable_bounds.get(name) if problem.variable_bounds else None
            low = bounds.lower if bounds and bounds.lower is not None else 0.0
            up = bounds.upper if bounds else None
            variables[name] = pulp.LpVariable(name, lowBound=low, upBound=up)

        def get_variable(var_name: str) -> pulp.LpVariable:
            if var_name not in variables:
                logger.warning(
                    "Variable '%s' was referenced but not declared; creating with default bounds",
                    var_name,
                )
                variables[var_name] = pulp.LpVariable(var_name, lowBound=0.0, upBound=None)
            return variables[var_name]

        objective = pulp.lpSum(
            coefficient * get_variable(var_name)
            for var_name, coefficient in problem.objective.coefficients.items()
        )
        lp += objective

        for index, constraint in enumerate(problem.constraints):
            expression = pulp.lpSum(
                coefficient * get_variable(var_name)
                for var_name, coefficient in constraint.coefficients.items()
            )

            label = constraint.label or f"constraint_{index + 1}"

            if constraint.operator == "<=":
                lp += expression <= constraint.rhs, label
            elif constraint.operator == ">=":
                lp += expression >= constraint.rhs, label
            else:
                lp += expression == constraint.rhs, label

        lp.solve(pulp.PULP_CBC_CMD(msg=False))

        raw_status = pulp.LpStatus.get(lp.status, "Undefined").lower()
        if raw_status == "optimal":
            values = {
                name: float(pulp.value(variable) or 0.0)
                for name, variable in variables.items()
            }
            objective_value = float(pulp.value(lp.objective) or 0.0)
            return SolverResult(
                status="optimal",
                objective_value=objective_value,
                variables=values,
                message="Optimal solution found",
            )

        if raw_status == "infeasible":
            return SolverResult(
                status="infeasible",
                objective_value=None,
                variables=None,
                message="No feasible solution satisfies all constraints",
            )

        if raw_status == "unbounded":
            return SolverResult(
                status="unbounded",
                objective_value=None,
                variables=None,
                message="Objective can be improved without bound",
            )

        return SolverResult(
            status="error",
            objective_value=None,
            variables=None,
            message=f"Solver ended with status: {raw_status}",
        )

    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to solve LP problem")
        return SolverResult(
            status="error",
            objective_value=None,
            variables=None,
            message=f"Solver exception: {exc}",
        )