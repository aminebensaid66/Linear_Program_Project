import { HttpException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LlmService } from "../llm/llm.service";
import { SolverService } from "../solver/solver.service";
import type { ParsedLpProblem } from "./interfaces/lp-problem.interface";
import type { LpResponse } from "./interfaces/lp-response.interface";
import type { LpSolverResult } from "./interfaces/lp-solver-result.interface";

@Injectable()
export class LpService {
  private readonly logger = new Logger(LpService.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly solverService: SolverService,
    private readonly configService: ConfigService
  ) {}

  async solveFromText(problem: string): Promise<LpResponse> {
    const startedAt = Date.now();
    this.logger.log("Received LP solve request");

    const allowLocalFallback =
      (this.configService.get<string>("ALLOW_LOCAL_PARSE_FALLBACK") || "true").toLowerCase() !==
      "false";

    let parsedProblem: ParsedLpProblem;
    let usedLocalParser = false;

    try {
      parsedProblem = await this.llmService.parseProblem(problem);
    } catch (error) {
      if (!allowLocalFallback) {
        throw error;
      }

      const status = this.extractStatusCode(error);
      this.logger.warn(
        `LLM parse failed${status ? ` (status=${status})` : ""}; switching to local parser fallback.`
      );
      parsedProblem = this.parseProblemLocally(problem);
      usedLocalParser = true;
    }

    const solverResult = await this.solverService.solve(parsedProblem);

    let explanation: string;
    try {
      explanation = await this.llmService.explainSolution({
        originalProblem: problem,
        parsedProblem,
        solverResult
      });
    } catch (error) {
      const status = this.extractStatusCode(error);
      this.logger.warn(
        `LLM explanation failed${status ? ` (status=${status})` : ""}; using local explanation fallback.`
      );
      explanation = this.buildLocalExplanation(parsedProblem, solverResult, usedLocalParser);
    }

    const durationMs = Date.now() - startedAt;
    this.logger.log(`LP solve completed in ${durationMs}ms with status=${solverResult.status}`);

    return {
      problem,
      parsedProblem,
      solverResult,
      explanation
    };
  }

  private parseProblemLocally(problemText: string): ParsedLpProblem {
    const normalized = this.normalizeProblemText(problemText).replace(/\r/g, "").trim();
    const lower = normalized.toLowerCase();

    const isMax = /\b(maximize|maximiser|maximization|maximisation)\b/i.test(lower);
    const isMin = /\b(minimize|minimiser|minimization|minimisation)\b/i.test(lower);

    if (!isMax && !isMin) {
      throw new HttpException(
        "Could not infer objective sense (minimize/maximize) from input",
        400
      );
    }

    const sense: "minimize" | "maximize" = isMax ? "maximize" : "minimize";

    const objectiveMatch = normalized.match(
      /(?:minimize|minimiser|maximize|maximiser)[\s\S]*?z\s*=\s*([^\n]+?)(?=(?:subject\s*to|sous\s+les\s+contraintes|constraints?\s*:|$))/i
    );

    if (!objectiveMatch?.[1]) {
      throw new HttpException("Could not parse objective expression", 400);
    }

    const objectiveCoefficients = this.parseLinearExpression(objectiveMatch[1]);

    const constraintsSplit = normalized.split(
      /subject\s*to\s*:|sous\s+les\s+contraintes\s*:|constraints?\s*:/i
    );
    const constraintsPart = constraintsSplit.length > 1 ? constraintsSplit.slice(1).join(" ") : "";

    if (!constraintsPart.trim()) {
      throw new HttpException("Could not parse constraints from input", 400);
    }

    const rawConstraints = constraintsPart
      .replace(/\n+/g, ",")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && /(<=|>=|=)/.test(item));

    const constraints: ParsedLpProblem["constraints"] = [];
    const variableBounds: NonNullable<ParsedLpProblem["variable_bounds"]> = {};

    for (let i = 0; i < rawConstraints.length; i += 1) {
      const entry = rawConstraints[i];
      const parts = entry.match(/^(.+?)(<=|>=|=)(.+)$/);
      if (!parts) {
        continue;
      }

      const [, leftExpression, operator, rhsRaw] = parts;
      const coefficients = this.parseLinearExpression(leftExpression);
      const rhs = Number.parseFloat(rhsRaw.trim());

      if (!Number.isFinite(rhs)) {
        throw new HttpException(`Invalid right-hand side in constraint: ${entry}`, 400);
      }

      const variableNames = Object.keys(coefficients);
      if (variableNames.length === 1) {
        const varName = variableNames[0];
        const coefficient = coefficients[varName];
        if (coefficient === 1 || coefficient === -1) {
          const normalizedRhs = coefficient === 1 ? rhs : -rhs;
          const normalizedOperator = coefficient === 1 ? operator : operator === ">=" ? "<=" : operator === "<=" ? ">=" : "=";

          if (!variableBounds[varName]) {
            variableBounds[varName] = { lower: 0, upper: null };
          }
          if (normalizedOperator === ">=") {
            variableBounds[varName].lower = normalizedRhs;
          }
          if (normalizedOperator === "<=") {
            variableBounds[varName].upper = normalizedRhs;
          }
        }
      }

      constraints.push({
        coefficients,
        operator: operator as "<=" | ">=" | "=",
        rhs,
        label: `c${i + 1}`
      });
    }

