const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../config');
const logger = require('../logger');

/**
 * Base genérica para providers de ofertas via Apify (apify.com).
 *
 * Mercado Livre, Amazon e Magazine Luiza usam a MESMA lógica de:
 *   - rodar um "actor" (scraper) na Apify por termo de busca;
 *   - normalizar os campos (nomes variam de actor pra actor);
 *   - filtrar por desconto mínimo;
 *   - guardar em cache em disco (pra não estourar o crédito grátis da Apify);
 *   - montar o link de afiliado (isso é específico de cada loja).
 *
 * O que muda entre as lojas fica em `makeApifyProvider(platform)`:
 *   - platform.actorId, cacheFile, searchTerms(), maxItemsPerTerm(), refreshHours()
 *   - platform.domainRegex  -> só aceita links dessa loja
 *   - platform.buildAffiliateUrl(link, raw) -> aplica o afiliado da loja
 *   - platform.buildInput(term, maxItems)  -> input que o actor espera (opcional)
 *   - platform.idFromLink(link)            -> id estável do produto (opcional)
 *
 * IMPORTANTE: cada actor da Apify pode usar nomes de campo (input e output)
 * diferentes. Os mapeadores abaixo tentam vários nomes comuns; se um campo
 * vier vazio ao testar uma loja nova, rode o actor no console da Apify, veja
 * os nomes reais e acrescente-os nas listas *_KEYS ou em platform.buildInput.
 */

