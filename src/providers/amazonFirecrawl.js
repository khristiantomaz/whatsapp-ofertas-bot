const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../config');
const logger = require('../logger');
const { parsePrice } = require('./apifyBase');
const { buildAffiliateUrl } = require('./amazonAffiliate');

/**
 * Ofertas da Amazon via Firecrawl (firecrawl.dev).
 *
 * Mesma ideia do provider do Mercado Livre (mercadolivreFirecrawl.js):
 * raspamos a página de busca da Amazon por categoria e pedimos pra
 * Firecrawl extrair os produtos com um schema. A Amazon costuma ser mais
 * tolerante a scraping do que o Mercado Livre, mas não há garantia — se
 * bloquear, o bot continua funcionando com as outras lojas (Mercado Livre e
 * Shopee), sem quebrar nada.
 *
 * Cache em disco (AMAZON_FIRECRAWL_REFRESH_HOURS) pra economizar os mesmos
 * 1.000 créditos/mês da Firecrawl que já são usados pelo Mercado Livre.
 *
 * Priorização por popularidade: além do filtro de desconto mínimo, ordena
 * pelo número de avaliações do produto (proxy de quão procurado ele é)
 * antes do desconto — mesmo critério usado no provider do Mercado Livre.
 */

const SCRAPE_ENDPOINT = 'https://api.firecrawl.dev/v2/scrape';

const PRODUCT_SCHEMA = {
  type: 'object',
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Nome do produto' },
          price: { type: 'string', description: 'Preço atual, em reais' },
          originalPrice: {
            type: 'string',
            description: 'Preço original/riscado (List Price), antes do desconto, em reais. Vazio se não houver desconto.',
          },
          link: { type: 'string', description: 'URL do link direto do produto (página do produto na Amazon)' },
          image: { type: 'string', description: 'URL da imagem principal do produto' },
          reviewsCount: {
            type: 'string',
            description:
              'Número de avaliações do produto, exibido ao lado das estrelinhas de nota (ex.: "1.234" ou "1.234 avaliações"). Vazio se não aparecer.',
          },
        },
        required: ['title', 'link'],
      },
    },
  },
  required: ['products'],
};

function categoryUrl(term) {
  return `https://www.amazon.com.br/s?k=${encodeURIComponent(term.trim())}`;
}

function parseReviewsCount(text) {
  if (!text) return 0;
  const m = String(text).replace(/\./g, '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function computeDiscount(original, price) {
  if (!original || !price || original <= price) return 0;
  return Math.round(((original - price) / original) * 100);
}

function loadCache() {
  try {
    if (!fs.existsSync(config.amazonFirecrawl.cacheFile)) return null;
    return JSON.parse(fs.readFileSync(config.amazonFirecrawl.cacheFile, 'utf8'));
  } catch (err) {
    return null;
  }
}

function saveCache(items) {
  try {
    const dir = path.dirname(path.resolve(config.amazonFirecrawl.cacheFile));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(config.amazonFirecrawl.cacheFile, JSON.stringify({ fetchedAt: Date.now(), items }, null, 2));
  } catch (err) {
    logger.warn({ err: err.message }, '[Firecrawl/Amazon] não consegui salvar cache');
  }
}

function cacheIsFresh(cache) {
  if (!cache || !cache.fetchedAt || !Array.isArray(cache.items)) return false;
  const maxAgeMs = config.amazonFirecrawl.refreshHours * 60 * 60 * 1000;
  return Date.now() - cache.fetchedAt < maxAgeMs;
}

async function scrapeCategory(term) {
  const url = categoryUrl(term);
  const { data } = await axios.post(
    SCRAPE_ENDPOINT,
    {
      url,
      formats: [{ type: 'json', schema: PRODUCT_SCHEMA }],
      onlyMainContent: false,
      proxy: 'auto',
    },
    {
      headers: {
        Authorization: `Bearer ${config.firecrawl.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 3 * 60 * 1000,
    }
  );
  const products = data && data.data && data.data.json && data.data.json.products;
  return Array.isArray(products) ? products : [];
}

async function fetchFreshItems() {
  const terms = config.amazon.searchTerms.length ? config.amazon.searchTerms : config.deals.categories;
  const max = config.amazonFirecrawl.maxItemsPerCategory;
  const all = [];
  for (const term of terms) {
    try {
      const products = await scrapeCategory(term);
      logger.info({ term, count: products.length }, '[Firecrawl/Amazon] resultados recebidos');
      all.push(...products.slice(0, max));
    } catch (err) {
      logger.error(
        { term, err: (err.response && err.response.data && err.response.data.error) || err.message },
        '[Firecrawl/Amazon] falha ao raspar categoria'
      );
    }
  }
  return all
    .map((raw) => {
      const price = parsePrice(raw.price);
      const originalPrice = parsePrice(raw.originalPrice);
      if (!raw.title || !raw.link || !price) return null;
      if (!/amazon\.com(\.br)?/i.test(String(raw.link))) return null;
      return {
        title: String(raw.title).trim(),
        link: String(raw.link),
        price,
        originalPrice,
        imageUrl: raw.image || null,
        reviewsCount: parseReviewsCount(raw.reviewsCount),
        raw,
      };
    })
    .filter(Boolean);
}

async function fetchDeals({ excludeIds = new Set(), limit = 5 } = {}) {
  if (!config.firecrawl.apiKey) {
    logger.warn('[Firecrawl/Amazon] FIRECRAWL_API_KEY não configurado — pulando.');
    return [];
  }
  if (!config.amazon.tag) {
    logger.warn('[Firecrawl/Amazon] AMAZON_TAG não configurado — pulando.');
    return [];
  }

  let items;
  const cache = loadCache();
  if (cacheIsFresh(cache)) {
    items = cache.items;
  } else {
    items = await fetchFreshItems();
    if (items.length > 0) {
      saveCache(items);
    } else if (cache && Array.isArray(cache.items) && cache.items.length > 0) {
      logger.warn('[Firecrawl/Amazon] busca nova vazia — usando cache anterior.');
      items = cache.items;
    }
  }

  const minDiscount = config.deals.minDiscountPercent;

  const deals = (items || [])
    .map((item) => ({
      ...item,
      id: `firecrawl-amazon:${item.link.split('?')[0]}`,
      discount: computeDiscount(item.originalPrice, item.price),
    }))
    .filter((item) => !excludeIds.has(item.id))
    // Sem preço original não dá pra provar que é oferta — não postamos.
    .filter((item) => item.originalPrice && item.discount >= minDiscount)
    // Prioriza os mais avaliados (proxy de popularidade); desconto maior
    // desempata.
    .sort((a, b) => (b.reviewsCount || 0) - (a.reviewsCount || 0) || b.discount - a.discount);

  const seen = new Set();
  const unique = [];
  for (const d of deals) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    unique.push(d);
  }

  return unique.slice(0, limit).map((item) => ({
    source: 'amazon',
    id: item.id,
    title: item.title,
    originalPrice: item.originalPrice,
    price: item.price,
    coupon: null,
    affiliateUrl: buildAffiliateUrl(item.link, item.raw),
    imageUrl: item.imageUrl || null,
  }));
}

module.exports = { fetchDeals };
