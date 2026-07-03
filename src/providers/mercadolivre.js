const axios = require('axios');
const config = require('../config');
const logger = require('../logger');
const mlOAuth = require('../lib/mlOAuth');

/**
 * Provider de ofertas do Mercado Livre.
 *
 * Usa a API de busca do Mercado Livre para encontrar produtos e calcular o
 * desconto real comparando `original_price` com `price`. O link final é
 * transformado em link de afiliado usando os parâmetros do Portal de
 * Afiliados do Mercado Livre (matt_word/matt_tool), que é o mesmo mecanismo
 * usado quando você gera um link manualmente pelo portal.
 *
 * IMPORTANTE (confirmado em produção): o endpoint de busca passou a exigir
 * autenticação OAuth — requisições anônimas recebem 403 direto do CDN deles.
 * Por isso toda chamada aqui usa um access_token obtido via
 * src/lib/mlOAuth.js (rode "node src/mlAuthSetup.js" uma vez para autorizar
 * o app e gerar o primeiro token; veja ML_OAUTH_SETUP.md).
 */

function buildAffiliateUrl(productUrl) {
  const { linkMode, mattWord, mattTool, simpleTag } = config.mercadoLivre;
  const url = new URL(productUrl);

  if (linkMode === 'simple_tag' && simpleTag) {
    url.searchParams.set('tag', simpleTag);
    return url.toString();
  }

  if (mattWord) {
    url.searchParams.set('matt_word', mattWord);
  }
  if (mattTool) {
    url.searchParams.set('matt_tool', mattTool);
  }
  return url.toString();
}

async function searchTerm(term, accessToken) {
  const { siteId } = config.mercadoLivre;
  const endpoint = `https://api.mercadolibre.com/sites/${siteId}/search`;

  try {
    const { data } = await axios.get(endpoint, {
      params: { q: term, limit: 50 },
      timeout: 15000,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return data.results || [];
  } catch (err) {
    const status = err.response?.status;
    logger.error({ err: err.message, status, term }, '[MercadoLivre] Falha ao buscar termo');
    return [];
  }
}

function computeDiscount(item) {
  const price = item.price;
  const original = item.original_price;
  if (!price || !original || original <= price) return 0;
  return Math.round(((original - price) / original) * 100);
}

/**
 * Retorna uma lista de ofertas (ordenadas por maior desconto) prontas
 * para postar, já excluindo produtos passados em `excludeIds`.
 */
async function fetchDeals({ excludeIds = new Set(), limit = 5 } = {}) {
  const { searchTerms, minDiscountPercent, fallbackCoupon } = config.mercadoLivre;

  const accessToken = await mlOAuth.getValidAccessToken();
  if (!accessToken) {
    logger.warn(
      '[MercadoLivre] Sem token OAuth válido — pulando Mercado Livre. Rode "node src/mlAuthSetup.js" para autorizar.'
    );
    return [];
  }

  const allItems = [];

  for (const term of searchTerms) {
    const items = await searchTerm(term, accessToken);
    allItems.push(...items);
  }

  const deals = allItems
    .map((item) => ({ item, discount: computeDiscount(item) }))
    .filter(({ item, discount }) => discount >= minDiscountPercent && !excludeIds.has(`ml:${item.id}`))
    .sort((a, b) => b.discount - a.discount);

  // Remove duplicados (mesmo produto pode aparecer em mais de um termo)
  const seen = new Set();
  const unique = [];
  for (const d of deals) {
    if (seen.has(d.item.id)) continue;
    seen.add(d.item.id);
    unique.push(d);
  }

  return unique.slice(0, limit).map(({ item }) => ({
    source: 'mercadolivre',
    id: `ml:${item.id}`,
    title: item.title,
    originalPrice: item.original_price,
    price: item.price,
    coupon: fallbackCoupon || null,
    affiliateUrl: buildAffiliateUrl(item.permalink),
    // thumbnail costuma vir em baixa resolução (ex: 160x160); trocamos para
    // um tamanho maior sempre que possível, para ficar melhor no WhatsApp.
    imageUrl: item.thumbnail ? item.thumbnail.replace(/-I\.(jpg|webp)$/, '-O.$1') : null,
  }));
}

module.exports = { fetchDeals };
