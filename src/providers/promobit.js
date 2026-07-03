const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config');
const logger = require('../logger');

/**
 * Provider de ofertas do Mercado Livre via Promobit.
 *
 * CONTEXTO: a API pública de busca do Mercado Livre passou a exigir OAuth
 * (ver src/providers/mercadolivre.js), e mesmo autenticado o app padrão do
 * Portal de Desenvolvedores não tem permissão para ver preços dos produtos
 * (o campo buy_box_winner sempre volta null para apps não-parceiros — isso
 * foi confirmado testando 28 produtos reais, incluindo itens de alta
 * demanda). Não existe alternativa oficial gratuita para isso.
 *
 * Como alternativa, este provider lê a listagem PÚBLICA de ofertas de
 * Mercado Livre do Promobit (site de comunidade de promoções, sem login:
 * https://www.promobit.com.br/promocoes/loja/mercado-livre/), que já mostra
 * nome, preço original e preço com desconto reais, atualizados a cada poucos
 * minutos pela comunidade. Depois resolve o link de redirecionamento do
 * Promobit (/Redirect/to/{id}/) para chegar na URL real do produto no
 * Mercado Livre, e reconstrói o link de afiliado usando O SEU
 * matt_word/matt_tool (para a comissão da venda ser SUA, e não do Promobit).
 *
 * AVISO IMPORTANTE: isso NÃO é uma API oficial de nenhuma das duas empresas.
 * É leitura da página pública do Promobit, sujeita aos Termos de Uso deles
 * e à estrutura da página, que pode mudar a qualquer momento. A extração
 * principal (parseFromNextData) lê o JSON embutido no
 * <script id="__NEXT_DATA__">, que o próprio Next.js usa para hidratar a
 * página — é bem mais estável que classes CSS, mas se a Promobit migrar de
 * framework ou mudar a forma de o script, o motivo mais provável de o bot
 * parar de achar ofertas é esse (nesse caso peça para o Claude Code local
 * buscar o HTML atual da LISTING_URL e localizar de novo onde ficam os dados
 * das ofertas). Há também um fallback por JSON-LD/CSS (parseFromCssHeuristics)
 * para o caso de o __NEXT_DATA__ sumir.
 */

const LISTING_URL = 'https://www.promobit.com.br/promocoes/loja/mercado-livre/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function buildAffiliateUrl(productUrl) {
  const { linkMode, mattWord, mattTool, simpleTag } = config.mercadoLivre;
  const url = new URL(productUrl);
  // Remove qualquer parâmetro de rastreio que já esteja no link (ex: o
  // próprio Promobit ou o Mercado Livre podem ter adicionado o deles) para
  // garantir que só o SEU marcador de afiliado fique no link final.
  ['matt_word', 'matt_tool', 'tag', 'forceInApp', 'ref'].forEach((p) => url.searchParams.delete(p));

  if (linkMode === 'simple_tag' && simpleTag) {
    url.searchParams.set('tag', simpleTag);
    return url.toString();
  }
  if (mattWord) url.searchParams.set('matt_word', mattWord);
  if (mattTool) url.searchParams.set('matt_tool', mattTool);
  return url.toString();
}

