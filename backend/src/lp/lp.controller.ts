import { Body, Controller, Get, Post } from "@nestjs/common";
import { SolveLpDto } from "./dto/solve-lp.dto";
import type { LpResponse } from "./interfaces/lp-response.interface";
import { LpService } from "./lp.service";

@Controller("lp")
export class LpController {
  constructor(private readonly lpService: LpService) {}

  @Post("solve")
  async solve(@Body() payload: SolveLpDto): Promise<LpResponse> {
    return this.lpService.solveFromText(payload.problem);
  }

  @Get("health")
  async health(): Promise<{ status: string; solver: string }> {
    return this.lpService.health();
  }
}