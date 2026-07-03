const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../config');
const logger = require('../logger');
const { parsePrice } = require('./apifyBase');
const { buildAffiliateUrl } = require('./mercadolivreAffiliate');

/**
 * Ofertas do Mercado Livre via Firecrawl (firecrawl.dev).
 *
 * Diferença pro provider da Apify (mercadolivreApify.js): aqui buscamos a
 * PÁGINA de resultados de cada categoria no próprio site do ML e pedimos pra
 * Firecrawl extrair os produtos com um schema (título, preço, link, imagem,
 * quantidade vendida). A Firecrawl cuida de proxy/anti-bot; a lógica de
 * extração (schema) é nossa, em vez de depender de um "actor" pronto.
 *
 * Free tier da Firecrawl = 1.000 créditos/mês (cada /scrape custa ~1-5
 * créditos, dependendo do proxy usado). Por isso usamos cache em disco com
 * refresh espaçado (FIRECRAWL_REFRESH_HOURS) — nunca gasta crédito à toa.
 *
 * Priorização por popularidade: além do filtro de desconto mínimo (mesma
 * regra das outras lojas), ordenamos os resultados por "quantidade vendida"
 * (extraída da própria página) antes do desconto — assim os produtos
 * postados são os mais procurados pelo público dentro de cada categoria,
 * não só os com maior desconto.
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
          price: { type: 'string', description: 'Preço atual (com desconto), em reais' },
          originalPrice: {
            type: 'string',
            description: 'Preço original/riscado, antes do desconto, em reais. Vazio se não houver desconto.',
          },
          link: { type: 'string', description: 'URL do link direto do produto' },
          image: { type: 'string', description: 'URL da imagem principal do produto' },
          soldCount: {
            type: 'string',
            description:
              'Texto de quantidade vendida exibido no card do produto, ex.: "+500 vendidos" ou "50 vendidos". Vazio se não aparecer.',
          },
        },
        required: ['title', 'link'],
      },
    },
  },
  required: ['products'],
};

// Página de busca padrão do ML (ordenação por relevância, que já pesa bastante
// popularidade/vendas). Se durante os testes vocês confirmarem uma URL de
// "mais vendidos" por categoria que funcione de forma estável (ex.:
// lista.mercadolivre.com.br/<categoria>_OrderId=BEST_SELLERS), é só trocar
// aqui — o resto do código não muda.
function categoryUrl(term) {
  const slug = encodeURIComponent(term.trim());
  return `https://lista.mercadolivre.com.br/${slug}`;
}

function parseSoldCount(text) {
  if (!text) return 0;
  const m = String(text).replace(/\./g, '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function computeDiscount(original, price) {
  if (!original || !price || original <= price) return 0;
  return Math.round(((original - price) / original) * 100);
}

function idFromLink(link) {
  const s = String(link);
  const mlb = s.match(/MLB-?\d+/i);
  return mlb ? mlb[0].toUpperCase().replace('-', '') : s.split('?')[0];
}

function loadCache() {
  try {
    if (!fs.existsSync(config.firecrawl.cacheFile)) return null;
    return JSON.parse(fs.readFileSync(config.firecrawl.cacheFile, 'utf8'));
  } catch (err) {
    return null;
  }
}

function saveCache(items) {
  try {
    const dir = path.dirname(path.resolve(config.firecrawl.cacheFile));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(config.firecrawl.cacheFile, JSON.stringify({ fetchedAt: Date.now(), items }, null, 2));
  } catch (err) {
    logger.warn({ err: err.message }, '[Firecrawl/ML] não consegui salvar cache');
  }
}

function cacheIsFresh(cache) {
  if (!cache || !cache.fetchedAt || !Array.isArray(cache.items)) return false;
  const maxAgeMs = config.firecrawl.refreshHours * 60 * 60 * 1000;
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
  const terms = config.mercadoLivre.searchTerms.length
    ? config.mercadoLivre.searchTerms
    : config.deals.categories;
  const max = config.firecrawl.maxItemsPerCategory;
  const all = [];
  for (const term of terms) {
    try {
      const products = await scrapeCategory(term);
      logger.info({ term, count: products.length }, '[Firecrawl/ML] resultados recebidos');
      all.push(...products.slice(0, max));
    } catch (err) {
      logger.error(
        { term, err: (err.response && err.response.data && err.response.data.error) || err.message },
        '[Firecrawl/ML] falha ao raspar categoria'
      );
    }
  }
  return all
    .map((raw) => {
      const price = parsePrice(raw.price);
      const originalPrice = parsePrice(raw.originalPrice);
      if (!raw.title || !raw.link || !price) return null;
      if (!/mercadoliv(re|bre)\.com/i.test(String(raw.link))) return null;
      return {
        title: String(raw.title).trim(),
        link: String(raw.link),
        price,
        originalPrice,
        imageUrl: raw.image || null,
        soldCount: parseSoldCount(raw.soldCount),
        raw,
      };
    })
    .filter(Boolean);
}

async function fetchDeals({ excludeIds = new Set(), limit = 5 } = {}) {
  if (!config.firecrawl.apiKey) {
    logger.warn('[Firecrawl/ML] FIRECRAWL_API_KEY não configurado — pulando.');
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
      logger.warn('[Firecrawl/ML] busca nova vazia — usando cache anterior.');
      items = cache.items;
    }
  }

  const minDiscount = config.deals.minDiscountPercent;

  const deals = (items || [])
    .map((item) => ({
      ...item,
      id: `firecrawl:${idFromLink(item.link)}`,
      discount: computeDiscount(item.originalPrice, item.price),
    }))
    .filter((item) => !excludeIds.has(item.id))
    // Sem preço original não dá pra provar que é oferta — não postamos.
    .filter((item) => item.originalPrice && item.discount >= minDiscount)
    // Prioriza os mais vendidos (mais procurados pelo público); desconto
    // maior desempata.
    .sort((a, b) => (b.soldCount || 0) - (a.soldCount || 0) || b.discount - a.discount);

  const seen = new Set();
  const unique = [];
  for (const d of deals) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    unique.push(d);
  }

  return unique.slice(0, limit).map((item) => ({
    source: 'mercadolivre',
    id: item.id,
    title: item.title,
    originalPrice: item.originalPrice,
    price: item.price,
    coupon: config.mercadoLivre.fallbackCoupon || null,
    affiliateUrl: buildAffiliateUrl(item.link),
    imageUrl: item.imageUrl || null,
  }));
}

module.exports = { fetchDeals };
