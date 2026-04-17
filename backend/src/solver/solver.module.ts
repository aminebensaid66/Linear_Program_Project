import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { SolverService } from "./solver.service";

@Module({
  imports: [HttpModule],
  providers: [SolverService],
  exports: [SolverService]
})
export class SolverModule {}