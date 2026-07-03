# Autorizar o Mercado Livre (OAuth) — passo a passo

O endpoint de busca do Mercado Livre passou a exigir autenticação. Este é
um setup **único** (só precisa fazer de novo se revogar o acesso do app ou
apagar o arquivo de token). Não precisa de túnel SSH nem servidor local —
o Mercado Livre exige que o redirect_uri seja `https://` e não aceita usar
o próprio domínio dele como redirect (por segurança), então usamos
`https://example.com`, um domínio neutro reservado para testes; você só
copia o código da barra de endereço no final.

## Passo 1 — Cadastrar o redirect_uri no seu app

1. Acesse **developers.mercadolivre.com.br** → **Minhas aplicações** → abra
   o app que você já criou (o `ML_CLIENT_ID` do seu `.env`) → **Configuração e
   scopes**.
2. No campo **URIs de redirect**, adicione exatamente:
   ```
   https://example.com
   ```
   (precisa ser `https://`, o Mercado Livre não aceita `http://localhost`).
3. Salve.

## Passo 2 — Rodar o script de autorização na VM

No terminal onde o Claude Code está conectado (ou via SSH), na pasta do
bot na VM:

```bash
node src/mlAuthSetup.js
```

Ele vai imprimir uma URL de autorização e ficar esperando você colar um
código.

## Passo 3 — Autorizar no navegador

Copie a URL impressa (algo como
`https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=...`)
e abra no navegador do seu computador. Faça login na sua conta do Mercado
Livre (se pedir) e clique em **Autorizar**.

Você vai ser redirecionada para `example.com` (uma página simples, sem
nada de especial — é esperado), mas repare na **barra de endereço** do
navegador: ela vai conter algo como
```
https://example.com/?code=TG-XXXXXXXXXXXX-000000000
```
Copie a URL inteira dessa barra de endereço (ou só o trecho depois de
`code=`). Esse código de exemplo acima é só ilustrativo — use o valor real
que aparecer no SEU navegador.

## Passo 4 — Colar o código no terminal

Volte para o terminal onde `node src/mlAuthSetup.js` está esperando, cole
a URL (ou o código) e aperte Enter. Se aparecer "Autorização concluída
com sucesso!", terminou.

O código é de uso único e expira rápido (poucos minutos) — se der erro,
rode `node src/mlAuthSetup.js` de novo do zero e repita rapidamente.

## Passo 5 — Reiniciar o bot

```bash
pm2 restart ofertas-bot
pm2 logs ofertas-bot --lines 30
```

Confira se as buscas do Mercado Livre não retornam mais erro 403.

## Se o token expirar ou parar de funcionar

O `access_token` é renovado sozinho automaticamente (usa o
`refresh_token` salvo). Só é preciso repetir esse processo todo se:
- Você revogar o acesso do app na sua conta do Mercado Livre, ou
- O arquivo `data/ml_token.json` for apagado/corrompido, ou
- O `refresh_token` ficar muito tempo sem uso (o Mercado Livre invalida
  refresh tokens não usados por longos períodos).

Nesses casos, é só repetir os passos 2 a 5.
