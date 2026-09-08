// ═══════════════════════════════════════════════════════════════════════
//  POST /api/solicitacoes/[id]/cancelar
//
//  Corpo: { motivo: string }
//
//  Cancelar não é recusar. Recusar é o líder dizendo que aquele campo não
//  é do escopo do projeto dele, antes de o pedido valer; cancelar é
//  desfazer um pedido que já valia. Os dois SOLTAM A RESERVA — material
//  preso num campo que não vai acontecer é material que falta em outro — e
//  os dois exigem motivo, porque quem pediu precisa saber por quê.
//
//  ── A ORDEM IMPORTA ──
//
//  A reserva sai PRIMEIRO, o status depois. Se o cancelamento falhar no
//  meio, o pior caso é material livre num pedido que continua ativo — e
//  não material preso num pedido que ninguém mais acompanha. Alguém
//  percebe o primeiro; o segundo só aparece quando falta equipamento em
//  outro campo, semanas depois.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { mensagemDeErro, statusDoErro, tabelaNaoExiste } from "@/lib/erros";
import { podeCancelar } from "@/lib/papeis";
import type { StatusSolicitacao } from "@/lib/tipos";

export const dynamic = "force-dynamic";

const MOTIVO_MAX = 500;

interface Contexto {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/solicitacoes/${params.id}/cancelar`);
  if (!autorizacao.ok) return autorizacao.resposta;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const { motivo } = (corpo as { motivo?: unknown }) ?? {};
  if (typeof motivo !== "string" || !motivo.trim()) {
    return NextResponse.json({ error: "Cancelar exige o motivo." }, { status: 400 });
  }
  if (motivo.trim().length > MOTIVO_MAX) {
    return NextResponse.json(
      { error: `O motivo deve ter no máximo ${MOTIVO_MAX} caracteres.` },
      { status: 400 }
    );
  }

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);

  const { data: atual, error: erroLeitura } = await sb
    .from("solicitacoes")
    .select("codigo,status")
    .eq("id", params.id)
    .maybeSingle();

  if (erroLeitura) {
    return NextResponse.json(
      { error: mensagemDeErro(erroLeitura, "abrir a solicitação") },
      { status: statusDoErro(erroLeitura) }
    );
  }
  if (!atual) return NextResponse.json({ error: "Solicitação não encontrada." }, { status: 404 });

  const status = atual.status as StatusSolicitacao;
  if (!podeCancelar(status)) {
    return NextResponse.json(
      { error: `A solicitação ${atual.codigo} já está ${status.toLowerCase()}.` },
      { status: 409 }
    );
  }

  try {
    const { data: liberadas, error: erroReserva } = await sb.rpc("liberar_reservas_solicitacao", {
      p_solicitacao: params.id,
    });
    // Sem a v2 aplicada não existe reserva para soltar — e o cancelamento
    // continua fazendo sentido sem ela.
    if (erroReserva && !tabelaNaoExiste(erroReserva)) throw erroReserva;

    const { error } = await sb
      .from("solicitacoes")
      .update({ status: "Cancelada", motivo_cancelamento: motivo.trim() })
      .eq("id", params.id);
    if (error) throw error;

    return NextResponse.json({ ok: true, liberadas: Number(liberadas) || 0 });
  } catch (erro) {
    console.error(`[POST /api/solicitacoes/${params.id}/cancelar]`, erro);
    return NextResponse.json(
      { error: mensagemDeErro(erro, "cancelar a solicitação") },
      { status: statusDoErro(erro) }
    );
  }
}
