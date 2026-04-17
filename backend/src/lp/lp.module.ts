import { Module } from "@nestjs/common";
import { LlmModule } from "../llm/llm.module";
import { SolverModule } from "../solver/solver.module";
import { LpController } from "./lp.controller";
import { LpService } from "./lp.service";

@Module({
  imports: [LlmModule, SolverModule],
  controllers: [LpController],
  providers: [LpService]
})
export class LpModule {}