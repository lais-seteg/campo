// ═══════════════════════════════════════════════════════════════════════
//  CLIENTE SUPABASE DO SERVIDOR
//
//  Só existe cliente no servidor. O navegador não fala mais com o Supabase
//  — fala com este app, e é ele que consulta o banco. Foi essa mudança que
//  permitiu `connect-src 'self'` na CSP (ver next.config.js).
//
//  ── A RLS CONTINUA SENDO A SEGURANÇA, E NÃO ESTE CÓDIGO ──
//
//  O cliente é montado com a chave PUBLISHABLE mais o access token DO
//  USUÁRIO no cabeçalho Authorization. É isso que faz `auth.uid()`
//  responder a pessoa certa dentro do Postgres, e é por isso que toda a
//  política escrita em supabase/*.sql continua valendo exatamente como
//  antes: quem não tem perfil ativo não lê nada, só a Direção grava em
//  `projetos`, `item_reservas` é somente leitura, e assim por diante.
//
//  Nunca use aqui a chave secret / service_role: ela IGNORA toda a RLS.
//  Trocá-la aqui converteria um modelo de "o banco decide" para um modelo
//  de "confie em cada rota deste app" — e o banco é compartilhado com o
//  Controle de Estoque, que não fez essa escolha.
//
//  Um cliente novo por requisição, de propósito: o token é diferente a
//  cada pessoa, e um cliente global carregaria o token de quem pediu por
//  último. É o oposto do singleton de lib/prisma.ts do clockrview — lá o
//  cliente é anônimo e reaproveitável, aqui ele carrega identidade.
// ═══════════════════════════════════════════════════════════════════════

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/ambiente";

/** Cliente que age COMO o usuário logado. Toda leitura e escrita das
 *  telas passa por aqui. */
export function clienteDoUsuario(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    // Sessão não se persiste no servidor: cada requisição traz a sua.
    // Sem isso o supabase-js tentaria escrever em `localStorage`, que não
    // existe aqui, e tentaria renovar o token por conta própria — quem
    // renova é o middleware, num lugar só.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Cliente ANÔNIMO — usado exclusivamente pelo login, que por definição
 * ainda não tem token: `identificar_acesso(senha)` descobre de quem é a
 * senha e `signInWithPassword` troca isso por uma sessão.
 *
 * Não use para mais nada. Toda outra consulta tem um usuário por trás, e
 * consultar como anônimo é pedir para a RLS devolver vazio e o bug
 * aparecer como "sumiu tudo da tela".
 */
export function clienteAnonimo(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
