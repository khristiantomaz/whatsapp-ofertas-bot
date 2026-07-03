const config = require('./config');
const postedStore = require('./postedStore');
const logger = require('./logger');

const shopee = require('./providers/shopee');
const promobit = require('./providers/promobit');
const mercadoLivreApify = require('./providers/mercadolivreApify');
const mercadoLivreFirecrawl = require('./providers/mercadolivreFirecrawl');
const amazon = require('./providers/amazon');
const amazonFirecrawl = require('./providers/amazonFirecrawl');
const magalu = require('./providers/magalu');

/**
 * Monta a lista de plataformas ATIVAS conforme o .env e busca ofertas
 * alternando entre elas em rodízio (round-robin), para intercalar as lojas
 * nas postagens e não repetir sempre a mesma. Já filtra o que foi postado hoje.
 */
function enabledProviders() {
  const list = [];

  // Mercado Livre: firecrawl (com token) > apify (com token) > promobit
  // como último fallback (grátis, mas sem comissão garantida).
  if (config.mercadoLivre.dealSource === 'firecrawl' && config.firecrawl.apiKey) {
    list.push({ name: 'mercadolivre', mod: mercadoLivreFirecrawl });
  } else if (config.mercadoLivre.dealSource === 'apify' && config.apify.token) {
    list.push({ name: 'mercadolivre', mod: mercadoLivreApify });
  } else {
    list.push({ name: 'mercadolivre', mod: promobit });
  }

  // Shopee (API própria, grátis)
  if (config.shopee.appId) {
    list.push({ name: 'shopee', mod: shopee });
  }

  // Amazon: firecrawl (padrão, grátis) ou apify (exige plano pago) — só se
  // ligada e com a tag de afiliada configurada.
  if (config.amazon.enabled && config.amazon.tag) {
    if (config.amazon.dealSource === 'firecrawl' && config.firecrawl.apiKey) {
      list.push({ name: 'amazon', mod: amazonFirecrawl });
    } else if (config.amazon.dealSource === 'apify' && config.apify.token) {
      list.push({ name: 'amazon', mod: amazon });
    }
  }

  // Magalu (via Apify) — só se ligada e com token + slug da loja
  if (config.magalu.enabled && config.apify.token && config.magalu.storeSlug) {
    list.push({ name: 'magalu', mod: magalu });
  }

  return list;
}

let rotationIndex = 0;

async function getNextDeal() {
  const excludeIds = new Set(postedStore.state.ids);
  const providers = enabledProviders();
  if (providers.length === 0) return null;

  // Tenta cada plataforma começando pela próxima do rodízio; a primeira que
  // tiver uma oferta nova ganha a vez, e o rodízio avança pra ela.
  for (let i = 0; i < providers.length; i += 1) {
    const idx = (rotationIndex + i) % providers.length;
    const provider = providers[idx];
    try {
      const deals = await provider.mod.fetchDeals({ excludeIds, limit: 5 });
      if (deals.length > 0) {
        rotationIndex = (idx + 1) % providers.length;
        return deals[0];
      }
    } catch (err) {
      logger.error({ err: err.message, source: provider.name }, '[DealsAggregator] Erro ao buscar ofertas');
    }
  }

  return null;
}

module.exports = { getNextDeal, enabledProviders };
