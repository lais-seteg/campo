// ═══════════════════════════════════════════════════════════════════════
//  O COOKIE DE SESSÃO — assinatura e verificação (JWT HS256, via `jose`).
//
//  Por que `jose` e não `jsonwebtoken`: este módulo é importado pelo
//  middleware.ts, que roda em Edge Runtime, e jsonwebtoken depende de APIs
//  de Node (`crypto`, `process.nextTick`) que o Edge não tem.
//
//  ── O QUE O COOKIE CARREGA, E POR QUÊ ──
//
//  Duas coisas: a identidade já resolvida (id, nome, papel, usuário) e os
//  dois tokens do Supabase (access + refresh).
//
//  A identidade vai junto para o middleware conseguir decidir sobre rota
//  restrita sem consultar o banco — ele não pode. É uma primeira barreira,
//  não a palavra final: quem revalida `ativo` contra `perfis` é
//  lib/sessao.ts, com acesso ao banco (mesma divisão de trabalho do
//  clockrview).
//
//  Os tokens do Supabase vão junto porque é com o access token do USUÁRIO
//  que o servidor consulta o banco — é assim que `auth.uid()` responde a
//  pessoa certa e a RLS continua valendo. Guardá-los aqui, num cookie
//  httpOnly, é o que os tira do localStorage: na versão anterior o
//  supabase-js os mantinha em `localStorage`, ao alcance de qualquer XSS.
//
//  Consequência a assumir: o cookie fica com uns 800 bytes a 1,5 KB (dois
//  JWTs dentro de um terceiro). Bem abaixo do limite de 4 KB do navegador,
//  e o preço de não ter uma tabela de sessões do lado do servidor.
// ═══════════════════════════════════════════════════════════════════════

import { SignJWT, jwtVerify } from "jose";
import { SESSION_SECRET } from "@/lib/ambiente";
import type { Papel } from "@/lib/tipos";
import { PAPEIS } from "@/lib/tipos";

const SEGREDO = new TextEncoder().encode(SESSION_SECRET);

/** Nome próprio: uma aba do Controle de Estoque e uma aba daqui não brigam
 *  pela mesma sessão, mesmo sendo o mesmo projeto Supabase. */
export const COOKIE_SESSAO = "campo_seteg_sessao";

/** 7 dias, como o clockrview. O access token do Supabase dura ~1h dentro
 *  disso e é renovado pelo middleware (ver middleware.ts). */
export const DURACAO_SESSAO_SEGUNDOS = 60 * 60 * 24 * 7;

/**
 * Cabeçalho pelo qual o middleware repassa um access token recém-renovado
 * para o Server Component da MESMA requisição — o cookie novo só valeria
 * na próxima.
 *
 * É um canal INTERNO. O middleware apaga este cabeçalho de toda
 * requisição que entra e só o escreve ele mesmo (ver middleware.ts);
 * aceitá-lo de fora deixaria qualquer um escolher com qual token o
 * servidor consulta o banco.
 */
export const CABECALHO_TOKEN_RENOVADO = "x-campo-access-token";

export interface ConteudoSessao {
  /** `perfis.id`, que é também `auth.users.id` — o que `auth.uid()` devolve. */
  id: string;
  usuario: string;
  nome: string;
  papel: Papel;
  cargo: string | null;
  /** Access token do Supabase. É ele que faz a RLS reconhecer a pessoa. */
  accessToken: string;
  refreshToken: string;
  /** Epoch em SEGUNDOS de expiração do access token (não da sessão). */
  accessTokenExpiraEm: number;
}

export async function assinarSessao(conteudo: ConteudoSessao): Promise<string> {
  return new SignJWT({ ...conteudo })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DURACAO_SESSAO_SEGUNDOS}s`)
    .sign(SEGREDO);
}

/**
 * Verifica a assinatura e a forma do conteúdo. Devolve `null` para
 * qualquer problema — assinatura inválida, expirado, corrompido ou com
 * campo faltando.
 *
 * A checagem de forma (`temFormatoDeSessao`) não é paranoia gratuita: um
 * cookie assinado com o mesmo segredo, mas gerado por uma versão anterior
 * do código com outro formato de conteúdo, passaria pelo `jwtVerify` e
 * quebraria mais adiante, em algum `usuario.papel` indefinido. Rejeitar
 * aqui transforma isso num redirect para o login.
 */
export async function verificarSessao(token: string): Promise<ConteudoSessao | null> {
  try {
    const { payload } = await jwtVerify(token, SEGREDO);
    return temFormatoDeSessao(payload) ? payload : null;
  } catch {
    return null;
  }
}

function temFormatoDeSessao(payload: unknown): payload is ConteudoSessao {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.usuario === "string" &&
    typeof p.nome === "string" &&
    typeof p.papel === "string" &&
    (PAPEIS as readonly string[]).includes(p.papel) &&
    (p.cargo === null || typeof p.cargo === "string") &&
    typeof p.accessToken === "string" &&
    typeof p.refreshToken === "string" &&
    typeof p.accessTokenExpiraEm === "number"
  );
}

/** Opções do cookie, num lugar só — divergir entre a rota de login e a de
 *  logout é o jeito clássico de deixar um cookie órfão no navegador. */
export function opcoesDoCookie(emProducao: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: emProducao,
    path: "/",
    maxAge: DURACAO_SESSAO_SEGUNDOS,
  };
}
