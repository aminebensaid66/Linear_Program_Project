from typing import Literal

from pydantic import BaseModel, Field


class Constraint(BaseModel):
    coefficients: dict[str, float] = Field(
        ..., description="Map of variable name to coefficient"
    )
    operator: Literal["<=", ">=", "="]
    rhs: float
    label: str | None = None


class ObjectiveFunction(BaseModel):
    coefficients: dict[str, float]
    sense: Literal["minimize", "maximize"]


class VariableBounds(BaseModel):
    lower: float | None = Field(default=0.0)
    upper: float | None = Field(default=None)


class LPProblem(BaseModel):
    title: str | None = None
    objective: ObjectiveFunction
    constraints: list[Constraint]
    variables: list[str]
    variable_bounds: dict[str, VariableBounds] | None = None


class SolverResult(BaseModel):
    status: Literal["optimal", "infeasible", "unbounded", "error"]
    objective_value: float | None = None
    variables: dict[str, float] | None = None
    message: str