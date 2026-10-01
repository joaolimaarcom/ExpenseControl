# Painel — grana e pendências

App de uma página para controlar gastos, limite de crédito e pendências do dia a dia.
Roda no Cloudflare Pages, sincroniza no Firestore e instala como app no celular (PWA).

## Arquivos

| arquivo | função |
|---|---|
| `index.html` | o app inteiro (UI, cálculos, Firestore, chamada da IA) |
| `sw.js` | service worker — cache do shell, funciona offline |
| `manifest.webmanifest` | PWA: nome, cores, ícones |
| `icone-192.png` / `icone-512.png` | ícones da tela inicial |
| `functions/api/chat.js` | proxy da IA (Cloudflare Pages Function) — guarda a chave |
| `firestore.rules` | regras de segurança do banco |

## 1. Firebase

1. Crie um projeto no [console do Firebase](https://console.firebase.google.com).
2. **Build > Firestore Database > Criar** — modo produção, região `southamerica-east1`.
3. **Build > Authentication > Começar > Google** — ativar.
4. Em **Authentication > Settings > Domínios autorizados**, adicione
   `SEU-USUARIO.github.io`. Sem isso o login falha em produção.
5. **Configurações do projeto > Seus apps > Web** — registre um app e copie
   `apiKey`, `authDomain`, `projectId`, `appId`.
6. **Firestore > Regras** — cole o conteúdo de `firestore.rules` e publique.

## 2. Gemini (a IA que lê o texto livre)

É o que interpreta "ifood 38" ou "amanhã 9h reunião". Sem ela o app
continua funcionando: o botão `+` faz lançamento manual e existe um
parser local básico para "gastei/recebi".

A chave **não fica no `index.html`**. Ela é um secret no Cloudflare e só
o proxy em `functions/api/chat.js` a enxerga — veja a seção 4.

Pegue a chave em [aistudio.google.com](https://aistudio.google.com/apikey).

## 3. Preencher a config

No topo do `<script type="module">` do `index.html` só ficam dados
públicos — nenhuma chave de IA:

```js
const CONFIG = {
  firebase: {
    apiKey:     "...",
    authDomain: "seu-projeto.firebaseapp.com",
    projectId:  "seu-projeto",
    appId:      "..."
  },
  ia: { proxy: "/api/chat" }
};
```

## 4. Publicar no Cloudflare Pages

O site e o proxy da IA vão juntos: o Pages serve os arquivos estáticos e
executa o que está em `functions/` como Worker, no mesmo domínio. Por isso
o app chama `/api/chat` sem CORS e sem um segundo deploy.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages**
   → **Create** → **Pages** → **Connect to Git** → escolha este repositório.
2. Build: **nenhum**. Framework preset `None`, build command vazio,
   output directory `/` (a raiz). É um site estático.
3. Depois do primeiro deploy, em **Settings > Variables and secrets**,
   adicione como **Secret**:

   | Nome | Valor |
   |---|---|
   | `GEMINI_API_KEY` | sua chave do AI Studio |
   | `GEMINI_MODEL` | opcional — troca o modelo sem mexer no código |

4. **Redeploy** (secret novo só vale no deploy seguinte).
5. No Firebase, **Authentication > Settings > Domínios autorizados**,
   adicione o domínio do Pages (`seu-projeto.pages.dev`). Sem isso o login
   com Google falha em produção.

### Conferir se o proxy subiu

Abra `https://seu-projeto.pages.dev/api/chat` no navegador. Deve responder:

```json
{ "ok": true, "chaveConfigurada": true, "modelo": "gemini-3.5-flash" }
```

`chaveConfigurada: false` significa que o secret não está lá, ou que
faltou o redeploy.

Para testar a chave direto no Gemini, sem passar pelo app:

```bash
curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
  -H "x-goog-api-key: SUA_CHAVE" -H 'Content-Type: application/json' \
  -d '{"model":"gemini-3.5-flash","input":"responda apenas: ok"}'
```

Se esse curl falhar, o problema é a chave ou o modelo — não o app.

### Trocar de modelo ou de provedor

O formato do Gemini vive só em `functions/api/chat.js`. O app manda
`{sistema, historico, mensagem}` e espera `{texto}` de volta. Trocar o
modelo é mudar o secret `GEMINI_MODEL`; trocar de provedor é mexer só
nesse arquivo, sem tocar no `index.html`.

## 5. Instalar no celular

Abra a URL no Chrome → menu → **Adicionar à tela inicial**.
No iPhone é pelo Safari → compartilhar → **Adicionar à Tela de Início**.
Abre em tela cheia, sem barra de navegador, e funciona offline.

**O login com Google é obrigatório** — é o que faz os dados aparecerem no
celular e no computador. Não existe modo "só neste aparelho": sem entrar,
o app não abre.

Depois de entrar uma vez, o app continua funcionando **offline**: o
Firestore mantém um cache local próprio, serve os dados de lá e enfileira
o que você lançar, sincronizando quando a rede volta. O que exige internet
é a primeira entrada — e qualquer abertura em que o SDK do Firebase não
esteja em cache, porque ele vem da CDN do Google (`gstatic.com`).

## Segurança — leia antes de subir

O `apiKey` do Firebase é público por natureza, não é segredo. Quem protege
os dados são as **regras do Firestore**, então elas precisam estar publicadas
antes do primeiro dado entrar. Com as regras de `firestore.rules`, ninguém
lê seu documento sem estar logado com a sua conta.

A **chave da IA** era o ponto fraco: ela ficava no `index.html`, visível em
repositório público, e quem achasse gastaria a cota. Isso acabou — ela
agora é um secret no Cloudflare e só o proxy a enxerga. Nenhuma chave de
IA sai mais no navegador.

O proxy aceita apenas requisições da própria origem. Isso corta uso por
outro site, mas não impede alguém que descubra a URL de chamar o endpoint
direto (uma requisição fora do navegador não manda `Origin`). O risco é
cota, não dado — se virar problema, o caminho é pôr o Cloudflare Access
ou um rate limit na frente.

**Se você já publicou a chave antiga da Groq em commit, revogue-a.** Tirar
do código não tira do histórico do git.

## Atualizar depois

O service worker guarda o shell em cache. Ao publicar mudança no `index.html`,
suba a versão em `sw.js`:

```js
const VERSAO = 'painel-v2';
```

Sem isso o celular pode continuar servindo a versão antiga.

## Modelo de dados

Um documento por usuário em `painel/{uid}`:

```
cfg          { salario, tetoFds, sextaNoFds, metodoPadrao, comprometido[],
               contas[], corPrimaria, corSecundaria, memoria{}, metas{} }
lancamentos  [{ id, tipo, valor, descricao, categoria, metodo, carteira, data }]
pendencias   [{ id, titulo, data, hora, feito }]
chat         [{ de, txt, erro }]   últimas 40
```

`carteira` é um nome livre (ou `null`) que agrupa entradas e saídas de uma
reserva específica — é o que a aba **Carteiras** soma para mostrar quanto
entrou, quanto saiu e o saldo de cada uma.

`metas` guarda o alvo de cada carteira: `{ "Viagem": { valor, prazo } }`,
com `prazo` no formato `AAAA-MM`. A aba Carteiras usa isso para a barra de
progresso e para calcular quanto falta por mês. Uma carteira que só tem
meta, sem lançamento nenhum, também aparece — dá para planejar antes de
gastar.

`memoria` é como você costuma classificar cada coisa:
`{ "ifood": { cat: "iFood", met: "picpay", n: 5 } }`, onde `n` é quantas
vezes aquilo se repetiu (correção conta em dobro). Serve para três coisas:
vai no contexto da IA, preenche o que ela deixou em "Outros", e classifica
no parser offline. Dá para zerar em **⚙ > Limpar memória**.

## Contas, cartões e os dois jeitos de acompanhar

`contas` é a lista de bancos e cartões, cadastrada em **⚙ Ajustes**:

```
{ id, nome, tipo: 'corrente', saldo, saldoData }   conta / pix / dinheiro
{ id, nome, tipo: 'credito',  limite }             cartão de crédito
```

`metodo`, no lançamento, é o **id da conta** que pagou (ou onde a entrada
caiu) — não é mais um par fixo `picpay`/`conta`. Os valores antigos são
exatamente os ids que a migração cria, então nenhum lançamento precisou
ser reescrito.

O tipo da conta é o que decide a matemática, e daí saem dois jeitos de se
acompanhar, que convivem no mesmo app:

- **Por limite** (quem usa cartão): compra no crédito não sai do saldo
  agora, acumula fatura e entra na projeção do próximo salário. O número
  de cabeceira é o *limite livre*.
- **Por saldo** (quem só usa conta): entrada e saída mexem no saldo na
  hora. O número de cabeceira é o *saldo em conta*.

A tela **Hoje** escolhe sozinha qual dos dois mostrar: se existe cartão
com limite, mostra limite livre; se não, mostra saldo em conta. É a mesma
pergunta — "quanto ainda posso gastar" — respondida pelo que a pessoa
realmente usa.

`saldoData` é a âncora do saldo: significa "neste dia eu tinha isso", e o
saldo atual é esse valor mais tudo que entrou e saiu **depois** dele. Sem
a âncora o número não teria sentido, porque os lançamentos antigos já
estariam embutidos no saldo informado e seriam contados duas vezes — por
isso conta sem `saldoData` aparece como `—` em vez de partir de zero.
Reinformar o saldo é o jeito de reconciliar com o extrato do banco.

Backup manual em **⚙ > Baixar backup** — JSON completo, restaurável na
mesma tela.
