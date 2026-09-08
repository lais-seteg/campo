// ═══════════════════════════════════════════════════════════════════════
//  A SESSÃO, DO LADO QUE TEM ACESSO AO BANCO
//
//  Duas barreiras, e elas não são redundantes:
//
//   1. middleware.ts — roda em Edge, NÃO consulta o banco. Confere a
//      assinatura do cookie e o papel contra ROTAS_RESTRITAS. É rápido e
//      cobre a navegação inteira de uma vez.
//   2. este arquivo — roda com acesso ao banco. Revalida `perfis.ativo` e
//      é a palavra final. Sem ele, um acesso desativado continuaria
//      entrando por até 7 dias (a validade do cookie).
//
//  Este módulo NÃO pode ser importado pelo middleware: ele carrega o
//  supabase-js, que não roda em Edge Runtime. Middleware importa
//  lib/token.ts e lib/papeis.ts, que são puros de propósito. É a mesma
//  divisão do clockrview (lib/session.ts × lib/token.ts).
// ═══════════════════════════════════════════════════════════════════════

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { CABECALHO_TOKEN_RENOVADO, COOKIE_SESSAO, verificarSessao, type ConteudoSessao } from "@/lib/token";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { restricaoDaRota } from "@/lib/papeis";
import type { Papel, Perfil } from "@/lib/tipos";

/** A sessão já validada contra o banco, do jeito que as telas usam. */
export interface UsuarioLogado {
  id: string;
  usuario: string;
  nome: string;
  papel: Papel;
  cargo: string | null;
  /**
   * O veto individual sobre valor (`perfis.ve_valores`). Vem do BANCO a
   * cada requisição, como o papel — e pelo mesmo motivo: tirar o valor de
   * alguém não pode esperar o cookie expirar.
   *
   * `!== false` e não `=== true`: enquanto a coluna não existir no banco
   * compartilhado, o campo chega `undefined`, e o padrão tem de ser
   * "o papel decide", que é o que o `default true` do banco diz.
   */
  veValores: boolean;
  /** Repassado a `clienteDoUsuario()` — é ele que faz a RLS reconhecer a pessoa. */
  accessToken: string;
}

/**
 * Lê o cookie, confere a assinatura e REVALIDA o perfil no banco.
 *
 * O `select *` do perfil é herdado da versão anterior, e a razão continua
 * valendo: coluna nova no banco compartilhado não pode derrubar o login de
 * um site já publicado.
 *
 * O papel vem do BANCO, não do cookie. Se a Gestão rebaixar alguém de
 * `direcao` para `tecnico`, o cookie assinado ainda diz `direcao` por até
 * 7 dias — e é aqui que essa mentira morre.
 *
 * `cache()` do React memoiza POR REQUISIÇÃO: o layout, a página e cada
 * componente que perguntam quem está logado fazem UMA consulta a `perfis`,
 * não uma cada. Não é cache entre requisições nem entre pessoas — o
 * escopo é a renderização em curso.
 */
export const obterSessao = cache(async (): Promise<UsuarioLogado | null> => {
  const conteudo = await conteudoDaSessao();
  if (!conteudo) return null;

  const accessToken = accessTokenVigente(conteudo);
  const perfil = await lerPerfil(conteudo.id, accessToken);
  if (!perfil || !perfil.ativo) return null;

  return {
    id: perfil.id,
    usuario: perfil.usuario,
    nome: perfil.nome,
    papel: perfil.papel,
    cargo: perfil.cargo,
    veValores: perfil.ve_valores !== false,
    accessToken,
  };
});

/** O cookie lido e com a assinatura conferida. SEM tocar no banco. */
const conteudoDaSessao = cache(async (): Promise<ConteudoSessao | null> => {
  const cookie = cookies().get(COOKIE_SESSAO);
  if (!cookie) return null;
  return verificarSessao(cookie.value);
});

