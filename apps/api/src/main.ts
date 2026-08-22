import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { getEnv } from './config/env';
import { AuthService } from './auth/auth.service';
import { MulterExceptionFilter } from './common/multer-errors';
import { ZodExceptionFilter } from './common/zod-exception.filter';

async function bootstrap() {
  const env = getEnv();
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalFilters(new MulterExceptionFilter(), new ZodExceptionFilter());
  const webOrigins = env.WEB_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({
    origin: webOrigins.length === 1 ? webOrigins[0] : webOrigins,
    credentials: true,
  });

  try {
    await app.get(AuthService).ensureSeedAdmin();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Seed admin skipped (DB not reachable yet).', err);
  }

  const port = Number(process.env.PORT) || env.PORT;
  await app.listen(port, '0.0.0.0');
  console.log(`Designs CRM API listening on ${port}`);
}

bootstrap().catch((err) => {
  console.error('API failed to start', err);
  process.exit(1);
});
