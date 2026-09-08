// ═══════════════════════════════════════════════════════════════════════
//  POST /api/auth/logout
//
//  Sair é duas coisas, e fazer só uma delas deixa a sessão viva:
//
//   1. apagar o cookie deste app;
//   2. revogar o refresh token no Supabase.
//
//  Sem (2), o refresh token continuaria válido do lado do Supabase — e
//  quem tivesse conseguido uma cópia dele trocaria por access tokens
//  novos por semanas, mesmo com a pessoa "deslogada". Sem (1), o
//  navegador seguiria mandando um cookie que não abre mais nada.
//
//  POST, e não GET, de propósito: com sameSite=lax um GET de terceiro
//  (uma <img src="/api/auth/logout">) deslogaria a pessoa sem que ela
//  pedisse. É um CSRF de baixo impacto, mas é gratuito não ter.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, verificarSessao } from "@/lib/token";
import { clienteDoUsuario } from "@/lib/supabaseServidor";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const cookie = request.cookies.get(COOKIE_SESSAO);

  if (cookie) {
    const conteudo = await verificarSessao(cookie.value);
    if (conteudo) {
      try {
        // `signOut` do supabase-js revoga a sessão à qual o token pertence.
        await clienteDoUsuario(conteudo.accessToken).auth.signOut();
      } catch (erro) {
        // Falhar aqui não pode impedir de sair: o cookie some de qualquer
        // jeito logo abaixo, e a pessoa fica sem acesso a este app. O que
        // fica pendente é a revogação do lado do Supabase — registra para
        // não passar despercebido.
        console.error("[POST /api/auth/logout] falha ao revogar a sessão no Supabase", erro);
      }
    }
  }

  const resposta = NextResponse.json({ ok: true });
  resposta.cookies.delete(COOKIE_SESSAO);
  return resposta;
}