function parsePrice(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value > 0 ? value : null;
  const cleaned = String(value)
    .replace(/\s/g, '')
    .replace(/R\$/gi, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .match(/-?\d+(\.\d+)?/);
  if (!cleaned) return null;
  const n = parseFloat(cleaned[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function firstOf(raw, keys) {
  for (const k of keys) {
    if (raw[k] != null && raw[k] !== '') return raw[k];
  }
  return null;
}

// Nomes de campo mais comuns entre os actors de e-commerce BR (inclui os
// nomes em português que o actor de Mercado Livre usa).
const TITLE_KEYS = ['title', 'name', 'productName', 'product_title', 'productTitle', 'eTituloProduto', 'titulo'];
const LINK_KEYS = ['url', 'link', 'productUrl', 'product_url', 'permalink', 'itemUrl', 'productLink', 'zProdutoLink', 'href'];
const PRICE_KEYS = ['price', 'newPrice', 'currentPrice', 'salePrice', 'price_new', 'priceNow', 'finalPrice', 'novoPreco', 'precoPor', 'precoComDesconto'];
const OLD_KEYS = ['originalPrice', 'oldPrice', 'previousPrice', 'listPrice', 'price_old', 'priceBefore', 'fullPrice', 'precoAnterior', 'precoDe', 'precoOriginal'];
const IMG_KEYS = ['imageUrl', 'image', 'thumbnail', 'img', 'image_url', 'picture', 'mainImage', 'imagemLink', 'imagem'];
const COUPON_KEYS = ['coupon', 'couponCode', 'cupom', 'voucher', 'promoCode', 'discountCoupon'];

function normalizeItem(raw, domainRegex) {
  if (!raw || typeof raw !== 'object') return null;
  const title = firstOf(raw, TITLE_KEYS);
  const link = firstOf(raw, LINK_KEYS);
  const price = parsePrice(firstOf(raw, PRICE_KEYS));
  const originalPrice = parsePrice(firstOf(raw, OLD_KEYS));
  const imageUrl = firstOf(raw, IMG_KEYS);
  const coupon = firstOf(raw, COUPON_KEYS);

  if (!title || !link || !price) return null;
  if (domainRegex && !domainRegex.test(String(link))) return null;

  return { title: String(title).trim(), link: String(link), price, originalPrice, imageUrl, coupon, raw };
}

function computeDiscount(original, price) {
  if (!original || !price || original <= price) return 0;
  return Math.round(((original - price) / original) * 100);
}

function defaultIdFromLink(link) {
  const s = String(link);
  const mlb = s.match(/MLB-?\d+/i);
  if (mlb) return mlb[0].toUpperCase().replace('-', '');
  const asin = s.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  if (asin) return asin[1].toUpperCase();
  const magalu = s.match(/\/p\/([0-9a-z]+)/i);
  if (magalu) return magalu[1];
  return s.split('?')[0];
}

function defaultBuildInput(term, maxItems) {
  // Cobre os nomes de input mais comuns; o actor ignora os que não usa.
  return {
    search: term,
    searchTerm: term,
    keyword: term,
    query: term,
    maxItems,
    maxResults: maxItems,
    maxProducts: maxItems,
  };
}

function makeApifyProvider(platform) {
  const cacheFile = platform.cacheFile;

  function loadCache() {
    try {
      if (!fs.existsSync(cacheFile)) return null;
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch (err) {
      return null;
    }
  }

  function saveCache(items) {
    try {
      const dir = path.dirname(path.resolve(cacheFile));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ fetchedAt: Date.now(), items }, null, 2));
    } catch (err) {
      logger.warn({ err: err.message, source: platform.source }, '[Apify] não consegui salvar cache');
    }
  }

  function cacheIsFresh(cache) {
    if (!cache || !cache.fetchedAt || !Array.isArray(cache.items)) return false;
    const maxAgeMs = platform.refreshHours() * 60 * 60 * 1000;
    return Date.now() - cache.fetchedAt < maxAgeMs;
  }

  async function runActorForTerm(term) {
    const endpoint = `https://api.apify.com/v2/acts/${encodeURIComponent(
      platform.actorId
    )}/run-sync-get-dataset-items`;
    const input = (platform.buildInput || defaultBuildInput)(term, platform.maxItemsPerTerm());
    const { data } = await axios.post(endpoint, input, {
      params: { token: config.apify.token, format: 'json' },
      timeout: 5 * 60 * 1000,
      headers: { 'Content-Type': 'application/json' },
    });
    return Array.isArray(data) ? data : [];
  }

  async function fetchFreshItems() {
    const terms = platform.searchTerms();
    const list = terms.length > 0 ? terms : ['ofertas'];
    const all = [];
    for (const term of list) {
      try {
        const items = await runActorForTerm(term);
        logger.info({ source: platform.source, term, count: items.length }, '[Apify] resultados recebidos');
        all.push(...items);
      } catch (err) {
        logger.error(
          { source: platform.source, term, err: err.response?.data?.error?.message || err.message },
          '[Apify] falha ao rodar o actor'
        );
      }
    }
    return all.map((r) => normalizeItem(r, platform.domainRegex)).filter(Boolean);
  }

  async function fetchDeals({ excludeIds = new Set(), limit = 5 } = {}) {
    if (!config.apify.token) {
      logger.warn(`[${platform.source}] APIFY_TOKEN não configurado — pulando.`);
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
        logger.warn(`[${platform.source}] busca nova vazia — usando cache anterior.`);
        items = cache.items;
      }
    }

    const idFromLink = platform.idFromLink || defaultIdFromLink;
    const minDiscount = config.deals.minDiscountPercent;

    const deals = (items || [])
      .map((item) => ({
        ...item,
        id: `${platform.idPrefix}:${idFromLink(item.link)}`,
        discount: computeDiscount(item.originalPrice, item.price),
      }))
      .filter((item) => !excludeIds.has(item.id))
      // Sem preço original não dá pra provar que é oferta — não postamos,
      // para não inventar desconto.
      .filter((item) => item.originalPrice && item.discount >= minDiscount)
      .sort((a, b) => b.discount - a.discount);

    const seen = new Set();
    const unique = [];
    for (const d of deals) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      unique.push(d);
    }

    return unique.slice(0, limit).map((item) => ({
      source: platform.source,
      id: item.id,
      title: item.title,
      originalPrice: item.originalPrice,
      price: item.price,
      coupon: item.coupon || platform.fallbackCoupon || null,
      affiliateUrl: platform.buildAffiliateUrl(item.link, item.raw),
      imageUrl: item.imageUrl || null,
    }));
  }

  return { fetchDeals };
}

module.exports = { makeApifyProvider, parsePrice, normalizeItem };
