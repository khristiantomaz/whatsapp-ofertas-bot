const config = require('../config');
const { makeApifyProvider } = require('./apifyBase');
const { buildAffiliateUrl } = require('./mercadolivreAffiliate');

/**
 * Ofertas do Mercado Livre via Apify. Ver apifyBase.js e APIFY_SETUP.md.
 * O link vira afiliado aplicando matt_word/matt_tool do Portal de Afiliados
 * (lógica compartilhada em mercadolivreAffiliate.js).
 */

module.exports = makeApifyProvider({
  source: 'mercadolivre',
  idPrefix: 'apify',
  actorId: config.apify.actorId,
  cacheFile: config.apify.cacheFile,
  domainRegex: /mercadoliv(re|bre)\.com/i,
  fallbackCoupon: config.mercadoLivre.fallbackCoupon,
  searchTerms: () =>
    config.mercadoLivre.searchTerms.length ? config.mercadoLivre.searchTerms : config.deals.categories,
  maxItemsPerTerm: () => config.apify.maxItemsPerTerm,
  refreshHours: () => config.apify.refreshHours,
  buildAffiliateUrl,
});
