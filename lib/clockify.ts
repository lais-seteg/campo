// ═══════════════════════════════════════════════════════════════════════
//  CLOCKIFY — a lista de projetos que alimenta o campo "Código Clockify".
//
//  ── O QUE MUDOU, E POR QUE IMPORTA ──
//
//  Antes esta chamada saía do NAVEGADOR, com a chave no cabeçalho
//  `X-Api-Key`. O comentário do env.example.js dizia a verdade sem meias
//  palavras: "isto tira a chave do REPOSITÓRIO, não do NAVEGADOR — ela
//  aparece para quem abrir o DevTools no site publicado. Tirá-la do
//  navegador exigiria uma função no servidor repassando a chamada."
//
//  Esta é a função no servidor. A chave agora é uma variável de ambiente,
//  o navegador nunca a vê, e `api.clockify.me` saiu do `connect-src` da
//  CSP — o cliente só fala com este app.
//
//  ── A INTEGRAÇÃO NÃO PODE DERRUBAR NADA ──
//
//  Sem a chave, ou com o Clockify fora do ar, o campo continua aceitando o
//  código digitado à mão e a tela diz o motivo. Cadastro de projeto não
//  trava por causa de um autocompletar.
// ═══════════════════════════════════════════════════════════════════════

import { CLOCKIFY_API_KEY, CLOCKIFY_WORKSPACE_ID } from "@/lib/ambiente";

const CLOCKIFY_URL = "https://api.clockify.me/api/v1";

/** O Clockify pagina. O teto de 10 páginas (2.000 projetos) existe para um
 *  erro de paginação não virar laço infinito — hoje o workspace tem 268
 *  projetos no bruto. */
const MAX_PAGINAS = 10;
const POR_PAGINA = 200;

/** A rede não pode segurar a renderização de uma tela por causa disto. */
const TIMEOUT_MS = 8000;

export interface ProjetoClockify {
  id: string;
  /** O que ENTRA no campo, sem o "#". */
  codigo: string;
  /** A dica na lista. */
  nome: string;
  cliente: string;
}

export interface ListaClockify {
  projetos: ProjetoClockify[];
  /** Frase pronta para a tela quando não deu — `null` quando deu certo. */
  erro: string | null;
}

interface ProjetoBruto {
  id?: unknown;
  name?: unknown;
  clientName?: unknown;
}

async function pedir(caminho: string): Promise<unknown> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS);
  try {
    const resposta = await fetch(`${CLOCKIFY_URL}${caminho}`, {
      headers: { "X-Api-Key": CLOCKIFY_API_KEY },
      signal: controle.signal,
      // A lista muda pouco, mas não a ponto de valer cache de build: é
      // consultada quando alguém abre o cadastro, e queremos o estado de
      // agora.
      cache: "no-store",
    });
    if (!resposta.ok) {
      // 401/403 é a resposta que aparece quando a chave venceu ou foi
      // revogada — dizer isso poupa quem for procurar o problema.
      throw new Error(
        resposta.status === 401 || resposta.status === 403
          ? "A chave do Clockify foi recusada (vencida ou sem permissão)."
          : `O Clockify respondeu ${resposta.status}.`
      );
    }
    return resposta.json();
  } finally {
    clearTimeout(relogio);
  }
}

export async function listarProjetosDoClockify(): Promise<ListaClockify> {
  if (!CLOCKIFY_API_KEY) {
    return {
      projetos: [],
      erro: "Sem a chave do Clockify (CLOCKIFY_API_KEY) — o campo aceita o código digitado. Veja .env.example.",
    };
  }

  try {
    let workspaceId = CLOCKIFY_WORKSPACE_ID;
    if (!workspaceId) {
      const workspaces = await pedir("/workspaces");
      if (!Array.isArray(workspaces) || !workspaces.length) {
        throw new Error("A chave do Clockify não tem nenhum workspace.");
      }
      const primeiro = workspaces[0] as { id?: unknown };
      if (typeof primeiro?.id !== "string") throw new Error("Resposta inesperada do Clockify.");
      workspaceId = primeiro.id;
    }

    const brutos: ProjetoBruto[] = [];
    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      // `archived=false`: não se abre campo novo em projeto encerrado.
      const lote = await pedir(
        `/workspaces/${workspaceId}/projects?archived=false&page-size=${POR_PAGINA}&page=${pagina}`
      );
      if (!Array.isArray(lote) || !lote.length) break;
      brutos.push(...(lote as ProjetoBruto[]));
      if (lote.length < POR_PAGINA) break;
    }

    return { projetos: interpretarProjetos(brutos), erro: null };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return {
      projetos: [],
      erro:
        mensagem === "The operation was aborted." || /abort/i.test(mensagem)
          ? "O Clockify demorou demais para responder — o campo aceita o código digitado."
          : mensagem,
    };
  }
}

/**
 * A MESMA leitura do sgc-seteg, que consome este mesmo workspace:
 *
 *  · projeto cujo nome COMEÇA com CANCELADO ou FINALIZADO fica de fora.
 *    Só no começo — projeto com "finalizado" no meio da descrição vale;
 *  · o nome segue o padrão "#CODIGO (Nome do empreendimento)". O código é
 *    o que vai para o campo "Código Clockify"; o nome é a dica na lista.
 *    Nome fora do padrão vira código dele mesmo — melhor do que sumir;
 *  · o "#" sai: o código é gravado sem ele ("0189-3-2025").
 */
export function interpretarProjetos(brutos: readonly ProjetoBruto[]): ProjetoClockify[] {
  const ignorar = /^(CANCELADO|FINALIZADO)/i;

  return brutos
    .flatMap((p) => {
      const id = typeof p.id === "string" ? p.id : "";
      const nomeBruto = typeof p.name === "string" ? p.name.trim() : "";
      const cliente = typeof p.clientName === "string" ? p.clientName.trim() : "";
      if (!id || !nomeBruto || ignorar.test(nomeBruto)) return [];

      const casa = /^(#[^\s(]+)\s*(?:\((.+)\))?$/.exec(nomeBruto);
      const codigo = (casa?.[1] ?? nomeBruto).replace(/^#/, "").trim();
      if (!codigo) return [];

      const nome = casa?.[2]?.trim() || cliente || nomeBruto;
      return [{ id, codigo, nome, cliente }];
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}
