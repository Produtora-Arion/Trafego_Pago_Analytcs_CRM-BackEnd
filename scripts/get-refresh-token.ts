/**
 * Execute uma vez para gerar o GOOGLE_REFRESH_TOKEN.
 * Comando: npm run get-token
 *
 * O script abre o navegador automaticamente, aguarda a autorização
 * e exibe o refresh token sem precisar copiar nenhum código.
 */
import { google } from 'googleapis';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

const credentialsPath = path.join(process.cwd(), 'credentials.json');

if (!fs.existsSync(credentialsPath)) {
  console.error('ERRO: credentials.json não encontrado na raiz do projeto.');
  process.exit(1);
}

const raw = fs.readFileSync(credentialsPath, 'utf-8');
const creds = JSON.parse(raw);
const { client_id, client_secret } = creds.installed || creds.web;

const PORT = 7000;
const REDIRECT_URI = `http://localhost:${PORT}`;

const oauth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  // 'adwords': Google Ads API (campanhas, keywords, relatórios...)
  // 'datamanager': Data Manager API — upload de conversões offline (leads
  // convertidos no CRM), migrado em 2026-08 do endpoint antigo aposentado.
  scope: [
    'https://www.googleapis.com/auth/adwords',
    'https://www.googleapis.com/auth/datamanager',
  ],
  prompt: 'consent',
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>Autorização negada. Pode fechar esta janela.</h2>');
    server.close();
    console.error('\nAutorização negada pelo usuário.');
    process.exit(1);
  }

  if (!code) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>Aguardando autorização...</h2>');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <html><body style="font-family:sans-serif;padding:40px;text-align:center">
      <h2 style="color:green">✅ Autorizado com sucesso!</h2>
      <p>Pode fechar esta janela e voltar ao terminal.</p>
    </body></html>
  `);

  server.close();

  try {
    const { tokens } = await oauth2Client.getToken(code);

    console.log('\n✅ REFRESH TOKEN GERADO COM SUCESSO!\n');
    console.log('Adicione esta linha no seu arquivo .env:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } catch (err: any) {
    const msg = err?.response?.data?.error_description || err.message;
    console.error(`\nErro ao obter token: ${msg}`);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('\n=== GERAR REFRESH TOKEN ===\n');
  console.log('Abrindo navegador para autorização...');
  console.log('Caso não abra automaticamente, acesse:\n');
  console.log(authUrl);
  console.log('\nAguardando autorização...');

  // Abre o navegador no Windows
  exec(`start "" "${authUrl}"`);
});

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nERRO: A porta ${PORT} já está em uso. Feche o processo que a usa e tente novamente.`);
  } else {
    console.error('\nErro no servidor:', err.message);
  }
  process.exit(1);
});
