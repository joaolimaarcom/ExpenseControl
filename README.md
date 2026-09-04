# Painel — grana e pendências

App de uma página para controlar gastos, limite de crédito e pendências do dia a dia.
Roda em GitHub Pages, sincroniza no Firestore e instala como app no celular (PWA).

## Arquivos

| arquivo | função |
|---|---|
| `index.html` | o app inteiro (UI, cálculos, Firestore, Groq) |
| `sw.js` | service worker — cache do shell, funciona offline |
| `manifest.webmanifest` | PWA: nome, cores, ícones |
| `icone-192.png` / `icone-512.png` | ícones da tela inicial |
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

## 2. Groq

Pegue uma chave em [console.groq.com](https://console.groq.com/keys).
É o que interpreta o texto livre ("ifood 38", "amanhã 9h reunião").
Sem ela o app continua funcionando: o botão `+` faz lançamento manual e
existe um parser local básico para "gastei/recebi".

## 3. Preencher a config

No topo do `<script type="module">` do `index.html`:

```js
const CONFIG = {
  firebase: {
    apiKey:     "...",
    authDomain: "seu-projeto.firebaseapp.com",
    projectId:  "seu-projeto",
    appId:      "..."
  },
  groq: { key: "...", model: "openai/gpt-oss-120b" }
};
```

## 4. Publicar

```bash
git init
git add .
git commit -m "painel"
git branch -M main
git remote add origin git@github.com:SEU-USUARIO/painel.git
git push -u origin main
```

**Settings > Pages > Source: Deploy from a branch > main / (root)**.
Em um ou dois minutos: `https://SEU-USUARIO.github.io/painel/`.

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

A **chave da Groq é diferente**: ela fica visível no código, em repositório
público. Quem achar pode gastar a sua cota. Não expõe seus dados, mas gera
custo e é a parte fraca desse desenho. Três saídas, da mais simples à mais
correta:

1. **Aceitar e monitorar** — cota gratuita, chave descartável, você rotaciona
   se notar uso estranho. É o mesmo tradeoff que você já fez no Conspect.
2. **Repositório privado** — GitHub Pages em repo privado exige plano pago.
3. **Proxy** — um Cloudflare Worker de 20 linhas guarda a chave e só aceita
   requisição do seu domínio. É o jeito certo; se quiser, a gente monta.

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
cfg          { salario, limite, tetoFds, sextaNoFds, metodoPadrao, comprometido[],
               corPrimaria, corSecundaria }
lancamentos  [{ id, tipo, valor, descricao, categoria, metodo, carteira, data }]
pendencias   [{ id, titulo, data, hora, feito }]
chat         [{ de, txt, erro }]   últimas 40
```

`carteira` é um nome livre (ou `null`) que agrupa entradas e saídas de uma
reserva específica — é o que a aba **Carteiras** soma para mostrar quanto
entrou, quanto saiu e o saldo de cada uma.

`metodo` é `picpay` (crédito, entra na fatura do mês seguinte) ou `conta`
(pix/débito, sai agora). É a distinção que sustenta a projeção do próximo
salário.

Backup manual em **⚙ > Baixar backup** — JSON completo, restaurável na
mesma tela.
