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
    const narrativeParsed = this.tryParseNarrativeProblem(normalized);
    if (narrativeParsed) {
      return narrativeParsed;
    }

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

  private tryParseNarrativeProblem(problemText: string): ParsedLpProblem | null {
    const declaredVariables = this.extractDeclaredVariables(problemText);
    const tabularRows = this.extractTabularRows(problemText);
    const objectiveEntries = this.extractNarrativeObjective(problemText, tabularRows);
    if (!objectiveEntries.length) {
      return null;
    }

    const objectiveCoefficients: Record<string, number> = {};
    const labelToVariable = new Map<string, string>();

    objectiveEntries.forEach((entry, index) => {
      const variable =
        this.resolveFromDeclaredVariables(entry.label, declaredVariables) ||
        this.toVariableName(entry.label, index + 1);
      objectiveCoefficients[variable] = entry.value;
      labelToVariable.set(this.normalizeLabel(entry.label), variable);
    });

    const resourceCoefficients = new Map<string, Record<string, number>>();
    const requirements = this.extractNarrativeRequirements(problemText);

    requirements.forEach((requirement) => {
      const variable = this.resolveVariableName(requirement.label, labelToVariable);
      if (!variable) {
        return;
      }

      requirement.resources.forEach((resource) => {
        const key = this.normalizeLabel(resource.name);
        if (!resourceCoefficients.has(key)) {
          resourceCoefficients.set(key, {});
        }

        const coeff = resourceCoefficients.get(key) as Record<string, number>;
        coeff[variable] = resource.amount;
      });
    });

    const tabularConstraints = this.extractTabularConstraints(tabularRows, labelToVariable);
    tabularConstraints.forEach((constraint) => {
      const key = this.normalizeLabel(constraint.resource);
      if (!resourceCoefficients.has(key)) {
        resourceCoefficients.set(key, {});
      }

      resourceCoefficients.set(key, {
        ...(resourceCoefficients.get(key) || {}),
        ...constraint.coefficients
      });
    });

    const constraints: ParsedLpProblem["constraints"] = [];
    const variableBounds: NonNullable<ParsedLpProblem["variable_bounds"]> = {};
    const variables = new Set<string>(Object.keys(objectiveCoefficients));

    variables.forEach((variable) => {
      variableBounds[variable] = { lower: 0, upper: null };
    });

    let constraintIndex = 1;
    tabularConstraints.forEach((constraint) => {
      constraints.push({
        coefficients: constraint.coefficients,
        operator: constraint.operator,
        rhs: constraint.rhs,
        label: `c${constraintIndex++}`
      });

      Object.keys(constraint.coefficients).forEach((name) => {
        variables.add(name);
      });
    });

    const capacities = this.extractNarrativeCapacities(problemText);
    capacities.forEach((capacity) => {
      const coefficients = resourceCoefficients.get(this.normalizeLabel(capacity.resource));
      if (!coefficients || !Object.keys(coefficients).length) {
        return;
      }

      constraints.push({
        coefficients,
        operator: capacity.operator,
        rhs: capacity.value,
        label: `c${constraintIndex++}`
      });
    });

    const variableLevelBounds = this.extractNarrativeVariableBounds(problemText);
    variableLevelBounds.forEach((bound) => {
      const variable = this.resolveVariableName(bound.label, labelToVariable);
      if (!variable) {
        return;
      }

      constraints.push({
        coefficients: { [variable]: 1 },
        operator: bound.operator,
        rhs: bound.value,
        label: `c${constraintIndex++}`
      });

      if (bound.operator === ">=") {
        variableBounds[variable].lower = bound.value;
      }
      if (bound.operator === "<=") {
        variableBounds[variable].upper = bound.value;
      }
      if (bound.operator === "=") {
        variableBounds[variable].lower = bound.value;
        variableBounds[variable].upper = bound.value;
      }
    });

    const explicitConstraints = this.extractExplicitConstraints(problemText);
    explicitConstraints.forEach((constraint) => {
      constraints.push({
        ...constraint,
        label: `c${constraintIndex++}`
      });

      Object.keys(constraint.coefficients).forEach((name) => {
        variables.add(name);
      });

      const variableNames = Object.keys(constraint.coefficients);
      if (variableNames.length === 1) {
        const varName = variableNames[0];
        const coeff = constraint.coefficients[varName];

        if (!variableBounds[varName]) {
          variableBounds[varName] = { lower: 0, upper: null };
        }

        if (coeff === 1 || coeff === -1) {
          const normalizedRhs = coeff === 1 ? constraint.rhs : -constraint.rhs;
          const normalizedOperator =
            coeff === 1
              ? constraint.operator
              : constraint.operator === ">="
                ? "<="
                : constraint.operator === "<="
                  ? ">="
                  : "=";

          if (normalizedOperator === ">=") {
            variableBounds[varName].lower = normalizedRhs;
          }
          if (normalizedOperator === "<=") {
            variableBounds[varName].upper = normalizedRhs;
          }
          if (normalizedOperator === "=") {
            variableBounds[varName].lower = normalizedRhs;
            variableBounds[varName].upper = normalizedRhs;
          }
        }
      }
    });

    if (!constraints.length) {
      return null;
    }

    const sense = this.inferNarrativeSense(problemText);

    return {
      title: null,
      objective: {
        coefficients: objectiveCoefficients,
        sense
      },
      constraints,
      variables: [...variables],
      variable_bounds: variableBounds
    };
  }

  private extractNarrativeObjective(
    problemText: string,
    tabularRows: Array<{ label: string; terms: Record<string, number>; bound: string | null }>
  ): Array<{ label: string; value: number }> {
    const entries: Array<{ label: string; value: number }> = [];
    const byLabel = new Map<string, { label: string; value: number }>();

    const generatedRegex =
      /each\s+([a-z][a-z\s-]*?)\s+employee\s+generates?[^\d-]*(-?\d+(?:\.\d+)?)/gi;

    for (const match of problemText.matchAll(generatedRegex)) {
      const label = (match[1] || "").trim();
      const value = Number.parseFloat(match[2] || "");

      if (!label || !Number.isFinite(value)) {
        continue;
      }

      byLabel.set(this.normalizeLabel(label), { label, value });
    }

    const profitRegex =
      /(?:^|\n|,|\.|;|:)\s*(?:[\-*]\s*)?([a-z][a-z\s-]*?)\s+(?:employee\s+)?(?:profit|revenue|gain|return|cost)\s*=\s*(-?\d+(?:\.\d+)?)/gi;

    for (const match of problemText.matchAll(profitRegex)) {
      const label = (match[1] || "").trim();
      const value = Number.parseFloat(match[2] || "");

      if (!label || !Number.isFinite(value)) {
        continue;
      }

      byLabel.set(this.normalizeLabel(label), { label, value });
    }

    const objectiveRow = tabularRows.find((row) =>
      /\b(profit|revenue|gain|return|cost|objective)\b/i.test(row.label)
    );

    if (objectiveRow) {
      Object.entries(objectiveRow.terms).forEach(([label, value]) => {
        byLabel.set(this.normalizeLabel(label), { label, value });
      });
    }

    const sectionRegex =
      /(?:^|\n)\s*(profit|revenue|gain|return|cost|objective)\s*:\s*([\s\S]*?)(?=\n\s*(?:constraints?|subject\s*to|sous\s+les\s+contraintes|formulate|provide|solve)\b|$)/i;
    const sectionMatch = problemText.match(sectionRegex);

    if (sectionMatch?.[2]) {
      const sectionAssignments = this.extractVariableAssignments(sectionMatch[2]);
      Object.entries(sectionAssignments).forEach(([label, value]) => {
        byLabel.set(this.normalizeLabel(label), { label, value });
      });
    }

    byLabel.forEach((entry) => entries.push(entry));
    return entries;
  }

  private extractTabularRows(
    problemText: string
  ): Array<{ label: string; terms: Record<string, number>; bound: string | null }> {
    const rows: Array<{ label: string; terms: Record<string, number>; bound: string | null }> =
      [];

    const lines = problemText
      .split(/\n+/)
      .map((line) => line.replace(/^\s*[\-*\u2022]\s*/, "").trim())
      .filter(Boolean);

    for (const line of lines) {
      const lineMatch = line.match(/^([a-zA-Z][a-zA-Z\s-]*):\s*(.+)$/);
      if (!lineMatch) {
        continue;
      }

      const [, labelRaw, restRaw] = lineMatch;
      const terms = this.extractVariableAssignments(restRaw);
      if (!Object.keys(terms).length) {
        continue;
      }

      rows.push({
        label: labelRaw.trim(),
        terms,
        bound: this.extractBoundClause(restRaw)
      });
    }

    return rows;
  }

  private extractVariableAssignments(text: string): Record<string, number> {
    const assignments: Record<string, number> = {};
    const regex = /([a-zA-Z][a-zA-Z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)/g;

    for (const match of text.matchAll(regex)) {
      const name = (match[1] || "").trim().toLowerCase();
      const value = Number.parseFloat(match[2] || "");
      if (!name || !Number.isFinite(value)) {
        continue;
      }

      assignments[name] = value;
    }

    return assignments;
  }

  private extractBoundClause(text: string): string | null {
    const boundMatch = text.match(/\(([^)]*)\)/);
    return boundMatch?.[1]?.trim() || null;
  }

  private extractTabularConstraints(
    rows: Array<{ label: string; terms: Record<string, number>; bound: string | null }>,
    labelToVariable: Map<string, string>
  ): Array<{ resource: string; coefficients: Record<string, number>; operator: "<=" | ">=" | "="; rhs: number }> {
    const constraints: Array<{
      resource: string;
      coefficients: Record<string, number>;
      operator: "<=" | ">=" | "=";
      rhs: number;
    }> = [];

    for (const row of rows) {
      if (!row.bound) {
        continue;
      }

      if (/\b(profit|revenue|gain|return|cost|objective)\b/i.test(row.label)) {
        continue;
      }

      const boundMatch = row.bound.match(
        /(?:max(?:imum)?|at\s+most|no\s+more\s+than|min(?:imum)?|at\s+least|exactly|equal\s+to)\s*(-?\d+(?:\.\d+)?)/i
      );
      if (!boundMatch) {
        continue;
      }

      const rhs = Number.parseFloat(boundMatch[1] || "");
      if (!Number.isFinite(rhs)) {
        continue;
      }

      let operator: "<=" | ">=" | "=" = "=";
      if (/\b(max(?:imum)?|at\s+most|no\s+more\s+than)\b/i.test(row.bound)) {
        operator = "<=";
      } else if (/\b(min(?:imum)?|at\s+least)\b/i.test(row.bound)) {
        operator = ">=";
      }

      const coefficients: Record<string, number> = {};
      Object.entries(row.terms).forEach(([name, value]) => {
        const variable = this.resolveVariableName(name, labelToVariable) || name;
        coefficients[variable] = value;
      });

      constraints.push({
        resource: row.label,
        coefficients,
        operator,
        rhs
      });
    }

    return constraints;
  }

  private extractDeclaredVariables(problemText: string): Map<string, string> {
    const mapping = new Map<string, string>();
    const regex = /([a-z][a-z\s-]*?)\s*\(\s*([a-z][a-z0-9_]*)\s*\)/gi;

    for (const match of problemText.matchAll(regex)) {
      const label = (match[1] || "").trim();
      const variable = (match[2] || "").trim();

      if (!label || !variable) {
        continue;
      }

      mapping.set(this.normalizeLabel(label), variable.toLowerCase());
    }

    return mapping;
  }

  private resolveFromDeclaredVariables(
    label: string,
    declaredVariables: Map<string, string>
  ): string | null {
    const normalized = this.normalizeLabel(label);

    if (declaredVariables.has(normalized)) {
      return declaredVariables.get(normalized) || null;
    }

    const singular = normalized.replace(/s$/, "");
    if (declaredVariables.has(singular)) {
      return declaredVariables.get(singular) || null;
    }

    for (const [key, variable] of declaredVariables.entries()) {
      const keySingular = key.replace(/s$/, "");
      if (
        normalized.includes(key) ||
        key.includes(normalized) ||
        singular === key ||
        singular === keySingular ||
        keySingular === normalized
      ) {
        return variable;
      }
    }

    return null;
  }

  private extractExplicitConstraints(
    problemText: string
  ): Array<{ coefficients: Record<string, number>; operator: "<=" | ">=" | "="; rhs: number }> {
    const constraints: Array<{
      coefficients: Record<string, number>;
      operator: "<=" | ">=" | "=";
      rhs: number;
    }> = [];

    const segments = problemText
      .split(/\n+/)
      .flatMap((line) => line.split(/[\.,]/))
      .map((line) => line.replace(/^\s*[\-*\u2022]\s*/, "").trim())
      .filter(Boolean);

    for (const segment of segments) {
      if (/\b(profit|revenue|gain|return|cost)\b\s*=\s*/i.test(segment)) {
        continue;
      }

      const candidate = segment.includes(":") ? segment.split(":").slice(1).join(":").trim() : segment;
      const parts = candidate.match(/^(.+?)(<=|>=|=)(.+)$/);
      if (!parts) {
        continue;
      }

      const [, leftExpression, operator, rhsRaw] = parts;
      if (operator === "=" && !/[+\-*]/.test(leftExpression)) {
        continue;
      }

      const coefficients = this.parseLinearExpression(leftExpression);
      const rhsMatch = rhsRaw.trim().match(/^-?\d+(?:\.\d+)?/);
      const rhs = rhsMatch ? Number.parseFloat(rhsMatch[0]) : Number.NaN;

      if (!Number.isFinite(rhs)) {
        continue;
      }

      constraints.push({
        coefficients,
        operator: operator as "<=" | ">=" | "=",
        rhs
      });
    }

    return constraints;
  }

  private extractNarrativeRequirements(
    problemText: string
  ): Array<{ label: string; resources: Array<{ name: string; amount: number }> }> {
    const entries: Array<{ label: string; resources: Array<{ name: string; amount: number }> }> =
      [];
    const regex = /each\s+([a-z][a-z\s-]*?)\s+employee\s+requires?\s+([^\.\n]+)/gi;

    for (const match of problemText.matchAll(regex)) {
      const label = (match[1] || "").trim();
      const details = (match[2] || "").trim();
      if (!label || !details) {
        continue;
      }

      const resources = this.extractResourceTerms(details);
      if (!resources.length) {
        continue;
      }

      entries.push({ label, resources });
    }

    return entries;
  }

  private extractNarrativeCapacities(
    problemText: string
  ): Array<{ resource: string; operator: "<=" | ">=" | "="; value: number }> {
    const capacities: Array<{ resource: string; operator: "<=" | ">=" | "="; value: number }> =
      [];
    const segments = problemText
      .split(/\n+/)
      .flatMap((line) => line.split(/\.(?:\s+|$)/))
      .map((line) => line.trim())
      .filter(Boolean);

    for (const segment of segments) {
      const lower = segment.toLowerCase();
      let operator: "<=" | ">=" | "=" | null = null;

      if (/\bat\s+most\b|\bno\s+more\s+than\b|\bmaximum\b/.test(lower)) {
        operator = "<=";
      } else if (/\bat\s+least\b|\bminimum\b/.test(lower)) {
        operator = ">=";
      } else if (/\bexactly\b|\bequal\s+to\b/.test(lower)) {
        operator = "=";
      }

      if (!operator || /\bin\b\s+[a-z]/i.test(segment)) {
        continue;
      }

      const resources = this.extractResourceTerms(segment);
      resources.forEach((resource) => {
        capacities.push({
          resource: resource.name,
          operator,
          value: resource.amount
        });
      });
    }

    return capacities;
  }

  private extractNarrativeVariableBounds(
    problemText: string
  ): Array<{ label: string; operator: "<=" | ">=" | "="; value: number }> {
    const bounds: Array<{ label: string; operator: "<=" | ">=" | "="; value: number }> = [];
    const patterns: Array<{ regex: RegExp; operator: "<=" | ">=" | "=" }> = [
      {
        regex:
          /(?:at\s+least|minimum\s+of)\s+(\d+(?:\.\d+)?)\s+(?:employees?\s+)?(?:in|for|of)\s+([a-z][a-z\s-]*)/gi,
        operator: ">="
      },
      {
        regex:
          /(?:at\s+most|maximum\s+of|no\s+more\s+than)\s+(\d+(?:\.\d+)?)\s+(?:employees?\s+)?(?:in|for|of)\s+([a-z][a-z\s-]*)/gi,
        operator: "<="
      },
      {
        regex:
          /(?:exactly|equal\s+to)\s+(\d+(?:\.\d+)?)\s+(?:employees?\s+)?(?:in|for|of)\s+([a-z][a-z\s-]*)/gi,
        operator: "="
      },
      {
        regex:
          /(?:at\s+least|minimum\s+of)\s+(\d+(?:\.\d+)?)\s+(?:units?\s+of\s+)?(?:product\s+)?([a-z][a-z0-9_]*)/gi,
        operator: ">="
      },
      {
        regex:
          /(?:at\s+most|maximum\s+of|no\s+more\s+than)\s+(\d+(?:\.\d+)?)\s+(?:units?\s+of\s+)?(?:product\s+)?([a-z][a-z0-9_]*)/gi,
        operator: "<="
      },
      {
        regex:
          /(?:exactly|equal\s+to)\s+(\d+(?:\.\d+)?)\s+(?:units?\s+of\s+)?(?:product\s+)?([a-z][a-z0-9_]*)/gi,
        operator: "="
      }
    ];

    patterns.forEach(({ regex, operator }) => {
      for (const match of problemText.matchAll(regex)) {
        const value = Number.parseFloat(match[1] || "");
        const label = (match[2] || "").replace(/[\.,;:]+$/g, "").trim();
        if (!label || !Number.isFinite(value)) {
          continue;
        }

        bounds.push({ label, operator, value });
      }
    });

    return bounds;
  }

  private extractResourceTerms(text: string): Array<{ name: string; amount: number }> {
    const resources: Array<{ name: string; amount: number }> = [];
    const regex =
      /(\d+(?:\.\d+)?)\s*(?:hours?|units?)?\s*of\s+([a-z][a-z\s-]*?)(?=\s*(?:,|and|$|available|required|per\s+day))/gi;

    for (const match of text.matchAll(regex)) {
      const amount = Number.parseFloat(match[1] || "");
      const name = (match[2] || "").trim();
      if (!name || !Number.isFinite(amount)) {
        continue;
      }

      resources.push({ name, amount });
    }

    return resources;
  }

  private inferNarrativeSense(problemText: string): "minimize" | "maximize" {
    const lower = problemText.toLowerCase();

    if (/\bmaximize|maximiser|maximization|maximisation\b/.test(lower)) {
      return "maximize";
    }

    if (/\bminimize|minimiser|minimization|minimisation\b/.test(lower)) {
      return "minimize";
    }

    if (/\b(profit|revenue|gain|return)\b/.test(lower)) {
      return "maximize";
    }

    if (/\b(cost|expense|penalty)\b/.test(lower)) {
      return "minimize";
    }

    return "maximize";
  }

  private normalizeLabel(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  private toVariableName(label: string, fallbackIndex: number): string {
    const normalized = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_");

    return normalized || `x${fallbackIndex}`;
  }

  private resolveVariableName(label: string, labelToVariable: Map<string, string>): string | null {
    const normalized = this.normalizeLabel(label);
    if (labelToVariable.has(normalized)) {
      return labelToVariable.get(normalized) || null;
    }

    for (const [candidate, variable] of labelToVariable.entries()) {
      if (normalized.includes(candidate) || candidate.includes(normalized)) {
        return variable;
      }
    }

    return null;
  }

  private normalizeProblemText(input: string): string {
    return input
      .replace(/[\u00A0]/g, " ")
      .replace(/[\u2022\u25CF\u25AA\u2023]/g, "\n")
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
      const normalizedVariable = variable.toLowerCase();
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

      coefficients[normalizedVariable] = (coefficients[normalizedVariable] || 0) + coefficient;
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