/**
 * O access token de quem está pedindo, direto do cookie — sem esperar o
 * banco.
 *
 * ── PARA QUE ISTO EXISTE ──
 *
 * O token NÃO vem de `perfis`: ele vem assinado dentro do cookie. Então a
 * leitura de dados que depende dele não precisa esperar a revalidação do
 * perfil, e é isso que o layout aproveita — dispara `carregarDados()` e a
 * conferência do perfil ao mesmo tempo, em vez de uma atrás da outra.
 *
 * Eram duas esperas de rede empilhadas em cada navegação; viraram uma.
 *
 * ── O QUE ISTO NÃO É ──
 *
 * Não é autorização, e não substitui `obterSessao()`. Um cookie
 * perfeitamente assinado de alguém DESATIVADO passa por aqui — quem mata
 * essa mentira é a leitura de `perfis.ativo` em `obterSessao()`, e ela
 * continua acontecendo em toda requisição. Este token só serve para
 * começar a perguntar ao banco; o banco, com a RLS, é que decide o que
 * responde.
 */
export const tokenDaSessao = cache(async (): Promise<string | null> => {
  const conteudo = await conteudoDaSessao();
  return conteudo ? accessTokenVigente(conteudo) : null;
});

/**
 * O token do cookie está uma renovação atrás quando o middleware acabou de
 * renovar NESTA requisição — o cookie novo só valerá na próxima. Nesse
 * caso ele repassa o token fresco por um cabeçalho interno, que já foi
 * limpo de tudo que veio de fora (ver `seguir()` em middleware.ts).
 */
function accessTokenVigente(conteudo: ConteudoSessao): string {
  const renovado = headers().get(CABECALHO_TOKEN_RENOVADO);
  return renovado && renovado.trim() ? renovado : conteudo.accessToken;
}

async function lerPerfil(id: string, accessToken: string): Promise<Perfil | null> {
  const sb = clienteDoUsuario(accessToken);
  const { data, error } = await sb.from("perfis").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as Perfil;
}

/**
 * Garante que existe sessão válida. Sem papel nenhum em jogo.
 *
 * O `?sessao=invalida` no redirect quebra um pingue-pongue real: o
 * middleware só confere a ASSINATURA do cookie, então um cookie
 * perfeitamente assinado de alguém que foi desativado passa por ele — e só
 * aqui, com o banco na mão, é rejeitado. Sem o parâmetro, o middleware
 * veria em /login o mesmo cookie "válido" e mandaria de volta para
 * /solicitacoes, em loop. Com ele, o middleware deixa a página de login
 * renderizar, e ela mesma limpa o cookie de vez.
 */
export async function exigirSessao(): Promise<UsuarioLogado> {
  const usuario = await obterSessao();
  if (!usuario) redirect("/login?sessao=invalida");
  return usuario;
}

/**
 * Garante sessão E papel. Repete de propósito a checagem do middleware:
 * esta é a autoritativa, porque só ela sabe o papel de AGORA.
 *
 * Quem está logado mas sem permissão vai para /solicitacoes, não para o
 * login — mandar para o login sugeriria que o problema é a sessão.
 */
export async function exigirPapel(papeis: readonly Papel[]): Promise<UsuarioLogado> {
  const usuario = await exigirSessao();
  if (!papeis.includes(usuario.papel)) redirect("/solicitacoes");
  return usuario;
}

// ─── Rotas de API ────────────────────────────────────────────────────────
//
// Página redireciona; rota de API responde com status. Um `redirect()`
// dentro de um `fetch()` vira um 200 com HTML de login, e o cliente
// tentaria fazer `JSON.parse` disso.

export type ResultadoAutorizacao =
  | { ok: true; usuario: UsuarioLogado }
  | { ok: false; resposta: NextResponse };

/**
 * Autoriza uma rota de API: exige sessão e aplica a restrição de papel
 * declarada em ROTAS_RESTRITAS para aquele caminho.
 *
 * Passar o `pathname` (em vez de a rota repetir a lista de papéis) é o que
 * evita a divergência clássica: proteger a página e esquecer a rota de API
 * que ela chama. A lista está num lugar só, em lib/papeis.ts.
 */
export async function autorizarApi(pathname: string): Promise<ResultadoAutorizacao> {
  const usuario = await obterSessao();
  if (!usuario) {
    return { ok: false, resposta: NextResponse.json({ error: "Não autenticado." }, { status: 401 }) };
  }

  const restricao = restricaoDaRota(pathname);
  if (restricao && !restricao.papeis.includes(usuario.papel)) {
    return { ok: false, resposta: NextResponse.json({ error: "Acesso negado." }, { status: 403 }) };
  }

  return { ok: true, usuario };
}
