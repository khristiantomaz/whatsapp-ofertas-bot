# Deploy na Oracle Cloud (Always Free) — passo a passo

## A Oracle Cloud é uma boa escolha?

Sim, é uma ótima escolha pra esse bot, e melhor que muitas VPS pagas
pequenas:

- O plano **Always Free** dá direito a uma VM `VM.Standard.A1.Flex`
  (ARM/Ampere) com até **4 OCPUs e 24 GB de RAM no total** (dá pra
  dividir em até 4 instâncias, ou usar tudo numa só), além de 200 GB de
  armazenamento — isso é MUITO mais do que o bot precisa (ele consome
  poucos recursos: só faz requisições HTTP e mantém uma conexão de
  WhatsApp aberta).
- É gratuito **para sempre**, não é um trial de 30 dias.
- Como você já tem conta, não precisa se preocupar com o cadastro.

**Único ponto de atenção real:** a Oracle tem uma política de
recuperação de instâncias ociosas — se durante **7 dias seguidos** a
CPU, rede e memória da instância ficarem abaixo de 20% de uso, ela pode
ser recuperada (encerrada). Um bot que só manda uma mensagem por hora
tem boa chance de cair nessa faixa de "ocioso". A solução é simples:
deixo no final deste guia um mini script de "keep-alive" (roda uma
tarefa leve de CPU periodicamente) para a instância nunca ficar
tecnicamente ociosa. [Fonte oficial: Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

Vamos usar a shape **VM.Standard.A1.Flex** (ARM), com **1 OCPU / 6 GB de
RAM** — de sobra para o bot, deixando espaço para criar outras coisas no
futuro dentro do limite gratuito.

---

## Passo 1 — Criar a instância (VM) no console da Oracle Cloud

1. Acesse **cloud.oracle.com** e faça login na sua conta.
2. No menu ☰ (canto superior esquerdo), vá em **Compute → Instances**.
3. Clique em **Create instance**.
4. Preencha:
   - **Name**: `ofertas-bot`
   - **Placement**: deixe o padrão (availability domain sugerido).
   - **Image and shape**:
     - Clique em **Edit** ao lado de "Image" → escolha **Canonical
       Ubuntu** (a versão LTS mais recente, ex.: 24.04) → Select image.
     - Clique em **Edit** ao lado de "Shape" → aba **Ampere** →
       selecione **VM.Standard.A1.Flex** → ajuste para **1 OCPU / 6 GB
       de memória** → confirme que aparece a etiqueta **"Always Free
       eligible"** → Select shape.
   - **Networking**: deixe criar uma VCN nova (padrão) se ainda não
     tiver uma. Mantenha marcado **"Assign a public IPv4 address"** —
     precisamos de um IP público para conectar via SSH.
   - **Add SSH keys**: selecione **"Generate a key pair for me"** e
     clique em **Save private key** (baixa um arquivo tipo
     `ssh-key-...key` — guarde esse arquivo, ele é a sua "senha" de
     acesso à VM e não pode ser recuperado depois).
   - **Boot volume**: pode deixar o padrão (50 GB).
5. Clique em **Create**. Em 1-2 minutos o status muda para **Running**.
6. Anote o **Public IP Address** que aparece na página da instância.

## Passo 2 — Conectar via SSH (do seu Windows)

O Windows já vem com um cliente SSH embutido (desde o Windows 10). Abra
o **PowerShell** e rode (ajustando o caminho da chave e o IP):

```powershell
ssh -i "C:\caminho\para\ssh-key-....key" ubuntu@SEU_IP_PUBLICO
```

Na primeira conexão ele vai perguntar se confia no host — digite `yes`.
Se dar erro de permissão na chave, rode antes:

```powershell
icacls "C:\caminho\para\ssh-key-....key" /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

Se preferir uma interface gráfica em vez do PowerShell, o **WinSCP**
(para copiar arquivos) + **PuTTY** (para o terminal) também funcionam
bem — me avise se quiser o passo a passo com eles em vez do PowerShell.

## Passo 3 — Instalar o Node.js na VM

Já conectado via SSH na VM (prompt tipo `ubuntu@ofertas-bot:~$`), rode:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
node -v   # deve mostrar v20.x
```

## Passo 4 — Enviar o projeto do bot para a VM

No seu **PowerShell local** (não dentro do SSH — abra um novo terminal
ou aperte `Ctrl+Shift+~` para um novo, mantendo o SSH aberto na outra
aba), rode, ajustando os caminhos:

```powershell
scp -i "C:\caminho\para\ssh-key-....key" "C:\caminho\para\whatsapp-ofertas-bot.zip" ubuntu@SEU_IP_PUBLICO:~/
```

De volta ao terminal SSH (conectado na VM):

```bash
sudo apt update && sudo apt install -y unzip
unzip whatsapp-ofertas-bot.zip
cd whatsapp-ofertas-bot
npm install
```

O `.env` já vem preenchido com o grupo do WhatsApp, Mercado Livre e
Shopee — não precisa editar nada, a menos que queira ajustar categorias
ou o intervalo.

## Passo 5 — Escanear o QR code e descobrir/confirmar o grupo

```bash
npm run list-groups
```

Um QR code vai aparecer no terminal (via SSH mesmo, ele desenha em
ASCII). Escaneie com o WhatsApp do celular que vai ser o "dono" do bot
(**Configurações → Aparelhos conectados → Conectar um aparelho**). A
lista de grupos vai aparecer — confirme que o grupo desejado está lá e
copie o ID dele (formato `120363...@g.us`) para `WHATSAPP_GROUP_ID` no
`.env`.

## Passo 6 — Rodar o bot com PM2 (fica de pé sozinho)

```bash
sudo npm install -g pm2
pm2 start src/index.js --name ofertas-bot
pm2 save
pm2 startup   # ele imprime um comando "sudo env PATH=... pm2 startup..."
              # copie e cole esse comando exato e rode-o também
```

Pronto — o bot fica rodando 24/7, reinicia sozinho se cair, e volta a
funcionar automaticamente se a VM reiniciar.

Comandos úteis:

```bash
pm2 logs ofertas-bot      # ver o que está acontecendo em tempo real
pm2 restart ofertas-bot   # reiniciar
pm2 monit                 # uso de CPU/memória
```

## Passo 7 — Evitar que a Oracle recupere a instância por "ociosidade"

Crie um pequeno script que gera uma atividade leve de CPU a cada poucas
horas, o suficiente para a instância não ser classificada como ociosa:

```bash
cat > ~/keepalive.sh << 'EOF'
#!/bin/bash
# Gera ~20s de atividade de CPU para evitar reclamação de instância ociosa.
timeout 20s openssl speed sha256 > /dev/null 2>&1
EOF
chmod +x ~/keepalive.sh
crontab -l 2>/dev/null | { cat; echo "0 */4 * * * ~/keepalive.sh"; } | crontab -
```

Isso roda o script a cada 4 horas. Como o próprio bot já faz chamadas
de rede a cada hora (para as APIs e o WhatsApp), somado a isso, a
instância deve ficar tranquilamente acima do limite de 20% considerado
"ociosa".

## Segurança

- O arquivo `.env` na VM contém suas credenciais reais — não é enviado
  para lugar nenhum além da própria VM (não há `git push` nesse fluxo).
- A chave SSH baixada no Passo 1 é o único jeito de acessar a VM depois
  — guarde-a num lugar seguro (ex.: gerenciador de senhas), fora de
  pastas sincronizadas publicamente.
- Se em algum momento quiser revogar o acesso, você pode deletar a
  instância a qualquer momento pelo console da Oracle Cloud.
