/**
 * Setup único de autenticação OAuth do Mercado Livre.
 *
 * Uso (rodar UMA VEZ na VM, dentro da pasta do projeto):
 *   node src/mlAuthSetup.js
 *
 * Não precisa de servidor local nem túnel SSH: usamos como redirect_uri uma
 * URL https já existente (o próprio mercadolivre.com.br), então depois de
 * autorizar você só precisa copiar o "code" que aparece na barra de
 * endereço do navegador e colar aqui no terminal.
 */
const readline = require('readline');
const config = require('./config');
const logger = require('./logger');
const mlOAuth = require('./lib/mlOAuth');

function extractCode(input) {
  const trimmed = input.trim();
  // Se a pessoa colar a URL inteira, extraímos o parâmetro "code".
  if (trimmed.includes('code=')) {
    try {
      const url = new URL(trimmed.includes('://') ? trimmed : `https://x.com/${trimmed}`);
      const code = url.searchParams.get('code');
      if (code) return code;
    } catch (err) {
      // ignora e tenta extrair na marra abaixo
    }
    const match = trimmed.match(/[?&]code=([^&\s]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  // Senão, assume que ela colou só o código mesmo.
  return trimmed;
}

(async () => {
  if (!config.mercadoLivre.clientId || !config.mercadoLivre.clientSecret) {
    logger.error('[MLAuthSetup] ML_CLIENT_ID/ML_CLIENT_SECRET não configurados no .env. Abortando.');
    process.exit(1);
  }

  console.log('==============================================================');
  console.log('1) Confirme que este redirect_uri está cadastrado no seu app em');
  console.log('   developers.mercadolivre.com.br (Configuração e scopes):');
  console.log(`   ${config.mercadoLivre.redirectUri}`);
  console.log('');
  console.log('2) Abra esta URL no SEU navegador e faça login/autorize o app:');
  console.log('');
  console.log(mlOAuth.getAuthorizationUrl());
  console.log('');
  console.log('3) Depois de autorizar, você será redirecionada para uma página do');
  console.log('   Mercado Livre com "?code=TG-....." na barra de endereço.');
  console.log('   Copie a URL inteira (ou só o valor depois de "code=") e cole abaixo.');
  console.log('==============================================================');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question('\nCole aqui a URL ou o código: ', resolve));
  rl.close();

  const code = extractCode(answer);
  if (!code) {
    logger.error('[MLAuthSetup] Não consegui identificar o código na entrada informada.');
    process.exit(1);
  }

  try {
    await mlOAuth.exchangeCodeForTokens(code);
    logger.info('[MLAuthSetup] Autorização concluída com sucesso! Token salvo em ' + config.mercadoLivre.tokenFile);
    process.exit(0);
  } catch (err) {
    logger.error(
      { err: err.response?.data || err.message },
      '[MLAuthSetup] Falha ao trocar o código por token. Confirme se o código não expirou (é de uso único e rápido) e tente de novo.'
    );
    process.exit(1);
  }
})();
