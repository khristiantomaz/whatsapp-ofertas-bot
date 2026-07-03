# Ofertas do Mercado Livre via Apify — passo a passo

Depois de testarmos todas as vias gratuitas (API oficial, site do ML,
Promobit, Pelando, Descontou e outros — 10 sites no total), a conclusão
foi que o Mercado Livre bloqueia deliberadamente o acesso automatizado ao
link direto do produto para quem não é parceiro certificado. A solução
adotada é a **Apify** (apify.com): um scraper profissional que roda na
infraestrutura deles (não expõe o IP da VM) e devolve nome, preço "de",
preço "por", **link direto do produto** e imagem — no link direto
aplicamos o `matt_word`/`matt_tool` da conta de afiliada, garantindo a
comissão.

## Custo

- O actor padrão (`karamelo/mercadolivre-scraper-brasil-portugues`) cobra
  ~US$1 por 1.000 resultados.
- A Apify dá **US$5 de crédito grátis por mês, sem cartão de crédito**.
- Com os padrões do bot (5 termos × 30 itens × 1 atualização a cada 24h ≈
  4.500 resultados/mês), o uso **cabe no crédito grátis**. O bot usa cache
  em disco (`data/apify_cache.json`) para não rodar o scraper a cada
  postagem.

## Passo 1 — Criar a conta e pegar o token

1. Acesse **https://apify.com** e crie uma conta grátis (não pede cartão).
2. No console, vá em **Settings → API & Integrations**.
3. Copie o **Personal API token** (começa com `apify_api_...`).

## Passo 2 — Configurar o .env na VM

No `.env` da pasta do bot na VM, preencha:

```
ML_DEAL_SOURCE=apify
APIFY_TOKEN=apify_api_SEU_TOKEN_AQUI
```

(As demais variáveis `APIFY_*` já têm padrões bons; só mexa se quiser
ajustar custo/frequência.)

## Passo 3 — Testar isoladamente antes de reiniciar o bot

Na pasta do bot na VM:

```bash
node -e "require('./src/providers/mercadolivreApify').fetchDeals({limit:3}).then(d=>console.log(JSON.stringify(d,null,2)))"
```

- Se vier uma lista de produtos com `title`, `price`, `originalPrice`,
  `affiliateUrl` (contendo `matt_word=<seu_matt_word>`) e `imageUrl`,
  funcionou. A primeira execução pode demorar alguns minutos (o actor
  roda na hora); as seguintes usam o cache.
- Se vier `[]` ou erro: o formato de input/output do actor pode ser
  diferente do esperado. Nesse caso, rode o actor uma vez manualmente no
  console da Apify, olhe o JSON de input que ele espera e os nomes dos
  campos que ele retorna, e ajuste `runActorForTerm()` (input) e
  `normalizeItem()` (output) em `src/providers/mercadolivreApify.js`.

## Passo 4 — Reiniciar o bot

```bash
pm2 restart ofertas-bot
pm2 logs ofertas-bot --lines 30
```

## Controle de custo

- `APIFY_MAX_ITEMS_PER_TERM` (padrão 30) e `APIFY_REFRESH_HOURS` (padrão
  24) controlam o consumo. Consumo mensal ≈ nº de termos ×
  itens por termo × (24 ÷ refresh_hours) × 30 dias.
- Acompanhe o uso em **apify.com → Billing**. No plano grátis, ao esgotar
  os US$5 o scraper simplesmente para até o próximo mês (sem cobrança) —
  e o bot continua usando o último cache salvo.

## Amazon e Magazine Você (Magalu) — mesmas contas, mesmo token

A Amazon e o Magalu usam a MESMA Apify (mesmo `APIFY_TOKEN`), cada um com
seu próprio scraper e seu próprio link de afiliada:

- **Amazon** (Programa de Associados): o link vira
  `amazon.com.br/dp/<ASIN>?tag=<AMAZON_TAG>`. No `.env`:
  ```
  AMAZON_ENABLED=true
  AMAZON_TAG=sua-tag-associados-20
  ```
- **Magazine Você** (Magalu): o link passa pela sua loja —
  `magazinevoce.com.br/<MAGALU_STORE_SLUG>/<produto>/p/<codigo>/...`. No `.env`:
  ```
  MAGALU_ENABLED=true
  MAGALU_STORE_SLUG=sua-loja-magalu
  ```

Teste cada uma isoladamente (como no Passo 3, trocando o provider):
```bash
node -e "require('./src/providers/amazon').fetchDeals({limit:3}).then(d=>console.log(JSON.stringify(d,null,2)))"
node -e "require('./src/providers/magalu').fetchDeals({limit:3}).then(d=>console.log(JSON.stringify(d,null,2)))"
```
Se vier vazio ou com campos faltando, cada scraper (actor) usa nomes de
campo próprios — rode o actor no console da Apify, veja os nomes reais de
input/output e acrescente-os nas listas `*_KEYS` (output) ou em
`defaultBuildInput` (input) no arquivo `src/providers/apifyBase.js`. Como
os três (ML, Amazon, Magalu) compartilham esse mesmo `apifyBase.js`, o
ajuste vale para todos.

## Custo com 3 lojas na Apify (ML + Amazon + Magalu)

Cada loja roda 1x a cada `*_REFRESH_HOURS` (padrão 24h) buscando
`*_MAX_ITEMS_PER_TERM` (padrão 12) por categoria, em 5 categorias. Isso dá
~1.800 resultados/mês por loja ≈ ~5.400/mês no total. Se todos os actors
cobrarem ~US$1/1.000 resultados, fica em torno de US$5/mês (perto do
crédito grátis). **ATENÇÃO:** o modelo de cobrança varia de actor pra
actor (alguns cobram por resultado, outros por evento ou aluguel mensal).
Confira o consumo real em **apify.com → Billing** nos primeiros dias. Se
estiver gastando rápido, baixe `*_MAX_ITEMS_PER_TERM` (ex.: 8) ou aumente
`*_REFRESH_HOURS` (ex.: 48), ou desligue uma loja (`*_ENABLED=false`).

## Fallback

Se a Apify ficar indisponível, mude `ML_DEAL_SOURCE=promobit` no `.env` e
reinicie: o bot volta a postar ofertas do ML com dados do Promobit (mas o
link não gera comissão). Amazon/Magalu podem ser desligados a qualquer
momento com `AMAZON_ENABLED=false` / `MAGALU_ENABLED=false`.
