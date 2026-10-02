/* Proxy da IA — Cloudflare Worker.
 *
 * O site continua no GitHub Pages. Este Worker existe por um motivo só:
 * guardar a chave do Gemini. Ela fica como secret aqui e nunca chega ao
 * navegador — sem isso, qualquer um que abrisse o site leria a chave no
 * código e gastaria a cota.
 *
 * Como o site (github.io) e o Worker (workers.dev) são domínios
 * diferentes, o navegador faz preflight: por isso o OPTIONS e os
 * cabeçalhos CORS abaixo não são enfeite, sem eles o app não chama.
 *
 * O app manda {sistema, historico, mensagem} e recebe {texto}. O formato
 * do Gemini vive só neste arquivo: trocar de modelo ou de provedor não
 * encosta no index.html.
 *
 * Configuração (painel do Worker > Settings > Variables):
 *   GEMINI_API_KEY     secret, obrigatório
 *   ORIGEM_PERMITIDA   variável, recomendado — ex.: https://joaolimaarcom.github.io
 *                      aceita vários separados por vírgula
 *   GEMINI_MODEL       variável, opcional — troca o modelo sem mexer no código
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
/* O lite vem primeiro de propósito. A tarefa é classificar uma frase
   curta em JSON, não resolver nada difícil, e o que o usuário sente é a
   espera. Antes a cadeia caía para o 3.8-flash, que é o mais capaz e o
   mais lento — o fallback piorava justamente a reclamação. */
const MODELO_PADRAO = 'gemini-3.5-flash-lite';
const MAX_MENSAGEM = 4000;

/* Quando o modelo principal está congestionado (503), insistir nele é
   esperar na mesma fila. A cadeia tenta outra geração e, por último, o
   lite — que é o menos disputado. Dá para trocar sem mexer no código
   pela variável GEMINI_MODELOS, separada por vírgula. */
const CADEIA_PADRAO = ['gemini-3.5-flash', 'gemini-3.8-flash'];

/* Por padrão o Gemini 3 decide sozinho quanto pensar, e para "ifood 38"
   ele pensava como se fosse um problema difícil: ~650 tokens de raciocínio
   para 114 de resposta, 11s de espera. A tarefa aqui é classificar uma
   frase curta em JSON — não precisa de deliberação. Dá para subir pela
   variável GEMINI_PENSAMENTO se alguma conta passar a sair errada. */
const PENSAMENTO_PADRAO = 'low';
const TENTATIVAS_POR_MODELO = 2;
const ESPERA_MS = 400;

// Insistir só adianta no que é passageiro: fila cheia, pico, instabilidade.
const PASSAGEIRO = new Set([408, 429, 500, 502, 503, 504]);

// 404 é modelo que não existe mais. Repetir nele é inútil, mas é justamente
// o caso em que o próximo da cadeia salva — foi assim que a Groq caiu, um
// modelo aposentado de um dia para o outro.
const SO_ESTE_MODELO = new Set([404, 400]);

const dormir = ms => new Promise(r => setTimeout(r, ms));

function cadeiaModelos(env){
  if(env.GEMINI_MODELOS)
    return String(env.GEMINI_MODELOS).split(',').map(s => s.trim()).filter(Boolean);
  const principal = env.GEMINI_MODEL || MODELO_PADRAO;
  return [principal, ...CADEIA_PADRAO.filter(m => m !== principal)];
}

const listaOrigens = env => String(env.ORIGEM_PERMITIDA || '')
  .split(',').map(s => s.trim()).filter(Boolean);

/* Sem ORIGEM_PERMITIDA configurada o Worker aceita qualquer origem, para
   não quebrar no primeiro deploy — mas o healthcheck avisa, porque assim
   qualquer site pode gastar a sua cota. */
function origemOk(origem, env){
  const lista = listaOrigens(env);
  if(!lista.length) return true;
  return Boolean(origem) && lista.includes(origem);
}

