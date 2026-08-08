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
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  });

  try {
    await app.get(AuthService).ensureSeedAdmin();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Seed admin skipped (DB not reachable yet).', err);
  }

  await app.listen(env.PORT);
}
bootstrap();
