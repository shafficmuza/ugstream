import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';
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
  app.useStaticAssets(path.join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  app.use(
    express.json({
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

  app.setGlobalPrefix('v1');

  const port = process.env.PORT ?? 4001;
  await app.listen(port);
  console.log(`ugstream backend listening on :${port}`);
}

bootstrap();
