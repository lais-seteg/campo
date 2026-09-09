// ═══════════════════════════════════════════════════════════════════════
//  GET /api/solicitacoes/[id]/detalhe
//
//  O que o POPUP de informações precisa e a lista não trouxe: as
//  assinaturas (com a imagem) e o histórico de alterações.
//
//  ── POR QUE NÃO VÊM NO CARREGAMENTO GLOBAL ──
//
//  As assinaturas são PNG de até 400 KB, quatro por pedido, e o histórico
//  cresce para sempre. Enquanto estavam em `carregarDados()` — que toda
//  tela chama, porque o menu precisa dos contadores — abrir o CALENDÁRIO
//  carregava toda assinatura e todo histórico da empresa. Aqui custam uma
//  ida, na tela que realmente os mostra, e só quando alguém abre o popup.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { carregarFilhasDaSolicitacao } from "@/lib/dados";

export const dynamic = "force-dynamic";

interface Contexto {
  params: { id: string };
}

export async function GET(_request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/solicitacoes/${params.id}/detalhe`);
  if (!autorizacao.ok) return autorizacao.resposta;

  const { assinaturas, alteracoes } = await carregarFilhasDaSolicitacao(
    autorizacao.usuario.accessToken,
    params.id
  );

  return NextResponse.json({ assinaturas, alteracoes });
}