    if (!constraints.length) {
      throw new HttpException("No valid constraints were parsed", 400);
    }

    const variables = new Set<string>(Object.keys(objectiveCoefficients));
    constraints.forEach((constraint) => {
      Object.keys(constraint.coefficients).forEach((v) => variables.add(v));
    });

    return {
      title: null,
      objective: {
        coefficients: objectiveCoefficients,
        sense
      },
      constraints,
      variables: [...variables],
      variable_bounds: Object.keys(variableBounds).length ? variableBounds : null
    };
  }

  private normalizeProblemText(input: string): string {
    return input
      .replace(/[\u00A0]/g, " ")
      .replace(/[≤⩽]/g, "<=")
      .replace(/[≥⩾]/g, ">=")
      .replace(/[＝]/g, "=")
      .replace(/[−–—]/g, "-")
      .replace(/[×·]/g, "*")
      .replace(/;/g, ",");
  }

  private parseLinearExpression(expression: string): Record<string, number> {
    const compact = expression.replace(/\s+/g, "").replace(/\*/g, "");
    const normalized = compact
      .replace(/-/g, "+-")
      .replace(/^\+/, "")
      .split("+")
      .map((term) => term.trim())
      .filter(Boolean);

    const coefficients: Record<string, number> = {};

    for (const term of normalized) {
      const match = term.match(/^([+-]?\d*\.?\d*)?([a-zA-Z][a-zA-Z0-9_]*)$/);
      if (!match) {
        continue;
      }

      const [, rawCoefficient, variable] = match;
      let coefficient = 1;

      if (rawCoefficient === undefined || rawCoefficient === "-" || rawCoefficient === "") {
        coefficient = rawCoefficient === "-" ? -1 : 1;
      } else if (rawCoefficient === "+") {
        coefficient = 1;
      } else {
        const parsed = Number.parseFloat(rawCoefficient);
        if (!Number.isFinite(parsed)) {
          throw new HttpException(`Invalid coefficient in expression: ${expression}`, 400);
        }
        coefficient = parsed;
      }

      coefficients[variable] = (coefficients[variable] || 0) + coefficient;
    }

    if (!Object.keys(coefficients).length) {
      throw new HttpException(`Could not parse expression: ${expression}`, 400);
    }

    return coefficients;
  }

  private buildLocalExplanation(
    parsedProblem: ParsedLpProblem,
    solverResult: LpSolverResult,
    usedLocalParser: boolean
  ): string {
    const intro = usedLocalParser
      ? "LLM parsing was rate-limited, so a local parser was used."
      : "LLM explanation was rate-limited, so this local explanation was generated.";

    if (solverResult.status === "optimal" && solverResult.variables) {
      const vars = Object.entries(solverResult.variables)
        .map(([name, value]) => `- ${name} = ${value}`)
        .join("\n");

      return [
        "## Interpretation",
        intro,
        `Problem sense: **${parsedProblem.objective.sense}** with ${parsedProblem.constraints.length} constraints.`,
        "",
        "## Result",
        `Optimal objective value: **${solverResult.objective_value}**`,
        vars,
        "",
        "## Recommendation",
        "You can proceed with this decision vector under the current linear assumptions."
      ].join("\n");
    }

    return [
      "## Interpretation",
      intro,
      "",
      "## Result",
      `Solver status: **${solverResult.status}**`,
      solverResult.message,
      "",
      "## Recommendation",
      "Review constraints and bounds, then retry when LLM rate limits are cleared for richer guidance."
    ].join("\n");
  }

  private extractStatusCode(error: unknown): number | undefined {
    if (error instanceof HttpException) {
      return error.getStatus();
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
    ) {
      return (error as { status: number }).status;
    }

    return undefined;
  }

  async health(): Promise<{ status: string; solver: string }> {
    const solverHealthy = await this.solverService.health();
    return {
      status: "ok",
      solver: solverHealthy ? "ok" : "unreachable"
    };
  }
}