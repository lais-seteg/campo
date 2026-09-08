// ═══════════════════════════════════════════════════════════════════════
//  MIDDLEWARE — a PRIMEIRA barreira, não a última.
//
//  Ele roda em Edge Runtime e por isso não consulta o banco: só sabe o que
//  o cookie assinado diz. Faz três coisas:
//
//   1. barra quem não tem sessão assinada válida;
//   2. renova o access token do Supabase quando ele está para vencer —
//      é o único ponto da requisição que pode escrever cookie;
//   3. aplica ROTAS_RESTRITAS como filtro grosso de papel.
//
//  A checagem AUTORITATIVA de papel e de `ativo` é de lib/sessao.ts, que
//  tem o banco na mão (`exigirPapel` nas páginas, `autorizarApi` nas
//  rotas). Isto aqui é o que evita que uma navegação inteira chegue às
//  telas antes de alguém perguntar quem é.
//
//  Nada aqui pode importar supabase-js: ele não roda em Edge. Por isso as
//  dependências deste arquivo são só lib/token.ts, lib/papeis.ts,
//  lib/ambiente.ts e lib/supabaseAuthEdge.ts, todos escritos para serem
//  puros.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from "next/server";
import {
  CABECALHO_TOKEN_RENOVADO,
  COOKIE_SESSAO,
  assinarSessao,
  opcoesDoCookie,
  verificarSessao,
} from "@/lib/token";
import { precisaRenovar, renovarTokens } from "@/lib/supabaseAuthEdge";
import { restricaoDaRota } from "@/lib/papeis";
import { EM_PRODUCAO } from "@/lib/ambiente";

/**
 * Comparação EXATA, não `startsWith`: nenhuma das duas tem sub-rota, e
 * `startsWith` deixaria "/login-qualquer-coisa" e "/api/auth/loginX"
 * passarem como rota pública.
 */
const ROTAS_PUBLICAS = ["/login", "/api/auth/login"];

/**
 * Segue adiante SEMPRE por aqui.
 *
 * O `CABECALHO_TOKEN_RENOVADO` é um canal interno do middleware para o
 * Server Component. Como ele tem o mesmo nome venha de onde vier, um
 * cliente poderia mandá-lo à mão e escolher com qual access token o
 * servidor consultaria o banco — que é o inverso do modelo inteiro. Por
 * isso ele é APAGADO de toda requisição que entra, em todo caminho, e só
 * o próprio middleware o escreve de volta quando acabou de renovar.
 */
function seguir(request: NextRequest, tokenRenovado?: string): NextResponse {
  const cabecalhos = new Headers(request.headers);
  cabecalhos.delete(CABECALHO_TOKEN_RENOVADO);
  if (tokenRenovado) cabecalhos.set(CABECALHO_TOKEN_RENOVADO, tokenRenovado);
  return NextResponse.next({ request: { headers: cabecalhos } });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const cookie = request.cookies.get(COOKIE_SESSAO);
  const conteudo = cookie ? await verificarSessao(cookie.value) : null;

  if (ROTAS_PUBLICAS.includes(pathname)) {
    // `?sessao=invalida`: a página redirecionou para cá porque o BANCO
    // (que o middleware não consulta — ele só confere a assinatura)
    // rejeitou o cookie. Sem este desvio, o middleware veria a MESMA
    // assinatura como válida e mandaria de volta para /solicitacoes,
    // criando um pingue-pongue infinito entre as duas rotas.
    if (pathname === "/login" && !request.nextUrl.searchParams.has("sessao") && conteudo) {
      return NextResponse.redirect(new URL("/solicitacoes", request.url));
    }
    return seguir(request);
  }

  if (!conteudo) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }
    // Cookie presente mas rejeitado (assinatura inválida, expirado,
    // corrompido) é diferente de nunca ter entrado: havia uma sessão,
    // então a página de login diz que ela expirou em vez de mostrar o
    // formulário em branco.
    const destino = new URL(cookie ? "/login?sessao=invalida" : "/login", request.url);
    return NextResponse.redirect(destino);
  }

  const restricao = restricaoDaRota(pathname);
  if (restricao && !restricao.papeis.includes(conteudo.papel)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/solicitacoes", request.url));
  }

  // ── Renovação do access token do Supabase ──
  //
  // Sem isto, depois de uma hora toda consulta voltaria 401 do PostgREST e
  // a tela ficaria vazia sem explicar por quê — a sessão do app ainda
  // valeria seis dias, mas o token que a RLS enxerga não.
  if (!precisaRenovar(conteudo.accessTokenExpiraEm)) {
    return seguir(request);
  }

  const renovados = await renovarTokens(conteudo.refreshToken);
  if (!renovados) {
    // Refresh recusado: o Supabase considera a sessão encerrada. Limpa o
    // cookie para não ficar tentando renovar um token morto a cada
    // navegação, e manda para o login.
    const resposta = pathname.startsWith("/api/")
      ? NextResponse.json({ error: "Sessão expirada." }, { status: 401 })
      : NextResponse.redirect(new URL("/login?sessao=invalida", request.url));
    resposta.cookies.delete(COOKIE_SESSAO);
    return resposta;
  }

  // O cookie escrito aqui só chega ao Server Component na PRÓXIMA
  // requisição. Nesta, ele leria o cookie antigo — com o token que acabou
  // de vencer — e a tela quebraria justamente na navegação que renovou.
  // Daí o cabeçalho: lib/sessao.ts o consulta antes do cookie.
  const resposta = seguir(request, renovados.accessToken);
  const novoCookie = await assinarSessao({ ...conteudo, ...renovados });
  resposta.cookies.set(COOKIE_SESSAO, novoCookie, opcoesDoCookie(EM_PRODUCAO));
  return resposta;
}

export const config = {
  // Deixa de fora o que não precisa de sessão: os assets do Next, o
  // favicon e os arquivos estáticos de /public (fontes e imagens). Passar
  // cada .woff2 por uma verificação de JWT seria custo puro.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|fonts/|images/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2)$).*)",
  ],
};