function parsePrice(text) {
  if (!text) return null;
  // Aceita formatos "R$ 1.234,56", "1234,56", etc.
  const cleaned = text
    .replace(/\s/g, '')
    .replace(/R\$/gi, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .match(/-?\d+(\.\d+)?/);
  if (!cleaned) return null;
  const value = parseFloat(cleaned[0]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function computeDiscount(original, price) {
  if (!original || !price || original <= price) return 0;
  return Math.round(((original - price) / original) * 100);
}

function extractOfferId(offerUrl) {
  // URLs de oferta do Promobit terminam em "-<id>/", ex:
  // https://www.promobit.com.br/oferta/samsung-galaxy-a17-5g-2778877/
  const match = offerUrl.match(/-(\d+)\/?$/);
  return match ? match[1] : null;
}

/**
 * Tenta extrair os dados de cada oferta a partir de blocos JSON estruturados
 * (JSON-LD ou __NEXT_DATA__), que são mais estáveis que classes CSS. Se não
 * encontrar nenhum, cai para um parsing por seletores CSS genéricos.
 */
function parseFromJsonLd($) {
  const items = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let json;
    try {
      json = JSON.parse($(el).contents().text());
    } catch (err) {
      return;
    }
    const list = Array.isArray(json) ? json : [json];
    for (const entry of list) {
      const products = entry.itemListElement || (entry['@type'] === 'Product' ? [entry] : []);
      for (const p of products) {
        const product = p.item || p;
        if (!product || product['@type'] !== 'Product') continue;
        const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        if (!offer) continue;
        items.push({
          title: product.name,
          offerUrl: product.url,
          price: offer.price ? Number(offer.price) : null,
          originalPrice: null, // JSON-LD normalmente só traz o preço final
          imageUrl: Array.isArray(product.image) ? product.image[0] : product.image,
        });
      }
    }
  });
  return items;
}

/**
 * Extrai as ofertas a partir do JSON embutido em <script id="__NEXT_DATA__">
 * (usado pelo Next.js para hidratar a página no navegador). É a fonte
 * principal hoje: props.pageProps.serverOffers.offers traz título, preços,
 * slug e cupom de cada oferta diretamente, sem precisar inferir nada de
 * classes CSS.
 */
function parseFromNextData($) {
  const raw = $('#__NEXT_DATA__').contents().text();
  if (!raw) return [];

  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return [];
  }

  const offers = json?.props?.pageProps?.serverOffers?.offers;
  if (!Array.isArray(offers)) return [];

  return offers
    .filter((o) => o.storeDomain === 'mercadolivre.com.br')
    .map((o) => ({
      title: o.offerTitle,
      offerUrl: `https://www.promobit.com.br/oferta/${o.offerSlug}/`,
      offerId: String(o.offerId),
      price: typeof o.offerPrice === 'number' ? o.offerPrice : parsePrice(o.offerPrice),
      originalPrice: typeof o.offerOldPrice === 'number' ? o.offerOldPrice : parsePrice(o.offerOldPrice),
      imageUrl: o.offerPhoto ? `https://i.promobit.com.br/300${o.offerPhoto}` : null,
      coupon: o.offerCoupon || null,
    }));
}

function parseFromCssHeuristics($) {
  const items = [];
  // Estrutura observada: cada card fica dentro de um <article>, com um link
  // para "/oferta/...-<id>/". Ajuste este seletor se o Promobit redesenhar
  // a página (ver aviso no topo do arquivo).
  $('article').each((_, el) => {
    const $el = $(el);
    const linkEl = $el.find('a[href*="/oferta/"]').first();
    const link = linkEl.attr('href');
    if (!link) return;

    const title = $el.find('h2, h3, [class*=title]').first().text().trim();
    if (!title) return;

    // Preço com desconto: normalmente o maior/mais destacado. Preço
    // original: geralmente dentro de <s> ou <del>, ou classe com "old"/"from".
    const originalText = $el.find('s, del, [class*=old], [class*=from]').first().text().trim();
    const priceCandidates = $el
      .find('[class*=price]')
      .map((__, p) => $(p).text().trim())
      .get()
      .filter(Boolean);
    const priceText = priceCandidates.find((t) => t !== originalText) || priceCandidates[0] || '';

    const imageUrl = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src') || null;

    items.push({
      title,
      offerUrl: link.startsWith('http') ? link : `https://www.promobit.com.br${link}`,
      price: parsePrice(priceText),
      originalPrice: parsePrice(originalText),
      imageUrl,
    });
  });
  return items;
}

