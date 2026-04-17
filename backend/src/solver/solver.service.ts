import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import type { ParsedLpProblem } from "../lp/interfaces/lp-problem.interface";
import type { LpSolverResult } from "../lp/interfaces/lp-solver-result.interface";

@Injectable()
export class SolverService {
  private readonly logger = new Logger(SolverService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService
  ) {}

  async solve(problem: ParsedLpProblem): Promise<LpSolverResult> {
    const baseUrl = this.getSolverUrl();
    const url = `${baseUrl}/solve/`;

    const response = await firstValueFrom(this.httpService.post<LpSolverResult>(url, problem));
    return response.data;
  }

  async health(): Promise<boolean> {
    const baseUrl = this.getSolverUrl();
    const url = `${baseUrl}/solve/health`;

    try {
      await firstValueFrom(this.httpService.get(url));
      return true;
    } catch (error) {
      this.logger.warn(`Python solver health check failed: ${(error as Error).message}`);
      return false;
    }
  }

  private getSolverUrl(): string {
    const configured = this.configService.get<string>("PYTHON_SOLVER_URL") || "http://localhost:8000";
    return configured.replace(/\/$/, "");
  }
}