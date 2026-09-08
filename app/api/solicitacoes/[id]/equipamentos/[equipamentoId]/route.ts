// ═══════════════════════════════════════════════════════════════════════
//  DELETE /api/solicitacoes/[id]/equipamentos/[equipamentoId]
//
//  Tira do pedido o que AINDA NÃO SAIU. `remover_equipamento_solicitacao()`
//  solta a reserva junto, na mesma transação — tirar a linha sem soltar a
//  reserva deixaria material comprometido com um pedido que já não o pede.
//
//  Equipamento já entregue não sai por aqui: ele está fisicamente com a
//  equipe, e a linha é a obrigação de devolver. Quem barra isso é a função
//  no banco.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";

export const dynamic = "force-dynamic";

interface Contexto {
  params: { id: string; equipamentoId: string };
}

export async function DELETE(_request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(
    `/api/solicitacoes/${params.id}/equipamentos/${params.equipamentoId}`
  );
  if (!autorizacao.ok) return autorizacao.resposta;

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);

  // O `[id]` da solicitação está na URL por coerência de rota, mas quem
  // confere o vínculo entre linha e pedido é a função — ela lê a linha
  // pelo id e trabalha a partir da solicitação DELA, não da que a URL
  // afirma. Não há como remover a linha de um pedido passando o id de
  // outro.
  const { error } = await sb.rpc("remover_equipamento_solicitacao", {
    p_equipamento: params.equipamentoId,
  });

  if (error) {
    return NextResponse.json(
      { error: mensagemDeErro(error, "remover o equipamento") },
      { status: statusDoErro(error) }
    );
  }

  return NextResponse.json({ ok: true });
}
