import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as express from 'express';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';

// Safety net: Prisma returns BigInt for our bigserial ids, and
// JSON.stringify throws on BigInt by default. Every handler is expected to
// convert ids to strings explicitly (precision loss otherwise), but this
// catches anything missed rather than 500ing the whole response.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  // bodyParser disabled at bootstrap so we can capture the raw bytes below —
  // webhook signature verification (Flutterwave/Cloudflare) needs the exact
  // wire bytes, not a re-serialized JSON.parse(...) round-trip.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // multer's diskStorage doesn't create its destination directory itself.
  fs.mkdirSync(path.join(process.cwd(), 'uploads', 'logos'), { recursive: true });
  fs.mkdirSync(path.join(process.cwd(), 'uploads', 'images'), { recursive: true });
  fs.mkdirSync(path.join(process.cwd(), 'uploads', 'backgrounds'), { recursive: true });
  app.useStaticAssets(path.join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  // Media dropped in over SFTP and published by muza-publish-uploads.sh.
  // Served read-only so an uploaded file has a direct, importable URL:
  //   https://ham.sentepos.com/api/media/<file>
  const mediaDir = process.env.MEDIA_PUBLIC_DIR ?? '/srv/muza-media';
  if (fs.existsSync(mediaDir)) {
    app.useStaticAssets(mediaDir, { prefix: '/media' });
  }

  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  // Form-encoded bodies — payment IPNs (e.g. Yo! Payments) post
  // application/x-www-form-urlencoded, which express.json() won't parse.
  app.use(
    express.urlencoded({
      extended: true,
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  app.setGlobalPrefix('v1');

  // OpenAPI / Swagger — UI at /v1/docs, JSON at /v1/docs-json. The @nestjs/
  // swagger CLI plugin (nest-cli.json) auto-derives schemas from the DTOs.
  const swaggerCfg = new DocumentBuilder()
    .setTitle('ham / ugstream API')
    .setDescription('Streaming platform API — auth, catalogue, playback, payments.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('v1/docs', app, SwaggerModule.createDocument(app, swaggerCfg));

  const port = process.env.PORT ?? 4001;
  await app.listen(port);
  new Logger('Bootstrap').log(`ugstream backend listening on :${port}`);
}

bootstrap();
