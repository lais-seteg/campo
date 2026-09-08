// ═══════════════════════════════════════════════════════════════════════
//  POST /api/solicitacoes/[id]/aprovar — o ato do líder.
//
//  Corpo: { aprovar: boolean, motivo?: string }
//
//  Esta rota é fina de propósito: tudo que decide acontece dentro de
//  `aprovar_solicitacao_lider()`, no banco, numa transação só. É ela que:
//
//   · confere que quem chama é o líder DAQUELE projeto (ou a Direção) —
//     comparando `auth.uid()` com `projetos.lider_id`, não com o que o
//     cliente afirmou;
//   · confere que a solicitação ainda espera decisão;
//   · exige o motivo na recusa;
//   · SOLTA A RESERVA quando recusa — material preso num campo que não vai
//     acontecer é material que falta em outro.
//
//  Replicar essas checagens aqui criaria uma segunda cópia da regra, livre
//  para divergir da que realmente vale. O que o servidor acrescenta é
//  recusar cedo um corpo malformado e traduzir o erro numa frase.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";

export const dynamic = "force-dynamic";

const MOTIVO_MAX = 500;

interface Contexto {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/solicitacoes/${params.id}/aprovar`);
  if (!autorizacao.ok) return autorizacao.resposta;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const { aprovar, motivo } = (corpo as { aprovar?: unknown; motivo?: unknown }) ?? {};

  if (typeof aprovar !== "boolean") {
    return NextResponse.json({ error: "Diga se é para aprovar ou recusar." }, { status: 400 });
  }

  let motivoLimpo: string | null = null;
  if (!aprovar) {
    // Recusar sem dizer por quê deixa o solicitante sem resposta. O banco
    // também exige — aqui a frase é melhor.
    if (typeof motivo !== "string" || !motivo.trim()) {
      return NextResponse.json({ error: "Recusar exige o motivo." }, { status: 400 });
    }
    if (motivo.trim().length > MOTIVO_MAX) {
      return NextResponse.json(
        { error: `O motivo deve ter no máximo ${MOTIVO_MAX} caracteres.` },
        { status: 400 }
      );
    }
    motivoLimpo = motivo.trim();
  }

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);

  const { data, error } = await sb.rpc("aprovar_solicitacao_lider", {
    p_solicitacao: params.id,
    p_aprovar: aprovar,
    p_motivo: motivoLimpo,
  });

  if (error) {
    return NextResponse.json(
      { error: mensagemDeErro(error, aprovar ? "aprovar a solicitação" : "recusar a solicitação") },
      { status: statusDoErro(error) }
    );
  }

  // A função devolve { codigo, status, liberadas } — a tela usa os três
  // para dizer o que aconteceu, inclusive quantas reservas foram soltas.
  return NextResponse.json(data ?? { ok: true });
}
