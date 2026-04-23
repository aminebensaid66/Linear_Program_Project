import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import { z } from "zod";
import type { ParsedLpProblem } from "../lp/interfaces/lp-problem.interface";
import type { LpSolverResult } from "../lp/interfaces/lp-solver-result.interface";

const parsedProblemSchema = z.object({
  title: z.string().nullable().default(null),
  objective: z.object({
    coefficients: z.record(z.number()),
    sense: z.enum(["minimize", "maximize"])
  }),
  constraints: z
    .array(
      z.object({
        coefficients: z.record(z.number()),
        operator: z.enum(["<=", ">=", "="]),
        rhs: z.number(),
        label: z.string().nullable().optional()
      })
    )
    .min(1),
  variables: z.array(z.string().min(1)).min(1),
  variable_bounds: z
    .record(
      z.object({
        lower: z.number().nullable().optional(),
        upper: z.number().nullable().optional()
      })
    )
    .nullable()
    .optional()
});

type ExplainInput = {
  originalProblem: string;
  parsedProblem: ParsedLpProblem;
  solverResult: LpSolverResult;
};

type LlmProvider = "google" | "deepseek";

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: OpenAI;
  private readonly parseModel: string;
  private readonly explainModel: string;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(private readonly configService: ConfigService) {
    const providerFromEnv = (this.configService.get<string>("LLM_PROVIDER") || "").toLowerCase();
    const googleApiKey = this.configService.get<string>("GOOGLE_API_KEY");
    const deepseekApiKey = this.configService.get<string>("DEEPSEEK_API_KEY");
    const genericApiKey = this.configService.get<string>("LLM_API_KEY");
    const discoveredKey = googleApiKey || deepseekApiKey || genericApiKey;

    if (!discoveredKey) {
      throw new Error(
        "No LLM API key found. Set GOOGLE_API_KEY or DEEPSEEK_API_KEY (or LLM_API_KEY)."
      );
    }

    const useGoogle =
      providerFromEnv === "google" ||
      providerFromEnv === "gemini" ||
      (!providerFromEnv && discoveredKey.startsWith("AIza"));

    const provider: LlmProvider = useGoogle ? "google" : "deepseek";

    let apiKey = discoveredKey;
    let baseURL = "https://api.deepseek.com";

    if (provider === "google") {
      apiKey = googleApiKey || genericApiKey || deepseekApiKey || discoveredKey;
      baseURL =
        this.configService.get<string>("GOOGLE_BASE_URL") ||
        this.configService.get<string>("LLM_BASE_URL") ||
        "https://generativelanguage.googleapis.com/v1beta/openai";

      this.parseModel =
        this.configService.get<string>("GOOGLE_MODEL_PARSE") ||
        this.configService.get<string>("LLM_MODEL_PARSE") ||
        "gemini-2.0-flash";

      this.explainModel =
        this.configService.get<string>("GOOGLE_MODEL_EXPLAIN") ||
        this.configService.get<string>("LLM_MODEL_EXPLAIN") ||
        "gemini-2.0-flash";
    } else {
      apiKey = deepseekApiKey || genericApiKey || googleApiKey || discoveredKey;
      baseURL =
        this.configService.get<string>("DEEPSEEK_BASE_URL") ||
        this.configService.get<string>("LLM_BASE_URL") ||
        "https://api.deepseek.com";

      this.parseModel =
        this.configService.get<string>("DEEPSEEK_MODEL_PARSE") ||
        this.configService.get<string>("LLM_MODEL_PARSE") ||
        "deepseek-chat";

      this.explainModel =
        this.configService.get<string>("DEEPSEEK_MODEL_EXPLAIN") ||
        this.configService.get<string>("LLM_MODEL_EXPLAIN") ||
        "deepseek-chat";
    }

    this.logger.log(`LLM provider configured: ${provider}`);

    this.maxRetries = Number(this.configService.get<string>("LLM_MAX_RETRIES") || 3);
    this.retryBaseMs = Number(this.configService.get<string>("LLM_RETRY_BASE_MS") || 1200);

    this.client = new OpenAI({
      apiKey,
      baseURL
    });
  }

  async parseProblem(problemText: string): Promise<ParsedLpProblem> {
    const completion = await this.createCompletionWithRetry({
      model: this.parseModel,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are an Operations Research parser. Convert linear programming text into strict JSON only. " +
            "No markdown, no comments. Output exactly one JSON object with keys: title, objective, constraints, variables, variable_bounds. " +
            "objective.sense must be minimize or maximize. constraints.operator must be <=, >=, or =. " +
            "If user gives a narrative formulation request (not explicit equations), infer objective from business context " +
            "(profit/revenue => maximize, cost/time/penalty => minimize), define decision variables, and translate all numeric conditions to linear constraints."
        },
        {
          role: "user",
          content: `Problem:\n${problemText}`
        }
      ]
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("LLM parser returned an empty response");
    }

    const parsedJson = this.extractJson(content);
    const normalized = parsedProblemSchema.parse(parsedJson);

    return {
      title: normalized.title,
      objective: normalized.objective,
      constraints: normalized.constraints,
      variables: [...new Set(normalized.variables)],
      variable_bounds: normalized.variable_bounds ?? null
    };
  }

  async explainSolution(input: ExplainInput): Promise<string> {
    const completion = await this.createCompletionWithRetry({
      model: this.explainModel,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are an OR teaching assistant. Explain LP solutions clearly and briefly. " +
            "If the original problem is French, answer in French. If English, answer in English. " +
            "Use short markdown sections: interpretation, result, and recommendation."
        },
        {
          role: "user",
          content: JSON.stringify(input)
        }
      ]
    });

    const explanation = completion.choices[0]?.message?.content?.trim();
    if (!explanation) {
      this.logger.warn("LLM explanation was empty, returning fallback explanation");
      return "The model solved your LP problem, but no explanation text was returned by the LLM.";
    }

    return explanation;
  }

  private extractJson(content: string): unknown {
    try {
      return JSON.parse(content);
    } catch {
      const firstBrace = content.indexOf("{");
      const lastBrace = content.lastIndexOf("}");
      if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        throw new Error("LLM parser response did not contain valid JSON");
      }

      const candidate = content.slice(firstBrace, lastBrace + 1);
      return JSON.parse(candidate);
    }
  }

  private async createCompletionWithRetry(
    request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.client.chat.completions.create(request);
      } catch (error) {
        const status = this.extractStatusCode(error);
        const canRetry = this.isRetriableStatus(status);
        const isLastAttempt = attempt >= this.maxRetries;

        if (canRetry && !isLastAttempt) {
          const delay = this.retryBaseMs * 2 ** attempt + Math.floor(Math.random() * 250);
          this.logger.warn(
            `LLM request failed with status=${status}. Retrying in ${delay}ms (${attempt + 1}/${this.maxRetries}).`
          );
          await this.sleep(delay);
          continue;
        }

        throw this.mapToHttpException(error);
      }
    }

    throw new HttpException("LLM request failed after retries", HttpStatus.BAD_GATEWAY);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private isRetriableStatus(status?: number): boolean {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  }

  private extractStatusCode(error: unknown): number | undefined {
    if (typeof error !== "object" || error === null) {
      return undefined;
    }

    if ("status" in error && typeof (error as { status?: unknown }).status === "number") {
      return (error as { status: number }).status;
    }

    return undefined;
  }

  private mapToHttpException(error: unknown): HttpException {
    const status = this.extractStatusCode(error);
    const message =
      this.extractProviderMessage(error) ||
      (error instanceof Error ? error.message : "LLM provider request failed");

    if (status === 429) {
      return new HttpException(
        "LLM provider rate limit exceeded (429). Please retry shortly or reduce request frequency.",
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    if (status === 401) {
      return new HttpException("LLM API key is invalid", HttpStatus.UNAUTHORIZED);
    }

    if (status === 402) {
      return new HttpException(
        "LLM account has insufficient balance/quota",
        HttpStatus.PAYMENT_REQUIRED
      );
    }

    if (status === 404) {
      return new HttpException(
        "LLM endpoint/model not found. Check GOOGLE_BASE_URL and model name.",
        HttpStatus.BAD_GATEWAY
      );
    }

    if (status !== undefined && status >= 500) {
      return new HttpException(`LLM provider error: ${message}`, HttpStatus.BAD_GATEWAY);
    }

    return new HttpException(`LLM request failed: ${message}`, HttpStatus.BAD_GATEWAY);
  }

  private extractProviderMessage(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null) {
      return undefined;
    }

    if (
      "error" in error &&
      typeof (error as { error?: unknown }).error === "object" &&
      (error as { error?: unknown }).error !== null &&
      "message" in ((error as { error: { message?: unknown } }).error)
    ) {
      const msg = (error as { error: { message?: unknown } }).error.message;
      if (typeof msg === "string" && msg.trim()) {
        return msg;
      }
    }

    if ("message" in error && typeof (error as { message?: unknown }).message === "string") {
      const msg = (error as { message: string }).message;
      if (msg.trim()) {
        return msg;
      }
    }

    return undefined;
  }
}