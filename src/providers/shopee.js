const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../logger');

/**
 * Provider de ofertas da Shopee, usando a Shopee Affiliate Open API
 * (GraphQL). Cadastro do App/credenciais em https://affiliate.shopee.com.br
 * (seção "Open API").
 *
 * Autenticação (esquema documentado pela Shopee):
 *   Authorization: SHA256 Credential={AppId}, Timestamp={Timestamp}, Signature={Signature}
 *   Signature = SHA256(AppId + Timestamp + Payload + Secret)
 *
 * ATENÇÃO: os nomes exatos dos campos retornados pela query `productOfferV2`
 * podem sofrer pequenos ajustes ao longo do tempo. Antes de colocar em
 * produção, confirme o schema atual no Explorer oficial:
 *   https://open-api.affiliate.shopee.com.br/explorer/v2
 * e ajuste os nomes de campo abaixo (marcados com comentário) se necessário.
 */

function sign(payload) {
  const { appId, appSecret } = config.shopee;
  const timestamp = Math.floor(Date.now() / 1000);
  const base = `${appId}${timestamp}${payload}${appSecret}`;
  const signature = crypto.createHash('sha256').update(base).digest('hex');
  return { timestamp, signature };
}

async function graphqlRequest(query, variables = {}) {
  const { appId, graphqlEndpoint } = config.shopee;
  const body = JSON.stringify({ query, variables });
  const { timestamp, signature } = sign(body);

  const authHeader = `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`;

  const { data } = await axios.post(graphqlEndpoint, body, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    timeout: 15000,
  });

  if (data.errors) {
    throw new Error(`Shopee GraphQL error: ${JSON.stringify(data.errors)}`);
  }

  return data.data;
}

// Query para buscar ofertas de produtos por palavra-chave.
// Campos abaixo seguem o schema público conhecido da productOfferV2;
// confirme no Explorer (ver comentário no topo do arquivo).
const PRODUCT_OFFER_QUERY = `
  query ProductOffer($keyword: String, $sortType: Int, $page: Int, $limit: Int) {
    productOfferV2(keyword: $keyword, sortType: $sortType, page: $page, limit: $limit) {
      nodes {
        itemId
        productName
        priceMin
        priceMax
        priceDiscountRate
        commissionRate
        imageUrl
        offerLink
        productLink
        shopName
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

async function searchTerm(term) {
  try {
    const data = await graphqlRequest(PRODUCT_OFFER_QUERY, {
      keyword: term,
      sortType: 5, // maior comissão; ajuste para 2 (mais vendidos) se preferir
      page: 1,
      limit: 20,
    });
    return data?.productOfferV2?.nodes || [];
  } catch (err) {
    logger.error({ err: err.message, term }, '[Shopee] Falha ao buscar termo');
    return [];
  }
}

function computeOriginalPrice(node) {
  const price = Number(node.priceMin);
  const discountRate = Number(node.priceDiscountRate || 0);
  if (!discountRate) return null;
  const original = price / (1 - discountRate / 100);
  return Math.round(original * 100) / 100;
}

async function fetchDeals({ excludeIds = new Set(), limit = 5 } = {}) {
  if (!config.shopee.appId || !config.shopee.appSecret) {
    logger.warn('[Shopee] SHOPEE_APP_ID/SHOPEE_APP_SECRET não configurados — pulando Shopee.');
    return [];
  }

  const { searchTerms, minDiscountPercent, fallbackCoupon } = config.shopee;
  const allNodes = [];

  for (const term of searchTerms) {
    const nodes = await searchTerm(term);
    allNodes.push(...nodes);
  }

  const deals = allNodes
    .map((node) => ({ node, discount: Number(node.priceDiscountRate || 0) }))
    .filter(({ node, discount }) => discount >= minDiscountPercent && !excludeIds.has(`shopee:${node.itemId}`))
    .sort((a, b) => b.discount - a.discount);

  const seen = new Set();
  const unique = [];
  for (const d of deals) {
    if (seen.has(d.node.itemId)) continue;
    seen.add(d.node.itemId);
    unique.push(d);
  }

  return unique
    .slice(0, limit)
    .map(({ node }) => {
      const originalPrice = computeOriginalPrice(node);
      if (!originalPrice) return null;
      return {
        source: 'shopee',
        id: `shopee:${node.itemId}`,
        title: node.productName,
        originalPrice,
        price: Number(node.priceMin),
        coupon: fallbackCoupon || null,
        affiliateUrl: node.offerLink || node.productLink,
        imageUrl: node.imageUrl || null,
      };
    })
    .filter(Boolean);
}

module.exports = { fetchDeals };