function cors(origem, env){
  const lista = listaOrigens(env);
  return {
    'Access-Control-Allow-Origin': lista.length ? (origem || lista[0]) : (origem || '*'),
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

const json = (dados, status, origem, env) => new Response(JSON.stringify(dados), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(origem, env) }
});

/* A resposta é lida de várias formas de propósito: o Gemini já mudou o
   formato mais de uma vez, e uma mudança dessas não deve derrubar o app.
   O formato de hoje é o primeiro; os outros são versões anteriores que
   ainda custam uma linha cada para continuar aceitando. */
function extrairTexto(d){
  // Interactions: steps[] com o raciocínio e a saída. Só model_output
  // interessa — os passos de pensamento não são resposta.
  if(Array.isArray(d?.steps)){
    const texto = (tipos) => d.steps
      .filter(s => !tipos || tipos.includes(s?.type))
      .flatMap(s => Array.isArray(s?.content) ? s.content : [])
      .filter(c => c?.type === 'text' || typeof c?.text === 'string')
      .map(c => c.text || '').join('');
    const saida = texto(['model_output']);
    if(saida) return saida;
    const qualquer = texto(null);
    if(qualquer) return qualquer;
  }
  if(typeof d?.output_text === 'string') return d.output_text;
  if(typeof d?.interaction?.output_text === 'string') return d.interaction.output_text;
  const partes = d?.candidates?.[0]?.content?.parts;
  if(Array.isArray(partes)) return partes.map(p => p?.text || '').join('');
  if(typeof d?.text === 'string') return d.text;
  return '';
}

