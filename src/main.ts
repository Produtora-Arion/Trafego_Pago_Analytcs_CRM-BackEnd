import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { McpService } from './mcp/mcp.service';

async function bootstrap() {
  const mode = process.env.SERVER_MODE || 'mcp';

  if (mode === 'http') {
    const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
    app.enableCors();
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
