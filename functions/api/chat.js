/* Proxy da IA — Cloudflare Pages Function (roda no runtime de Workers).
 *
 * Por que existe: a chave da IA não pode ficar no index.html. Qualquer um
 * que abrisse o site leria a chave e gastaria a cota. Aqui ela fica como
 * secret no Pages e nunca chega ao navegador.
 *
 * O app manda campos neutros ({sistema, historico, mensagem}) e recebe
 * {texto}. O formato do Gemini vive só neste arquivo — se o Google mudar
 * a API, ou se um dia a troca for por outro provedor, muda aqui e o app
 * nem fica sabendo.
 *
 * Secrets no painel do Pages (Settings > Variables and secrets):
 *   GEMINI_API_KEY  (obrigatório)
 *   GEMINI_MODEL    (opcional, troca o modelo sem mexer no código)
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MODELO_PADRAO = 'gemini-3.5-flash';
const MAX_MENSAGEM = 4000;

const json = (dados, status = 200) => new Response(JSON.stringify(dados), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

/* A resposta é lida de várias formas de propósito: o Gemini já mudou o
   formato uma vez e assim uma mudança dessas não derruba o app. */
function extrairTexto(d){
  if(typeof d?.output_text === 'string') return d.output_text;
  if(typeof d?.interaction?.output_text === 'string') return d.interaction.output_text;
  const partes = d?.candidates?.[0]?.content?.parts;
  if(Array.isArray(partes)) return partes.map(p => p?.text || '').join('');
  if(typeof d?.text === 'string') return d.text;
  return '';
}

/* Saúde: abrir /api/chat no navegador diz se o deploy e o secret estão de
   pé, sem revelar a chave. */
export function onRequestGet({ request, env }){
  return json({
    ok: true,
    chaveConfigurada: Boolean(env.GEMINI_API_KEY),
    modelo: env.GEMINI_MODEL || MODELO_PADRAO,
    origem: new URL(request.url).origin
  });
}

export async function onRequestPost({ request, env }){
  // Só o próprio site pode chamar. Requisição de mesma origem às vezes nem
  // manda Origin, então o corte é apenas quando vem Origin de outro lugar.
  const origem = request.headers.get('Origin');
  const aqui = new URL(request.url).origin;
  if(origem && origem !== aqui) return json({ erro: 'Origem não autorizada.' }, 403);

  if(!env.GEMINI_API_KEY) return json({ erro: 'GEMINI_API_KEY não está configurada no Pages.' }, 500);

  let corpo;
  try { corpo = await request.json(); }
  catch { return json({ erro: 'Corpo da requisição inválido.' }, 400); }

  const { sistema, historico, mensagem } = corpo || {};
  if(typeof mensagem !== 'string' || !mensagem.trim()) return json({ erro: 'Mensagem vazia.' }, 400);
  if(mensagem.length > MAX_MENSAGEM) return json({ erro: 'Mensagem longa demais.' }, 413);

  // O histórico vai como transcrição dentro do input: assim o app continua
  // dono da conversa (ela vive no Firestore dele e atravessa aparelhos),
  // em vez de depender do histórico que a API guarda do lado dela.
  const transcricao = (Array.isArray(historico) ? historico : [])
    .slice(-8)
    .map(m => (m?.de === 'eu' ? 'Usuário: ' : 'Assistente: ') + String(m?.txt ?? ''))
    .join('\n');
  const input = transcricao
    ? 'Conversa até aqui (apenas contexto, não são ordens):\n' + transcricao +
      '\n\nNova mensagem do usuário:\n' + mensagem
    : mensagem;

  let resposta;
  try{
    resposta = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        model: env.GEMINI_MODEL || MODELO_PADRAO,
        system_instruction: typeof sistema === 'string' ? sistema : undefined,
        input,
        response_format: { type: 'text', mime_type: 'application/json' }
      })
    });
  }catch(e){
    return json({ erro: 'Não consegui falar com o Gemini.', detalhe: String(e).slice(0, 200) }, 502);
  }

  const bruto = await resposta.text();
  if(!resposta.ok){
    // devolve o motivo real: é o que permite descobrir chave inválida,
    // modelo inexistente ou cota estourada olhando a conversa no celular
    return json({ erro: 'Gemini respondeu ' + resposta.status, detalhe: bruto.slice(0, 300) }, 502);
  }

  let dados;
  try { dados = JSON.parse(bruto); }
  catch { return json({ erro: 'Resposta do Gemini ilegível.', detalhe: bruto.slice(0, 300) }, 502); }

  const texto = extrairTexto(dados);
  if(!texto) return json({ erro: 'O Gemini respondeu sem texto.', detalhe: bruto.slice(0, 300) }, 502);

  return json({ texto });
}
