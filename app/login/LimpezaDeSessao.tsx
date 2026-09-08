"use client";

// ═══════════════════════════════════════════════════════════════════════
//  LIMPA O COOKIE QUE O BANCO REJEITOU
//
//  Chegar em /login?sessao=invalida significa que existia um cookie
//  perfeitamente assinado, mas o BANCO recusou a sessão — acesso
//  desativado, perfil apagado, alguém recriado no Supabase.
//
//  O cookie precisa sumir, senão a próxima navegação passa de novo pelo
//  middleware (que só confere assinatura, e a acha válida) e volta para
//  cá. Quem apaga não pode ser a página: Server Component não escreve
//  cookie — quando ele renderiza, os cabeçalhos da resposta já foram
//  decididos. Então é um POST, uma vez, na montagem.
//
//  O componente não desenha nada. Não há o que mostrar: o formulário ao
//  lado já diz que a sessão expirou.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";

export function LimpezaDeSessao() {
  // Em desenvolvimento o React roda os efeitos duas vezes (StrictMode).
  // Sair duas vezes não faria mal, mas gera um segundo POST inútil a cada
  // carregamento — a trava evita o ruído no log.
  const jaLimpou = useRef(false);

  useEffect(() => {
    if (jaLimpou.current) return;
    jaLimpou.current = true;
    // Sem `await` e sem tratar erro de propósito: se a limpeza falhar, o
    // pior caso é o cookie morto continuar indo junto — e ele já não abre
    // nada, porque quem decide é o `perfis.ativo` lido a cada requisição.
    void fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  }, []);

  return null;
}
