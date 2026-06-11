import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const origin = process.env.APP_ORIGIN ?? "http://localhost:5173";
  await app.register((await import("@fastify/cors")).default, { origin });

  // nestjs-zod 5.x: use cleanupOpenApiDoc (replaces patchNestjsSwagger from earlier versions)
  // so that Zod DTO classes render correctly in the OpenAPI document.
  const config = new DocumentBuilder()
    .setTitle("Meridian Backend API")
    .setDescription("NAV, baskets, feed, demo + SSE NAV stream")
    .setVersion("1.0")
    .build();
  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  SwaggerModule.setup("docs", app, document);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
}

void bootstrap();
