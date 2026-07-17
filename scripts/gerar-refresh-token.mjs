// Roda com: node scripts/gerar-refresh-token.mjs
import http from 'http';
import { exec } from 'child_process';
import { URL } from 'url';

const CLIENT_ID = '249426834238-tbakca0rd02sj0rgnh4prvdsbm19vgdm.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const REDIRECT_URI = 'http://localhost:4242/callback';
const SCOPE = 'https://www.googleapis.com/auth/adwords';

const authUrl =
  `https://accounts.google.com/o/oauth2/auth` +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&scope=${encodeURIComponent(SCOPE)}` +
  `&response_type=code` +
  `&access_type=offline` +
  `&prompt=consent`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:4242');
  if (url.pathname !== '/callback') return;

  const code = url.searchParams.get('code');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h2 style="font-family:sans-serif;text-align:center;margin-top:60px">✅ Autenticado! Pode fechar esta aba.</h2>');
  server.close();

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  const data = await tokenRes.json();

  if (data.refresh_token) {
    console.log('\n✅ REFRESH TOKEN GERADO COM SUCESSO:\n');
    console.log(data.refresh_token);
    console.log('\nCopie o token acima e cole no .env como GOOGLE_REFRESH_TOKEN=...\n');
  } else {
    console.error('\n❌ Erro ao obter token:', data);
  }
});

server.listen(4242, () => {
  console.log('Abrindo navegador para login Google...');
  exec(`start "" "${authUrl}"`);
});
