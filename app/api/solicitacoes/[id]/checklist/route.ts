// ═══════════════════════════════════════════════════════════════════════
//  PATCH /api/solicitacoes/[id]/checklist
//
//  Corpo: { observacoes: string }
//
//  A área editável da folha — o que o formulário não previu e a pessoa
//  precisa escrever à mão antes de imprimir: "o tripé foi sem a bolsa",
//  "cliente exige crachá na portaria".
//
//  ── TEXTO, E NÃO HTML ──
//
//  A Ordem de Compra do SGC guarda HTML editado, porque ela é um documento
//  congelado: emitida uma vez e a partir dali é papel. O checklist é o
//  contrário — vive, é validado duas vezes, e os quadradinhos dele movem o
//  estoque. Guardar HTML aqui exigiria o sanitizador que a OC precisou ter
//  (`innerHTML` não executa `<script>`, mas executa `<img onerror>`), e o
//  que se escreve nesta área é frase, não tabela. Texto puro resolve e não
//  abre essa porta.
//
//  Quem pode escrever: qualquer usuário ativo, como no resto do pedido — a
//  RLS de `solicitacoes` é `eh_usuario_ativo()` para update. Pedido
//  encerrado não aceita: é registro, e a mesma regra do `podeEditar()` que
//  vale para o formulário vale para a folha dele.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { carregarSolicitacao } from "@/lib/dados";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";
import { podeEditar } from "@/lib/papeis";

export const dynamic = "force-dynamic";

/** Generoso para observação de campo e longe de virar depósito de texto. */
const OBSERVACOES_MAX = 4000;

interface Contexto {
  params: { id: string };
}

export async function PATCH(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/solicitacoes/${params.id}/checklist`);
  if (!autorizacao.ok) return autorizacao.resposta;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const bruto = (corpo as { observacoes?: unknown })?.observacoes;
  if (bruto !== null && bruto !== undefined && typeof bruto !== "string") {
    return NextResponse.json({ error: "Observações inválidas." }, { status: 400 });
  }

  const texto = typeof bruto === "string" ? bruto.trim() : "";
  if (texto.length > OBSERVACOES_MAX) {
    return NextResponse.json(
      { error: `As observações passam de ${OBSERVACOES_MAX} caracteres.` },
      { status: 400 }
    );
  }

  const solicitacao = await carregarSolicitacao(autorizacao.usuario.accessToken, params.id);
  if (!solicitacao) {
    return NextResponse.json({ error: "Solicitação não encontrada." }, { status: 404 });
  }
  if (!podeEditar(solicitacao.status)) {
    return NextResponse.json(
      {
        error: `A solicitação está ${solicitacao.status} — a folha dela é registro e não se reescreve.`,
      },
      { status: 409 }
    );
  }

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);

  try {
    const { error } = await sb
      .from("solicitacoes")
      .update({ checklist_observacoes: texto || null })
      .eq("id", params.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (erro) {
    console.error(`[PATCH /api/solicitacoes/${params.id}/checklist]`, erro);
    return NextResponse.json(
      { error: mensagemDeErro(erro, "salvar as observações do checklist") },
      { status: statusDoErro(erro) }
    );
  }
}
