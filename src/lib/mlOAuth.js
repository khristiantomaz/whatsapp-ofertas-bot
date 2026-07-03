const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../config');
const logger = require('../logger');

/**
 * Cliente OAuth2 do Mercado Livre.
 *
 * O endpoint público de busca (api.mercadolibre.com/sites/MLB/search) passou
 * a exigir autenticação (confirmado em produção: bloqueio 403 direto no
 * CloudFront, header `x-api-server-segment: legacy`). Este módulo cuida de
 * obter/renovar o access_token usando o App (ML_CLIENT_ID/ML_CLIENT_SECRET)
 * cadastrado em developers.mercadolivre.com.br.
 *
 * Fluxo (feito uma única vez, veja src/mlAuthSetup.js):
 *   1. Usuário visita a URL de autorização e faz login/aceita o app.
 *   2. Mercado Livre redireciona para ML_REDIRECT_URI com ?code=...
 *   3. Trocamos esse code por access_token + refresh_token.
 *   4. Os tokens ficam salvos em data/ml_token.json. A partir daí,
 *      getValidAccessToken() renova sozinho quando necessário.
 */

const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const AUTH_URL = 'https://auth.mercadolivre.com.br/authorization';

function tokenStorePath() {
  return path.resolve(config.mercadoLivre.tokenFile);
}

function loadTokenStore() {
  const file = tokenStorePath();
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    logger.warn({ err: err.message }, '[MLOAuth] Não foi possível ler o arquivo de token, ignorando.');
    return null;
  }
}

function saveTokenStore(tokens) {
  const file = tokenStorePath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const record = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    // expires_in vem em segundos; guardamos o timestamp absoluto de expiração
    // com uma margem de segurança de 5 minutos.
    expires_at: Date.now() + (tokens.expires_in - 300) * 1000,
    obtained_at: Date.now(),
  };
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  return record;
}

function getAuthorizationUrl() {
  const { clientId, redirectUri } = config.mercadoLivre;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret, redirectUri } = config.mercadoLivre;
  const { data } = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return saveTokenStore(data);
}

async function refreshTokens(refreshToken) {
  const { clientId, clientSecret } = config.mercadoLivre;
  const { data } = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  // O Mercado Livre normalmente devolve um novo refresh_token a cada troca —
  // sempre sobrescrevemos com o mais recente.
  return saveTokenStore(data);
}

/**
 * Retorna um access_token válido, renovando via refresh_token se necessário.
 * Retorna null se ainda não houver nenhum token salvo (setup não foi feito).
 */
async function getValidAccessToken() {
  let store = loadTokenStore();

  if (!store) {
    logger.warn(
      '[MLOAuth] Nenhum token salvo ainda. Rode "node src/mlAuthSetup.js" para autorizar o app do Mercado Livre.'
    );
    return null;
  }

  if (Date.now() < store.expires_at) {
    return store.access_token;
  }

  try {
    logger.info('[MLOAuth] access_token expirado, renovando via refresh_token...');
    store = await refreshTokens(store.refresh_token);
    return store.access_token;
  } catch (err) {
    logger.error(
      { err: err.response?.data || err.message },
      '[MLOAuth] Falha ao renovar o token. Pode ser necessário rodar "node src/mlAuthSetup.js" de novo.'
    );
    return null;
  }
}

module.exports = {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  refreshTokens,
  getValidAccessToken,
  loadTokenStore,
};
