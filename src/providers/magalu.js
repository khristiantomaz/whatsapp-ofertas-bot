const config = require('../config');
const { makeApifyProvider } = require('./apifyBase');

/**
 * Ofertas do Magazine Luiza via Apify. O link vira afiliado passando pela
 * sua loja "Magazine Você": qualquer produto do Magalu vira
 * magazinevoce.com.br/<storeSlug>/<produto>/p/<codigo>/...  Ver APIFY_SETUP.md.
 */

function buildAffiliateUrl(productUrl) {
  const slug = config.magalu.storeSlug;
  if (!slug) return productUrl;
  let url;
  try {
    url = new URL(productUrl);
  } catch (err) {
    return productUrl;
  }
  // Caminho do produto, ex.: /geladeira-frost-free/p/123456789/ed/refr/
  let segments = url.pathname.split('/').filter(Boolean);
  // Se já for um link magazinevoce.com.br/<outraloja>/..., tira o slug antigo
  // (o primeiro segmento) antes de colocar o seu.
  if (/magazinevoce\.com\.br/i.test(url.hostname) && segments.length > 0) {
    segments = segments.slice(1);
  }
  const productPath = segments.join('/');
  return `https://www.magazinevoce.com.br/${slug}/${productPath}${url.search || ''}`;
}

module.exports = makeApifyProvider({
  source: 'magalu',
  idPrefix: 'magalu',
  actorId: config.magalu.actorId,
  cacheFile: config.magalu.cacheFile,
  domainRegex: /magazine(luiza|voce)\.com\.br/i,
  fallbackCoupon: '',
  searchTerms: () => (config.magalu.searchTerms.length ? config.magalu.searchTerms : config.deals.categories),
  maxItemsPerTerm: () => config.magalu.maxItemsPerTerm,
  refreshHours: () => config.magalu.refreshHours,
  buildAffiliateUrl,
});
