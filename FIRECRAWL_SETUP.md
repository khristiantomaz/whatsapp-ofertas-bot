# Firecrawl — passo a passo

A **Firecrawl** (firecrawl.dev) raspa páginas de busca das lojas e devolve
os produtos já estruturados (nome, preço "de", preço "por", link direto e
um sinal de popularidade) a partir de um schema definido no código — ela
cuida de proxy/anti-bot por trás.

## Status atual por loja

- **Mercado Livre — DESCARTADO.** Testamos (`mercadolivreFirecrawl.js`) e o
  ML bloqueou a Firecrawl mesmo com proxy "stealth" (o mais robusto que ela
  oferece), do mesmo jeito que bloqueou API oficial, busca direta,
  agregadores e Puppeteer. `ML_DEAL_SOURCE` continua `apify`. O código fica
  implantado mas inativo — não é usado no rodízio.
- **Amazon — em teste.** `amazonFirecrawl.js`, ver seção própria abaixo.
  Amazon costuma ser mais tolerante a scraping que o ML, mas não há
  garantia — se bloquear, o bot simplesmente não usa essa fonte e continua
  com as outras lojas, sem quebrar.
- **Magalu** continua na Apify (ainda sem crédito pra testar até 01/08).

## Mercado Livre via Firecrawl (histórico — não usar)

Ficou registrado aqui só como referência de como o provider foi construído
(`mercadolivreFirecrawl.js`, `mercadolivreAffiliate.js`). Não precisa seguir
os passos abaixo pro Mercado Livre — pule direto pra seção da Amazon.

## Por que a prioridade agora é "mais vendidos"

Além do filtro de desconto mínimo (`DEAL_MIN_DISCOUNT_PERCENT`), o provider
extrai a quantidade vendida de cada produto (texto tipo "+500 vendidos") e
ordena os resultados por isso ANTES do desconto. Assim, entre os produtos
que batem o desconto mínimo, os mais procurados pelo público aparecem
primeiro nas postagens.

## Custo

- Free tier da Firecrawl: **1.000 créditos/mês, sem cartão de crédito**.
- Cada `/scrape` custa entre 1 e 5 créditos (mais caro quando precisa de
  proxy reforçado pra passar de proteção anti-bot).
- Com os padrões do bot (5 categorias × 1 raspagem a cada 12h ≈ 300
  raspagens/mês, mesmo no pior caso de 5 créditos cada) o uso fica bem
  dentro do free tier (≈1.500 créditos no pior caso — se passar de 1.000,
  aumente `FIRECRAWL_REFRESH_HOURS` pra 24, o que cai pra ~750 no pior
  caso).
- O bot usa cache em disco (`data/firecrawl_ml_cache.json`) pra não raspar
  de novo a cada postagem — só quando o cache expira.

## Passo 1 — Criar a conta e pegar o token

1. Acesse **https://firecrawl.dev** e crie uma conta grátis.
2. No dashboard, vá em **API Keys**.
3. Copie a chave (começa com `fc-...`).

## Passo 2 — Configurar o .env na VM

```
FIRECRAWL_API_KEY=fc-SEU_TOKEN_AQUI
FIRECRAWL_REFRESH_HOURS=12
FIRECRAWL_MAX_ITEMS_PER_CATEGORY=20
```

`ML_DEAL_SOURCE` continua `apify` por enquanto — só troque pra `firecrawl`
depois de confirmar o teste isolado no Passo 3.

## Passo 3 — Testar isoladamente antes de mudar a fonte

Na pasta do bot na VM:

```bash
node -e "require('./src/providers/mercadolivreFirecrawl').fetchDeals({limit:5}).then(d=>console.log(JSON.stringify(d,null,2)))"
```

- Se vier uma lista de produtos com `title`, `price`, `originalPrice`,
  `affiliateUrl` (contendo `matt_word=<seu_matt_word>`) e `imageUrl`,
  funcionou. Pode demorar um pouco (5 categorias raspadas na hora); depois
  disso o cache assume.
- Se vier `[]`: verifique os logs (`[Firecrawl/ML] falha ao raspar
  categoria`). As causas mais prováveis:
  - O Mercado Livre bloqueou a página mesmo com a Firecrawl (mesmo tipo de
    proteção anti-bot que já vimos noutras tentativas). Nesse caso,
    continue com `ML_DEAL_SOURCE=apify` e não gaste mais crédito tentando
    de novo sem ajustar nada.
  - Os campos voltaram vazios porque a página mudou de estrutura — rode a
    raspagem manualmente no dashboard da Firecrawl (Playground) contra
    `https://lista.mercadolivre.com.br/casa` com o mesmo schema (veja
    `PRODUCT_SCHEMA` em `src/providers/mercadolivreFirecrawl.js`) e ajuste
    as descrições dos campos se necessário.
