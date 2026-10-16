# Contas a pagar

Uma página só, para responder uma pergunta só: **quanto eu tenho que pagar
mês que vem, e em qual cartão.**

Você anota o que passou no cartão — valor, cartão, parcelas — e a tela
mostra o total do mês, quanto cai em cada cartão e o que vem pela frente.
Abre já no mês que vem, que é quando a pergunta costuma aparecer.

Roda no GitHub Pages, sincroniza no Firestore e instala como app no
celular (PWA).

## Arquivos

| arquivo | função |
|---|---|
| `index.html` | o app inteiro (tela, contas, Firestore) |
| `sw.js` | service worker — funciona offline |
| `manifest.webmanifest` | PWA: nome, cores, ícones |
| `icone-192.png` / `icone-512.png` | ícones da tela inicial |
| `firestore.rules` | regras de segurança do banco |

## Como funciona o cálculo

Um gasto guarda o **valor total da compra**, em **quantas parcelas** ela
cai e em **qual fatura** a primeira entra:

```
{ desc, valor, cartaoId, parcelas, mesInicial }
```

O que aparece em cada mês é derivado disso — a compra não é copiada mês a
mês. Por isso corrigir um valor conserta todos os meses de uma vez, e
excluir não deixa sobra em lugar nenhum.

As parcelas são divididas em centavos e a sobra vai na primeira, como o
banco faz: R$ 100 em 3x vira 33,34 + 33,33 + 33,33. Sem isso a soma das
parcelas nunca fecharia com o valor da compra.

No formulário, **"total" ou "por mês"** decide como o valor digitado é
lido. Compra parcelada você costuma saber o total ("TV de 2.000 em 10x");
financiamento você sabe a prestação ("1.928 por mês até 09/27"). Os dois
chegam no mesmo lugar.

## 1. Firebase

1. Crie um projeto no [console do Firebase](https://console.firebase.google.com).
2. **Build > Firestore Database > Criar** — modo produção, região `southamerica-east1`.
3. **Build > Authentication > Começar > Google** — ativar.
4. Em **Authentication > Settings > Domínios autorizados**, adicione
   `SEU-USUARIO.github.io`. Sem isso o login falha em produção.
5. **Configurações do projeto > Seus apps > Web** — registre um app e copie
   `apiKey`, `authDomain`, `projectId`, `appId` para o `CONFIG` no topo do
   `<script type="module">` do `index.html`.
6. **Firestore > Regras** — cole o conteúdo de `firestore.rules` e publique.

O app guarda tudo em **`contas/{uid}`**, um documento por usuário:

```
cartoes  [{ id, nome }]
gastos   [{ id, desc, valor, cartaoId, parcelas, mesInicial, criadoEm }]
```

## 2. Publicar no GitHub Pages

1. **Settings > Pages** → Source: **Deploy from a branch** → branch `main`,
   pasta `/ (root)` → **Save**.
2. Em um ou dois minutos o site está em
   `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

Não existe build: os arquivos da raiz são servidos como estão. Publicar é
dar `git push` na `main`.

## 3. Instalar no celular

Abra a URL no Chrome → menu → **Adicionar à tela inicial**.
No iPhone é pelo Safari → compartilhar → **Adicionar à Tela de Início**.

**O login com Google é obrigatório** — é o que faz os dados aparecerem no
celular e no computador. Depois de entrar uma vez, o app funciona
**offline**: o Firestore mantém um cache local, serve os dados de lá e
enfileira o que você anotar, sincronizando quando a rede volta.

## Segurança

O `apiKey` do Firebase é público por natureza, não é segredo. Quem protege
os dados são as **regras do Firestore**, então elas precisam estar
publicadas antes do primeiro dado entrar. Com `firestore.rules`, ninguém lê
seu documento sem estar logado com a sua conta.

Não há nenhuma chave de IA neste app — não há IA nenhuma. Se você usou a
versão anterior, que chamava o Gemini por um Worker da Cloudflare, dá para
**apagar o Worker e revogar a chave**: nada aqui depende mais deles.

## Atualizar depois

A página vem da rede quando há rede, com o cache como rede de segurança —
assim uma publicação nova vale já no primeiro acesso, em vez de só no
segundo. Mesmo assim, suba a versão em `sw.js` ao publicar:

```js
const VERSAO = 'contas-v1';
```

Backup manual em **⚙ > Baixar backup** — JSON completo, restaurável na
mesma tela.

## O que existia antes

Este repositório era um painel de planejamento: salário, teto por fim de
semana, carteiras com metas, agenda, streak de dias sem gastar e captura
por texto com IA. Tudo isso saiu porque a pergunta real era outra, mas o
histórico continua no git — `git log` acha, e a coleção `painel/{uid}` no
Firestore segue intacta com os dados antigos.