async function fetchListingHtml() {
  const { data } = await axios.get(LISTING_URL, {
    timeout: 20000,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  return data;
}

function parseListing(html) {
  const $ = cheerio.load(html);

  const fromNextData = parseFromNextData($);
  if (fromNextData.length > 0) return fromNextData;

  // Fallback para o caso de o __NEXT_DATA__ desaparecer/mudar de formato.
  const fromJsonLd = parseFromJsonLd($);
  const fromCss = parseFromCssHeuristics($);

  // Junta as duas fontes por offerUrl, preferindo o preço original vindo do
  // CSS (o JSON-LD raramente traz o preço "de", só o "por").
  const byUrl = new Map();
  for (const item of [...fromJsonLd, ...fromCss]) {
    if (!item.offerUrl) continue;
    const existing = byUrl.get(item.offerUrl) || {};
    byUrl.set(item.offerUrl, {
      title: item.title || existing.title,
      offerUrl: item.offerUrl,
      price: existing.price || item.price,
      originalPrice: existing.originalPrice || item.originalPrice,
      imageUrl: existing.imageUrl || item.imageUrl,
    });
  }

  return Array.from(byUrl.values()).filter((i) => i.title && i.offerUrl && i.price);
}

/**
 * Segue o redirecionador do Promobit (/Redirect/to/{id}/) manualmente,
 * salto a salto, até chegar numa URL do mercadolivre.com.br (ou esgotar as
 * tentativas). Feito "na mão" em vez de deixar o axios seguir tudo automático
 * porque precisamos só da URL final, não do conteúdo da página.
 */
async function resolveMercadoLivreUrl(offerId) {
  let url = `https://www.promobit.com.br/Redirect/to/${offerId}/`;
  for (let hop = 0; hop < 6; hop += 1) {
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: { 'User-Agent': USER_AGENT },
      });
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        const next = new URL(response.headers.location, url).toString();
        if (next.includes('mercadolivre.com.br') || next.includes('mercadolibre.com')) {
          return next;
        }
        url = next;
        continue;
      }
      // Sem redirect e sem chegar no ML: não conseguimos resolver.
      return null;
    } catch (err) {
      if (err.response?.status >= 300 && err.response?.status < 400 && err.response.headers.location) {
        const next = new URL(err.response.headers.location, url).toString();
        if (next.includes('mercadolivre.com.br') || next.includes('mercadolibre.com')) {
          return next;
        }
        url = next;
        continue;
      }
      logger.warn({ err: err.message, offerId }, '[Promobit] Falha ao resolver redirect');
      return null;
    }
  }
  return null;
}

/**
 * Retorna uma lista de ofertas de Mercado Livre (ordenadas por maior
 * desconto), prontas para postar, já excluindo produtos passados em
 * `excludeIds`.
 */
async function fetchDeals({ excludeIds = new Set(), limit = 5 } = {}) {
  const { minDiscountPercent, fallbackCoupon } = config.mercadoLivre;

  let html;
  try {
    html = await fetchListingHtml();
  } catch (err) {
    logger.error({ err: err.message }, '[Promobit] Falha ao buscar a página de ofertas');
    return [];
  }

  const parsed = parseListing(html);
  if (parsed.length === 0) {
    logger.warn(
      '[Promobit] Nenhuma oferta encontrada no HTML — o layout do site pode ter mudado (ver comentário no topo de promobit.js).'
    );
    return [];
  }

  const candidates = parsed
    .map((item) => {
      // parseFromNextData já traz offerId pronto; o fallback por CSS precisa
      // extraí-lo da URL.
      const offerId = item.offerId || extractOfferId(item.offerUrl);
      return { ...item, offerId, discount: computeDiscount(item.originalPrice, item.price) };
    })
    .filter((item) => item.offerId && !excludeIds.has(`promobit:${item.offerId}`))
    // Se não temos preço original (alguns cards não mostram), não dá pra
    // calcular desconto real — não postamos, para não inventar número.
    .filter((item) => item.originalPrice && item.discount >= minDiscountPercent)
    .sort((a, b) => b.discount - a.discount);

  const results = [];
  for (const item of candidates) {
    if (results.length >= limit) break;

    const mlUrl = await resolveMercadoLivreUrl(item.offerId);
    if (!mlUrl) {
      logger.debug({ offerId: item.offerId }, '[Promobit] Não conseguiu resolver o link real do Mercado Livre, pulando.');
      continue;
    }

    results.push({
      source: 'mercadolivre',
      id: `promobit:${item.offerId}`,
      title: item.title,
      originalPrice: item.originalPrice,
      price: item.price,
      coupon: item.coupon || fallbackCoupon || null,
      affiliateUrl: buildAffiliateUrl(mlUrl),
      imageUrl: item.imageUrl || null,
    });
  }

  return results;
}

module.exports = { fetchDeals, parseListing, buildAffiliateUrl };
