import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LpModule } from "./lp/lp.module";
import { LlmModule } from "./llm/llm.module";
import { SolverModule } from "./solver/solver.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../.env"]
    }),
    LlmModule,
    SolverModule,
    LpModule
  ]
})
export class AppModule {}