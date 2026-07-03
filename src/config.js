require('dotenv').config();

function required(name, value) {
  if (!value) {
    console.warn(`[config] Aviso: variável de ambiente "${name}" não está definida no .env`);
  }
  return value;
}

const config = {
  whatsapp: {
    groupId: required('WHATSAPP_GROUP_ID', process.env.WHATSAPP_GROUP_ID),
    sessionDir: process.env.SESSION_DIR || './data/auth',
  },
  schedule: {
    timezone: process.env.TIMEZONE || 'America/Sao_Paulo',
    startHour: Number(process.env.START_HOUR || 8),
    endHour: Number(process.env.END_HOUR || 22),
    intervalMinutes: Number(process.env.POST_INTERVAL_MINUTES || 15),
    maxPostsPerDay: process.env.MAX_POSTS_PER_DAY ? Number(process.env.MAX_POSTS_PER_DAY) : null,
  },
  // Categorias/termos preferidos, usados como busca por TODAS as plataformas
  // Apify (Mercado Livre, Amazon, Magalu) quando elas não têm termos próprios.
  deals: {
    categories: (process.env.DEAL_CATEGORIES || 'casa,moveis,eletrodomesticos,eletronicos,beleza')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    minDiscountPercent: Number(process.env.DEAL_MIN_DISCOUNT_PERCENT || 15),
  },
  mercadoLivre: {
    // Fonte das ofertas do ML:
    // "firecrawl" -> raspagem da própria página do ML via Firecrawl (link
    //                direto do produto = comissão; ver FIRECRAWL_SETUP.md).
    // "apify"     -> scraper profissional (link direto do produto —
    //                comissão garantida; ver APIFY_SETUP.md).
    // "promobit"  -> grátis, mas o link não chega no produto específico
    //                (sem comissão). Só use como fallback.
    dealSource: (process.env.ML_DEAL_SOURCE || 'promobit').toLowerCase(),
    linkMode: process.env.ML_LINK_MODE || 'matt_word',
    mattWord: process.env.ML_MATT_WORD || '',
    mattTool: process.env.ML_MATT_TOOL || '',
    simpleTag: process.env.ML_SIMPLE_TAG || '',
    // Credenciais de app OAuth (developers.mercadolivre.com.br). Necessárias
    // porque o endpoint público de busca passou a exigir autenticação.
    clientId: process.env.ML_CLIENT_ID || '',
    clientSecret: process.env.ML_CLIENT_SECRET || '',
    // Precisa ser https:// (o Mercado Livre não aceita http:// nem localhost
    // puro, e também rejeita usar o próprio domínio dele como redirect).
    // example.com é um domínio neutro reservado para testes — não precisamos
    // que a página realmente faça nada, só que o "code" apareça na URL.
    redirectUri: process.env.ML_REDIRECT_URI || 'https://example.com',
    tokenFile: process.env.ML_TOKEN_FILE || './data/ml_token.json',
    searchTerms: (process.env.ML_SEARCH_TERMS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    siteId: process.env.ML_SITE_ID || 'MLB',
    minDiscountPercent: Number(process.env.ML_MIN_DISCOUNT_PERCENT || 20),
    fallbackCoupon: process.env.ML_FALLBACK_COUPON || '',
  },
  apify: {
    // Token de API da Apify (apify.com -> Settings -> API & Integrations).
    token: process.env.APIFY_TOKEN || '',
    // Actor (scraper) usado. Formato aceito pela API: "usuario~nome-do-actor".
    actorId: process.env.APIFY_ACTOR_ID || 'karamelo~mercadolivre-scraper-brasil-portugues',
    // Quantos resultados pedir por termo de busca (controla o custo:
    // ~US$1 por 1.000 resultados neste actor).
    maxItemsPerTerm: Number(process.env.APIFY_MAX_ITEMS_PER_TERM || 30),
    // De quanto em quanto tempo atualizar as ofertas na Apify (em horas).
    // 24h com os padrões acima mantém o uso dentro do crédito grátis
    // de US$5/mês da Apify.
    refreshHours: Number(process.env.APIFY_REFRESH_HOURS || 24),
    cacheFile: process.env.APIFY_CACHE_FILE || './data/apify_cache.json',
  },
  firecrawl: {
    // Token de API da Firecrawl (firecrawl.dev -> API Keys). Free tier =
    // 1.000 créditos/mês.
    apiKey: process.env.FIRECRAWL_API_KEY || '',
    cacheFile: process.env.FIRECRAWL_CACHE_FILE || './data/firecrawl_ml_cache.json',
    // De quanto em quanto tempo raspar de novo cada categoria (em horas).
    // Com 5 categorias e refresh de 12h isso dá ~300 chamadas/mês — bem
    // dentro do free tier mesmo com proxy "auto" (até 5 créditos/chamada).
    refreshHours: Number(process.env.FIRECRAWL_REFRESH_HOURS || 12),
    // Quantos produtos considerar por categoria a cada raspagem.
    maxItemsPerCategory: Number(process.env.FIRECRAWL_MAX_ITEMS_PER_CATEGORY || 20),
  },
  amazon: {
    // Programa de Associados da Amazon (associados.amazon.com.br).
    enabled: (process.env.AMAZON_ENABLED || 'false').toLowerCase() === 'true',
    // Fonte das ofertas da Amazon:
    // "firecrawl" -> raspagem da página de busca via Firecrawl. Requer
    //                FIRECRAWL_API_KEY (mesma da seção acima). Ver
    //                FIRECRAWL_SETUP.md.
    // "apify"     -> actor da Apify (AMAZON_ACTOR_ID). ATENÇÃO: o actor
    //                padrão exige plano pago da Apify.
    dealSource: (process.env.AMAZON_DEAL_SOURCE || 'firecrawl').toLowerCase(),
    // Seu "Store ID"/tag de afiliada (ex.: minhaloja-20). É o que garante
    // a comissão: todo link vira amazon.com.br/dp/<ASIN>?tag=<tag>.
    tag: process.env.AMAZON_TAG || '',
    actorId: process.env.AMAZON_ACTOR_ID || 'powerai~amazon-deals-products-scraper',
    cacheFile: process.env.AMAZON_CACHE_FILE || './data/amazon_cache.json',
    maxItemsPerTerm: Number(process.env.AMAZON_MAX_ITEMS_PER_TERM || 12),
    refreshHours: Number(process.env.AMAZON_REFRESH_HOURS || 24),
    searchTerms: (process.env.AMAZON_SEARCH_TERMS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  amazonFirecrawl: {
    cacheFile: process.env.AMAZON_FIRECRAWL_CACHE_FILE || './data/firecrawl_amazon_cache.json',
    // Mesmo raciocínio do Mercado Livre: 5 categorias × refresh de 12h fica
    // bem dentro do free tier de 1.000 créditos/mês da Firecrawl (dividido
    // com o uso do Mercado Livre).
    refreshHours: Number(process.env.AMAZON_FIRECRAWL_REFRESH_HOURS || 12),
    maxItemsPerCategory: Number(process.env.AMAZON_FIRECRAWL_MAX_ITEMS_PER_CATEGORY || 20),
  },
  magalu: {
    // Programa "Magazine Você" (magazinevoce.com.br). O link de afiliada é a
    // sua loja: qualquer produto do Magalu vira
    // magazinevoce.com.br/<storeSlug>/<produto>/p/<codigo>/...
    enabled: (process.env.MAGALU_ENABLED || 'false').toLowerCase() === 'true',
    // Slug da sua loja Magazine Você (ex.: minhaloja).
    storeSlug: process.env.MAGALU_STORE_SLUG || '',
    actorId: process.env.MAGALU_ACTOR_ID || 'gio21~magazine-luiza-scraper',
    cacheFile: process.env.MAGALU_CACHE_FILE || './data/magalu_cache.json',
    maxItemsPerTerm: Number(process.env.MAGALU_MAX_ITEMS_PER_TERM || 12),
    refreshHours: Number(process.env.MAGALU_REFRESH_HOURS || 24),
    searchTerms: (process.env.MAGALU_SEARCH_TERMS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  shopee: {
    appId: process.env.SHOPEE_APP_ID || '',
    appSecret: process.env.SHOPEE_APP_SECRET || '',
    graphqlEndpoint: process.env.SHOPEE_GRAPHQL_ENDPOINT || 'https://open-api.affiliate.shopee.com.br/graphql',
    searchTerms: (process.env.SHOPEE_SEARCH_TERMS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    minDiscountPercent: Number(process.env.SHOPEE_MIN_DISCOUNT_PERCENT || 20),
    fallbackCoupon: process.env.SHOPEE_FALLBACK_COUPON || '',
  },
  postedLogFile: process.env.POSTED_LOG_FILE || './data/posted.json',
  logLevel: process.env.LOG_LEVEL || 'info',
};

module.exports = config;
