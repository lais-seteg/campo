// GET /api/clockify/projetos
//
// Repassa a lista de projetos do workspace, sem a chave nunca sair do
// servidor. Exige sessão: quem não está logado não usa este app como
// espelho gratuito da API do Clockify.
//
// Responde 200 mesmo quando a integração falha, com `{ projetos: [], erro }`
// — a lista de projetos é uma SUGESTÃO, e um erro de integração não pode
// virar uma tela quebrada. O campo continua aceitando o código digitado, e
// a tela mostra o motivo embaixo dele.

import { NextResponse } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { listarProjetosDoClockify } from "@/lib/clockify";

export const dynamic = "force-dynamic";

export async function GET() {
  const autorizacao = await autorizarApi("/api/clockify/projetos");
  if (!autorizacao.ok) return autorizacao.resposta;

  const lista = await listarProjetosDoClockify();

  // Cache curto no navegador: quem abre e fecha o cadastro três vezes
  // seguidas não precisa de três idas ao Clockify. Cinco minutos é bem
  // menos do que o intervalo em que projeto novo aparece por lá.
  return NextResponse.json(lista, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
