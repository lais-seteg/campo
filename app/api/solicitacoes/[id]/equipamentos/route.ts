// ═══════════════════════════════════════════════════════════════════════
//  POST /api/solicitacoes/[id]/equipamentos — acrescenta material.
//
//  Corpo: { item_id: string, quantidade: number }
//
//  Acrescentar equipamento a um pedido aberto NÃO é editar uma linha do
//  formulário, e por isso é uma rota própria: material novo disputa as
//  datas como qualquer outro. `acrescentar_equipamento_solicitacao()`
//  reserva na MESMA transação — se não couber, ela diz o que falta e nada
//  é gravado.
//
//  Fazer isso pela edição significaria apagar as linhas, reescrever e
//  reservar de novo, em três passos: entre o segundo e o terceiro,
//  material que já estava garantido ficaria solto para outro campo pegar.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";

export const dynamic = "force-dynamic";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Contexto {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/solicitacoes/${params.id}/equipamentos`);
  if (!autorizacao.ok) return autorizacao.resposta;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const { item_id: itemId, quantidade } = (corpo as { item_id?: unknown; quantidade?: unknown }) ?? {};

  if (typeof itemId !== "string" || !RE_UUID.test(itemId)) {
    return NextResponse.json({ error: "Escolha o equipamento." }, { status: 400 });
  }
  const qtd = Number(quantidade);
  if (!Number.isInteger(qtd) || qtd < 1 || qtd > 100_000) {
    return NextResponse.json({ error: "A quantidade precisa ser maior que zero." }, { status: 400 });
  }

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);

  // A função no banco é quem confere estado da solicitação (não acrescenta
  // em campo finalizado, cancelado ou recusado) e disponibilidade nas
  // datas. Repetir isso aqui seria uma segunda cópia da mesma regra.
  const { data, error } = await sb.rpc("acrescentar_equipamento_solicitacao", {
    p_solicitacao: params.id,
    p_item: itemId,
    p_quantidade: qtd,
    p_descricao: null,
  });

  if (error) {
    return NextResponse.json(
      { error: mensagemDeErro(error, "acrescentar o equipamento") },
      { status: statusDoErro(error) }
    );
  }

  return NextResponse.json({ ok: true, equipamentoId: data ?? null }, { status: 201 });
}