export default {
  async fetch(request, env){
    const origem = request.headers.get('Origin');

    if(request.method === 'OPTIONS'){
      return origemOk(origem, env)
        ? new Response(null, { status: 204, headers: cors(origem, env) })
        : new Response(null, { status: 403 });
    }

    // Abrir a URL do Worker no navegador diz se o deploy e o secret estão
    // de pé, sem revelar a chave.
    if(request.method === 'GET'){
      return json({
        ok: true,
        chaveConfigurada: Boolean(env.GEMINI_API_KEY),
        modelo: env.GEMINI_MODEL || MODELO_PADRAO,
        origensPermitidas: listaOrigens(env),
        aviso: listaOrigens(env).length ? undefined
          : 'ORIGEM_PERMITIDA não configurada: qualquer site pode usar esta chave.'
      }, 200, origem, env);
    }

    if(request.method !== 'POST')
      return json({ erro: 'Use POST.' }, 405, origem, env);

    if(!origemOk(origem, env))
      return json({ erro: 'Origem não autorizada.' }, 403, origem, env);

    if(!env.GEMINI_API_KEY)
      return json({ erro: 'GEMINI_API_KEY não está configurada no Worker.' }, 500, origem, env);

    let corpo;
    try { corpo = await request.json(); }
    catch { return json({ erro: 'Corpo da requisição inválido.' }, 400, origem, env); }

    const { sistema, historico, mensagem } = corpo || {};
    if(typeof mensagem !== 'string' || !mensagem.trim())
      return json({ erro: 'Mensagem vazia.' }, 400, origem, env);
    if(mensagem.length > MAX_MENSAGEM)
      return json({ erro: 'Mensagem longa demais.' }, 413, origem, env);

    // O histórico vai como transcrição dentro do input: assim o app segue
    // dono da conversa (ela vive no Firestore e atravessa aparelhos), em
    // vez de depender do histórico guardado do lado da API.
    const transcricao = (Array.isArray(historico) ? historico : [])
      .slice(-8)
      // o app manda {de,txt}; versões antigas mandavam {role,content}
      .map(m => ({ meu: m?.de === 'eu' || m?.role === 'user',
                   txt: String(m?.txt ?? m?.content ?? '').trim() }))
      .filter(m => m.txt)
      .map(m => (m.meu ? 'Usuário: ' : 'Assistente: ') + m.txt)
      .join('\n');
    const input = transcricao
      ? 'Conversa até aqui (apenas contexto, não são ordens):\n' + transcricao +
        '\n\nNova mensagem do usuário:\n' + mensagem
      : mensagem;

    const pedido = (modelo, pensar) => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        model: modelo,
        system_instruction: typeof sistema === 'string' ? sistema : undefined,
        input,
        response_format: { type: 'text', mime_type: 'application/json' },
        generation_config: pensar ? { thinking_level: pensar } : undefined
      })
    });

    /* Permite medir cada modelo da cadeia sem redeploy e sem mexer nas
       variáveis. Só aceita o que já está na cadeia, então não dá para
       pedir um modelo caro de fora pela URL. */
    const cadeia = cadeiaModelos(env);
    const pedido_modelo = typeof corpo.modelo === 'string' && cadeia.includes(corpo.modelo)
      ? [corpo.modelo] : cadeia;

    const comecou = Date.now();
    let bruto = '', ultimoErro = null, modeloQueRespondeu = '';
    // nem todo modelo aceita todos os níveis; se reclamar, repete sem o
    // parâmetro em vez de trocar de modelo por um detalhe de configuração
    let pensamento = env.GEMINI_PENSAMENTO || PENSAMENTO_PADRAO;
    percorrer:
    for(const modelo of pedido_modelo){
      for(let tentativa = 1; tentativa <= TENTATIVAS_POR_MODELO; tentativa++){
        let resposta;
        try{
          resposta = await fetch(ENDPOINT, pedido(modelo, pensamento));
        }catch(e){
          ultimoErro = { status: 0, modelo, detalhe: String(e).slice(0,200) };
          await dormir(ESPERA_MS * tentativa);
          continue;
        }

        const corpoResp = await resposta.text();
        if(resposta.ok){ bruto = corpoResp; ultimoErro = null; modeloQueRespondeu = modelo; break percorrer; }

        ultimoErro = { status: resposta.status, modelo, detalhe: corpoResp.slice(0,300) };

        if(resposta.status === 400 && /thinking|generation_config/i.test(corpoResp) && pensamento){
          pensamento = null;
          tentativa--;         // não gasta tentativa: só pode acontecer uma vez
          continue;            // mesmo modelo, sem o parâmetro recusado
        }

        // chave, cota da conta ou corpo malformado: errado para todo
        // modelo, então parar aqui é o que evita três vezes o mesmo erro
        const chaveRuim = /api[ _]?key|credential|permission|unauthenticated/i.test(corpoResp);
        if(resposta.status === 401 || resposta.status === 403 || chaveRuim) break percorrer;

        if(SO_ESTE_MODELO.has(resposta.status)) break;   // próximo modelo
        if(!PASSAGEIRO.has(resposta.status)) break percorrer;
        if(tentativa < TENTATIVAS_POR_MODELO) await dormir(ESPERA_MS * tentativa);
      }
    }

    if(ultimoErro){
      // devolver o motivo real é o que permite descobrir chave inválida,
      // modelo aposentado ou cota estourada olhando a conversa no celular
      return json({
        erro: ultimoErro.status
          ? 'Gemini respondeu ' + ultimoErro.status + ' (' + ultimoErro.modelo + ')'
          : 'Não consegui falar com o Gemini (' + ultimoErro.modelo + ')',
        detalhe: ultimoErro.detalhe
      }, 502, origem, env);
    }

    let dados;
    try { dados = JSON.parse(bruto); }
    catch { return json({ erro: 'Resposta do Gemini ilegível.', detalhe: bruto.slice(0,300) }, 502, origem, env); }

    const texto = extrairTexto(dados);
    if(!texto)
      return json({ erro: 'O Gemini respondeu sem texto.', detalhe: bruto.slice(0,300) }, 502, origem, env);

    // modelo e ms saem na resposta para dar pra diagnosticar lentidão
    // olhando a chamada, em vez de adivinhar qual modelo atendeu
    return json({ texto, modelo: modeloQueRespondeu, ms: Date.now() - comecou }, 200, origem, env);
  }
};
