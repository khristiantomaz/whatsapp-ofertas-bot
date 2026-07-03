const config = require('../config');
const { makeApifyProvider } = require('./apifyBase');
const { buildAffiliateUrl } = require('./amazonAffiliate');

/**
 * Ofertas da Amazon via Apify. O link vira afiliado no formato
 * amazon.com.br/dp/<ASIN>?tag=<seu_store_id> (Programa de Associados).
 * Ver APIFY_SETUP.md. ATENÇÃO: o actor padrão (AMAZON_ACTOR_ID) exige plano
 * pago da Apify — normalmente a fonte ativa é a Firecrawl
 * (amazonFirecrawl.js / AMAZON_DEAL_SOURCE=firecrawl). Este arquivo fica
 * pronto caso vocês decidam pagar a Apify ou trocar de actor no futuro.
 */

module.exports = makeApifyProvider({
  source: 'amazon',
  idPrefix: 'amazon',
  actorId: config.amazon.actorId,
  cacheFile: config.amazon.cacheFile,
  domainRegex: /amazon\.com(\.br)?/i,
  fallbackCoupon: '',
  searchTerms: () => (config.amazon.searchTerms.length ? config.amazon.searchTerms : config.deals.categories),
  maxItemsPerTerm: () => config.amazon.maxItemsPerTerm,
  refreshHours: () => config.amazon.refreshHours,
  buildAffiliateUrl,
});
