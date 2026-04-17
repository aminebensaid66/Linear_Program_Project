import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix("api");

  app.enableCors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true
  });

  const port = Number(process.env.PORT || 3000);
  await app.listen(port);

  new Logger("Bootstrap").log(`Backend listening on http://localhost:${port}/api`);
}

void bootstrap();