# 🛍️ Bot de Ofertas — Mercado Livre + Shopee no WhatsApp

Bot em Node.js que busca automaticamente as melhores ofertas do dia em
múltiplas lojas (Mercado Livre, Shopee, Amazon e Magazine Luiza), monta
o link de afiliado de cada produto e posta em um grupo de WhatsApp já
existente, de forma automática e dentro de uma janela de horário
configurável — sem depender da API oficial do WhatsApp Business.

> 💡 Projeto real, em produção, criado para automatizar a divulgação de
> ofertas de um grupo de WhatsApp, eliminando o trabalho manual de
> buscar produtos, gerar links de afiliado e postar mensagens várias
> vezes ao dia.

## Índice

- [Visão geral](#visão-geral)
- [Funcionalidades](#funcionalidades)
- [Arquitetura](#arquitetura)
- [Decisões técnicas e desafios](#decisões-técnicas-e-desafios)
- [Stack](#stack)
- [Como rodar localmente](#como-rodar-localmente)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Guias de configuração](#guias-de-configuração)
- [Segurança e privacidade](#segurança-e-privacidade)
- [Possíveis melhorias futuras](#possíveis-melhorias-futuras)
- [Licença](#licença)

## Visão geral

Formato da mensagem postada no grupo:

```
🔥 [NOME DO PRODUTO]
❌ De R$ [VALOR_NORMAL]
✅ Por R$ [VALOR_PROMOCIONAL]
🎟️ Cupom: [CUPOM]
➡️ [LINK_AFILIADO]
```

O bot roda continuamente (ex.: em uma VM na nuvem), busca ofertas em
rodízio entre as lojas configuradas, evita repetir o mesmo produto no
mesmo dia e respeita uma janela de horário e um limite diário de
postagens para reduzir o risco de bloqueio por spam no WhatsApp.

## Funcionalidades

- **Multi-loja com rodízio**: intercala ofertas entre Mercado Livre,
  Shopee, Amazon e Magazine Luiza a cada postagem, para não repetir
  sempre a mesma fonte.
- **Providers plugáveis por loja**: cada loja tem uma ou mais
  estratégias de busca de ofertas (scraping via Firecrawl, scraper via
  Apify, API oficial via OAuth2, ou agregador público), escolhidas por
  variável de ambiente — com fallback automático quando uma fonte para
  de funcionar.
- **Geração automática de link de afiliado** para cada loja (Mercado
  Livre `matt_word`/`matt_tool`, Shopee via assinatura HMAC da API
  GraphQL oficial, Amazon `tag`, Magalu via loja "Magazine Você").
- **Anti-repetição diária**: guarda em disco os IDs já postados no dia
  e nunca repete a mesma oferta até o dia seguinte.
- **Janela de horário e limite de postagens configuráveis**
  (`START_HOUR`/`END_HOUR`/`POST_INTERVAL_MINUTES`/`MAX_POSTS_PER_DAY`),
  pensados para reduzir o risco de o número ser identificado como spam
  pelo WhatsApp.
- **Cache em disco** para as integrações pagas por uso (Apify,
  Firecrawl), mantendo o consumo dentro dos planos gratuitos.
- **Autenticação com o WhatsApp via QR code** (sessão persistida em
  disco, não precisa escanear de novo a cada reinício).
- **OAuth2 completo com o Mercado Livre** (fluxo de autorização, troca
  de código por token, renovação automática via refresh token).

## Arquitetura

```
                         ┌────────────────┐
                         │   scheduler.js │  (node-cron, janela 8h-22h)
                         └───────┬────────┘
                                 │
                         ┌───────▼────────┐
                         │dealsAggregator │  round-robin entre lojas +
                         │      .js       │  filtro de já-postados
                         └───────┬────────┘
              ┌───────┬─────────┼─────────┬────────┐
              ▼        ▼         ▼         ▼        ▼
        promobit   mercadolivre  shopee   amazon   magalu
        .js        Apify/       .js      .js      .js
                   Firecrawl.js
              │        │         │         │        │
              └────────┴────┬────┴─────────┴────────┘
                             ▼
                      formatter.js  (monta a mensagem)
                             ▼
                      whatsapp.js  (Baileys → grupo)
```

Cada provider implementa a mesma interface (`fetchDeals({ excludeIds,
limit })`), o que permite trocar a fonte de dados de uma loja (ex.:
Mercado Livre via scraping ↔ via API oficial) sem alterar o restante
do sistema — um exemplo de uso do padrão *Strategy* para isolar
integrações externas instáveis/sujeitas a bloqueio.

## Decisões técnicas e desafios

- **WhatsApp sem API oficial**: a API oficial da Meta para WhatsApp
  Business não permite postar automaticamente em um grupo comum já
  existente. A solução foi usar a biblioteca **Baileys**, que
  implementa o protocolo do WhatsApp Web. Isso trouxe o desafio de
  evitar bloqueio por spam — resolvido com um intervalo mínimo entre
  postagens, limite diário e recomendação de usar um número dedicado.
- **Mercado Livre bloqueando scraping/API pública**: o endpoint
  público de busca do Mercado Livre passou a bloquear requisições
  anônimas (e mesmo autenticado via OAuth2, o app padrão do Portal de
  Desenvolvedores não retorna preços). A solução foi criar múltiplos
  providers alternativos (scraper via Apify, scraping estruturado via
  Firecrawl, e leitura de um agregador público como último fallback)
  e deixar a escolha configurável por variável de ambiente, sem
  acoplar o restante do sistema a uma única fonte.
- **Custo de scraping sob controle**: as integrações pagas por uso
  (Apify, Firecrawl) usam cache em disco com tempo de expiração
  configurável, dimensionado para caber nos planos gratuitos de cada
  serviço.
- **Configuração 100% via variáveis de ambiente**: nenhuma credencial
  ou dado sensível fica no código-fonte — tudo vem do `.env` (nunca
  commitado), com um `.env.example` documentado explicando cada
  variável.

## Stack

- **Node.js** (CommonJS)
- [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys) — protocolo do WhatsApp Web
- **Axios** + **Cheerio** — requisições HTTP e parsing de HTML (scraping)
- **node-cron** + **Luxon** — agendamento com fuso horário
- **Pino** — logs estruturados
- Integrações externas: **Apify**, **Firecrawl**, **Shopee Affiliate Open API** (GraphQL), **Mercado Livre OAuth2 API**

## Como rodar localmente

### Pré-requisitos

- Node.js 18+
- Um número de WhatsApp (de preferência dedicado) para escanear o QR code
- Conta de afiliado no Mercado Livre e/ou Shopee (opcional, dá para
  rodar só com uma das lojas)

### Instalação

```bash
git clone https://github.com/jessicafmaximiano/whatsapp-ofertas-bot.git
cd whatsapp-ofertas-bot
npm install
cp .env.example .env
```

Preencha o `.env` com suas próprias credenciais (veja os comentários
no próprio arquivo e os guias na seção abaixo). **Nunca** commite o
`.env` preenchido.

### Descobrir o ID do grupo de WhatsApp

```bash
npm run list-groups
```

Escaneie o QR code exibido no terminal e copie o ID do grupo desejado
para `WHATSAPP_GROUP_ID` no `.env`.

### Publicar em um canal do WhatsApp

O bot também pode publicar diretamente em um canal existente. O número
conectado ao bot precisa ser administrador do canal. Coloque o link de
convite do canal em `WHATSAPP_CHANNEL_INVITE_URL` no `.env` e rode:

```bash
npm run channel-id
```

Escaneie o QR code se solicitado. Copie o ID do canal exibido para
`WHATSAPP_CHANNEL_ID` e remova o link de convite do `.env`. Quando
`WHATSAPP_CHANNEL_ID` estiver preenchido, ele tem prioridade sobre
`WHATSAPP_GROUP_ID`.

### Rodar o bot

```bash
npm start
```

## Estrutura do projeto

```
whatsapp-ofertas-bot/
├── src/
│   ├── index.js              # ponto de entrada
│   ├── config.js             # lê e centraliza as variáveis do .env
│   ├── logger.js
│   ├── whatsapp.js           # conexão Baileys + envio de mensagens
│   ├── listGroups.js         # utilitário para descobrir o ID do grupo
│   ├── scheduler.js          # agenda as postagens (janela configurável)
│   ├── dealsAggregator.js    # rodízio entre lojas + anti-repetição
│   ├── formatter.js          # monta o texto da mensagem
│   ├── postedStore.js        # evita repetir a mesma oferta no mesmo dia
│   ├── mlAuthSetup.js        # setup único de OAuth2 do Mercado Livre
│   ├── lib/
│   │   └── mlOAuth.js        # cliente OAuth2 (token/refresh) do Mercado Livre
│   └── providers/            # uma estratégia de busca de ofertas por loja
│       ├── mercadolivre.js
│       ├── mercadolivreApify.js
│       ├── mercadolivreFirecrawl.js
│       ├── mercadolivreAffiliate.js
│       ├── promobit.js
│       ├── shopee.js
│       ├── amazon.js
│       ├── amazonFirecrawl.js
│       ├── amazonAffiliate.js
│       ├── apifyBase.js
│       └── magalu.js
├── data/                     # sessão do WhatsApp + histórico do dia (git-ignorado)
├── .env.example              # todas as variáveis documentadas, sem valores reais
└── package.json
```

## Guias de configuração

Documentação detalhada de cada integração, escrita durante o
desenvolvimento do projeto:

- [`APIFY_SETUP.md`](./APIFY_SETUP.md) — scraper de ofertas via Apify (Mercado Livre, Amazon, Magalu)
- [`FIRECRAWL_SETUP.md`](./FIRECRAWL_SETUP.md) — scraping estruturado via Firecrawl
- [`ML_OAUTH_SETUP.md`](./ML_OAUTH_SETUP.md) — autorização OAuth2 com o Mercado Livre
- [`DEPLOY_ORACLE_CLOUD.md`](./DEPLOY_ORACLE_CLOUD.md) — deploy 24/7 em uma VM gratuita (Oracle Cloud)

## Segurança e privacidade

Este repositório é uma versão pública, sanitizada para portfólio, de
um bot em produção. Por isso:

- O arquivo `.env` (com credenciais reais) **nunca** é commitado —
  está no `.gitignore` e só existe localmente/no servidor onde o bot
  roda.
- `.env.example` documenta todas as variáveis necessárias, sem nenhum
  valor real.
- IDs de grupo de WhatsApp, tokens de API, client secrets e tags de
  afiliado reais foram removidos do código e da documentação e
  substituídos por placeholders.
- A pasta `data/` (sessão do WhatsApp, cache das APIs, histórico de
  postagens) também é git-ignorada.

## Possíveis melhorias futuras

- Painel web simples para acompanhar métricas de postagens/cliques.
- Suporte a múltiplos grupos de WhatsApp com regras diferentes por grupo.
- Testes automatizados para os providers (mockando as respostas das APIs).
- Fila/retry mais robusta para falhas transitórias de rede.

## Licença

Distribuído sob a licença MIT — veja [`LICENSE`](./LICENSE).

---

Desenvolvido por **Jéssica Maximiano**.