- Se quiser tentar uma URL de "mais vendidos" por categoria (em vez da
  busca comum), teste a URL manualmente no navegador primeiro; se
  confirmar que funciona de forma estável, troque a função `categoryUrl()`
  em `mercadolivreFirecrawl.js`.

## Passo 4 — Trocar a fonte e reiniciar o bot

Só depois do teste do Passo 3 vir com produtos de verdade:

```
ML_DEAL_SOURCE=firecrawl
```

```bash
pm2 restart ofertas-bot
pm2 logs ofertas-bot --lines 30
```

## Fallback (Mercado Livre)

Se um dia quiserem tentar de novo, mude `ML_DEAL_SOURCE=firecrawl` no
`.env` e reinicie — mas o esperado, com base no teste já feito, é bloqueio.

---

# Amazon via Firecrawl — passo a passo

Mesma ideia do Mercado Livre, mas pra Amazon (`amazonFirecrawl.js`): raspa
`amazon.com.br/s?k=<categoria>` (página de busca) por categoria e extrai
nome, preço, preço original, link, imagem e **número de avaliações** (usado
como sinal de popularidade — produtos mais avaliados aparecem primeiro
entre os que batem o desconto mínimo, mesmo critério do Mercado Livre com
"vendidos"). No link direto aplica sua tag de afiliada (`AMAZON_TAG`), via
`src/providers/amazonAffiliate.js`.

Usa a MESMA `FIRECRAWL_API_KEY` já configurada (é a mesma conta/crédito
compartilhado com o Mercado Livre — por isso o ML foi desligado da
Firecrawl, pra sobrar crédito pra Amazon).

## Custo

Mesmo raciocínio do Mercado Livre: 5 categorias × 1 raspagem a cada 12h
(`AMAZON_FIRECRAWL_REFRESH_HOURS`) ≈ 300 raspagens/mês, dividindo o free
tier de 1.000 créditos/mês com o que sobrar de outros usos da Firecrawl. Se
notar que está consumindo rápido (`apify.com` não serve aqui — acompanhe em
**firecrawl.dev → Billing/Usage**), aumente `AMAZON_FIRECRAWL_REFRESH_HOURS`
pra 24 ou 48.

## Passo 1 — .env

Já deve estar configurado (mesma chave da seção do Mercado Livre acima).
Confirme que estas linhas existem:

```
AMAZON_ENABLED=true
AMAZON_DEAL_SOURCE=firecrawl
AMAZON_TAG=sua-tag-associados-20
AMAZON_FIRECRAWL_REFRESH_HOURS=12
AMAZON_FIRECRAWL_MAX_ITEMS_PER_CATEGORY=20
```

## Passo 2 — Testar isoladamente

```bash
node -e "require('./src/providers/amazonFirecrawl').fetchDeals({limit:5}).then(d=>console.log(JSON.stringify(d,null,2)))"
```

- Se vier produtos com `title`, `price`, `originalPrice`, `affiliateUrl`
  (contendo `tag=<sua_tag>` ou `/dp/<ASIN>?tag=...`) e `imageUrl`,
  funcionou.
- Se vier `[]`: veja os logs (`[Firecrawl/Amazon] falha ao raspar
  categoria`). Causas prováveis:
  - Bloqueio anti-bot da Amazon (CAPTCHA/"Digite os caracteres..."). Nesse
    caso, mesmo processo do Mercado Livre: não insista gastando crédito,
    registre que não funcionou e deixe `AMAZON_ENABLED=false` até decidir
    outra via (ex.: plano pago da Apify com outro actor).
  - Campos vazios por mudança na página — rode a raspagem manualmente no
    Playground da Firecrawl contra `https://www.amazon.com.br/s?k=casa` com
    o schema de `PRODUCT_SCHEMA` em `amazonFirecrawl.js` e ajuste as
    descrições dos campos.

## Passo 3 — Rodízio automático

Não precisa trocar mais nada: com `AMAZON_ENABLED=true` e
`AMAZON_DEAL_SOURCE=firecrawl` (padrão) já configurados, o
`dealsAggregator.js` inclui a Amazon no rodízio automaticamente assim que
reiniciar o bot:

```bash
pm2 restart ofertas-bot
pm2 logs ofertas-bot --lines 30
```

## Fallback (Amazon)

Se a Firecrawl falhar ou bloquear, mude `AMAZON_ENABLED=false` no `.env` e
reinicie — o rodízio simplesmente pula a Amazon e segue com Mercado Livre e
Shopee, sem quebrar.
