import 'reflect-metadata';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { McpService } from './mcp/mcp.service';

async function bootstrap() {
  const mode = process.env.SERVER_MODE || 'mcp';

  if (mode === 'http') {
    const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn'],
      rawBody: true, // expõe req.rawBody para validar a assinatura HMAC da Meta
    });

    // Confia no proxy (Render/Vercel) para obter o IP real do cliente —
    // necessário para o rate limit contar por IP corretamente.
    app.getHttpAdapter().getInstance().set('trust proxy', 1);

    // Headers de segurança (HSTS, anti-clickjacking, no-sniff, etc.)
    app.use(helmet());

    // Valida e sanitiza o corpo de toda requisição contra os DTOs (class-validator).
    // whitelist remove campos não declarados no DTO (fecha mass-assignment);
    // rotas com @Body() tipado como `any`/objeto solto (webhooks) não são afetadas —
    // o pipe só atua em parâmetros com um tipo de classe real.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

    // CORS restrito às origens autorizadas (frontend). Nunca "*" com credenciais.
    const allowed = (process.env.FRONTEND_URL || 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    app.enableCors({
      // Reflete apenas origens autorizadas (dashboard). Origens desconhecidas
      // não recebem header CORS — o navegador bloqueia respostas da API para elas.
      // Não lançamos erro para não quebrar o webhook público, que define o
      // próprio Access-Control-Allow-Origin nos handlers.
      origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    });

    const port = process.env.PORT || 3001;
    await app.listen(port);
    process.stderr.write(`API rodando na porta ${port}\n`);
  } else {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const mcpService = app.get(McpService);
    await mcpService.start();
  }
}

bootstrap().catch((err) => {
  process.stderr.write(`Erro ao iniciar: ${err.message}\n`);
  process.exit(1);
});
