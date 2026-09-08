// ═══════════════════════════════════════════════════════════════════════
//  RENOVAÇÃO DO ACCESS TOKEN DO SUPABASE — versão que roda em Edge.
//
//  O access token do Supabase vale cerca de uma hora; o cookie de sessão
//  vale sete dias. Alguém tem de trocar um pelo outro no meio do caminho,
//  e esse alguém é o middleware — é o único ponto por onde toda navegação
//  passa E que pode ESCREVER cookie. Server Component não pode: quando ele
//  renderiza, os cabeçalhos da resposta já foram decididos.
//
//  Por que `fetch` cru e não o supabase-js: o middleware roda em Edge
//  Runtime e o supabase-js não roda lá. A API de refresh do GoTrue é um
//  POST simples, então não vale arrastar a biblioteca inteira (nem criar
//  um segundo lugar onde o app escolhe runtime).
//
//  Na versão anterior quem fazia isso era o supabase-js no NAVEGADOR, com
//  os dois tokens no localStorage. Ter trazido a renovação para cá é o que
//  permitiu o cookie httpOnly: o refresh token nunca mais é visível a
//  JavaScript de página.
// ═══════════════════════════════════════════════════════════════════════

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/ambiente";

export interface TokensSupabase {
  accessToken: string;
  refreshToken: string;
  /** Epoch em SEGUNDOS. */
  accessTokenExpiraEm: number;
}

/**
 * Renova a sessão do Supabase a partir do refresh token.
 * Devolve `null` quando o refresh foi recusado — token já usado, revogado
 * ou de um usuário apagado. Nesse caso a sessão acabou: o chamador tem de
 * mandar a pessoa para o login, não tentar de novo.
 */
export async function renovarTokens(refreshToken: string): Promise<TokensSupabase | null> {
  try {
    const resposta = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      // O middleware não deve reaproveitar resposta de renovação de
      // ninguém — nem a própria, um segundo depois.
      cache: "no-store",
    });

    if (!resposta.ok) return null;

    const corpo: unknown = await resposta.json();
    return extrairTokens(corpo);
  } catch {
    // Rede caiu no meio. Tratar como "não renovou": a sessão atual segue
    // valendo até expirar de fato, e a próxima navegação tenta de novo.
    return null;
  }
}

/** O GoTrue responde `{ access_token, refresh_token, expires_at, ... }`.
 *  `expires_at` é epoch em segundos; quando falta, calcula a partir de
 *  `expires_in`. */
export function extrairTokens(corpo: unknown): TokensSupabase | null {
  if (typeof corpo !== "object" || corpo === null) return null;
  const c = corpo as Record<string, unknown>;

  const accessToken = typeof c.access_token === "string" ? c.access_token : null;
  const refreshToken = typeof c.refresh_token === "string" ? c.refresh_token : null;
  if (!accessToken || !refreshToken) return null;

  const agoraSegundos = Math.floor(Date.now() / 1000);
  const expiraEm =
    typeof c.expires_at === "number"
      ? c.expires_at
      : typeof c.expires_in === "number"
        ? agoraSegundos + c.expires_in
        : agoraSegundos + 3600;

  return { accessToken, refreshToken, accessTokenExpiraEm: expiraEm };
}

/**
 * Renova com folga, e não no limite. Sessenta segundos de antecedência
 * cobrem o caso em que a página começa a renderizar com o token quase
 * vencido e a consulta ao Postgres cai do outro lado do prazo — o erro
 * seria um 401 no meio de uma tela já carregando, sem chance de recuperar.
 */
export const FOLGA_RENOVACAO_SEGUNDOS = 60;

export function precisaRenovar(expiraEm: number): boolean {
  return expiraEm - FOLGA_RENOVACAO_SEGUNDOS <= Math.floor(Date.now() / 1000);
}
