// ═══════════════════════════════════════════════════════════════════════
//  POST /api/solicitacoes/[id]/equipamentos/[equipamentoId]/folga
//
//  O administrativo libera (ou retira a liberação de) a FOLGA ENTRE CAMPOS
//  de um equipamento: a véspera e o dia seguinte que a reserva segura por
//  padrão, para separar, transportar e conferir na volta.
//
//  ── O QUE ESTA ROTA NÃO PODE FAZER ──
//
//  Liberar conflito REAL de datas. Se outro campo está com o item no mesmo
//  período, `liberar_folga_equipamento()` marca a dispensa, tenta reservar,
//  não consegue e lança — a transação inteira volta atrás. O mesmo medidor
//  não fica prometido a duas equipes porque alguém clicou num botão.
//
//  A checagem de papel é feita DUAS vezes, e não é redundância: aqui, para
//  devolver 403 com uma frase em vez de um erro de banco; e dentro da
//  função, que é a autoritativa — ela confere `eh_administrativo()` contra
//  `auth.uid()` na mesma transação em que grava.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";
import { podeLiberarFolga } from "@/lib/papeis";

export const dynamic = "force-dynamic";

interface Contexto {
  params: { id: string; equipamentoId: string };
}

const MOTIVO_MAX = 300;

export async function POST(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(
    `/api/solicitacoes/${params.id}/equipamentos/${params.equipamentoId}/folga`
  );
  if (!autorizacao.ok) return autorizacao.resposta;

  if (!podeLiberarFolga(autorizacao.usuario.papel)) {
    return NextResponse.json(
      { error: "Só o administrativo (ou a Direção) libera a folga entre campos." },
      { status: 403 }
    );
  }

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    corpo = {};
  }

  const { liberar, motivo } = (corpo as { liberar?: unknown; motivo?: unknown }) ?? {};

  // Omitido é `true`: a ação normal desta rota é liberar. Retirar a
  // liberação exige dizer `false` de propósito.
  const vaiLiberar = liberar === undefined ? true : liberar === true;

  if (motivo !== undefined && typeof motivo !== "string") {
    return NextResponse.json({ error: "Motivo inválido." }, { status: 400 });
  }
  if (typeof motivo === "string" && motivo.length > MOTIVO_MAX) {
    return NextResponse.json(
      { error: `O motivo passa de ${MOTIVO_MAX} caracteres.` },
      { status: 400 }
    );
  }

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);

  // Como no DELETE ao lado: o `[id]` da solicitação está na URL por
  // coerência de rota, mas a função trabalha a partir da solicitação DA
  // LINHA, e não da que a URL afirma.
  const { data, error } = await sb.rpc("liberar_folga_equipamento", {
    p_equipamento: params.equipamentoId,
    p_liberar: vaiLiberar,
    p_motivo: typeof motivo === "string" ? motivo : null,
  });

  if (error) {
    return NextResponse.json(
      { error: mensagemDeErro(error, vaiLiberar ? "liberar a folga" : "retirar a liberação") },
      { status: statusDoErro(error) }
    );
  }

  // `reservado` é o que a tela precisa saber: liberada a folga, o material
  // chegou a ser reservado?
  return NextResponse.json({ ok: true, reservado: data === true });
}
