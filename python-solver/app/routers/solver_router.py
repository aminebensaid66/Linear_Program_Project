import logging

from fastapi import APIRouter

from app.models.schemas import LPProblem, SolverResult
from app.services.solver import solve_lp

router = APIRouter(prefix="/solve", tags=["solver"])
logger = logging.getLogger(__name__)


@router.post("/", response_model=SolverResult)
def solve(problem: LPProblem) -> SolverResult:
    logger.info(
        "Received LP problem: title=%s variables=%d constraints=%d",
        problem.title or "untitled",
        len(problem.variables),
        len(problem.constraints),
    )
    result = solve_lp(problem)
    logger.info("Solved LP with status=%s", result.status)
    return result


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "python-solver"}