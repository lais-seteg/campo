// ═══════════════════════════════════════════════════════════════════════
//  PATCH /api/solicitacoes/[id]/checklist
//
//  Corpo: { observacoes?: string, rascunho?: objeto | null }
//
//  Duas coisas da folha que não movem estoque, e por isso podem ser
//  gravadas a qualquer momento. Cada chave é opcional e só o que vem é
//  gravado — a tela salva a observação quando a pessoa aperta Salvar, e o
//  rascunho sozinho, alguns instantes depois de cada clique.
//
//  ── AS OBSERVAÇÕES ──
//
//  A área editável da folha — o que o formulário não previu e a pessoa
//  precisa escrever à mão antes de imprimir: "o tripé foi sem a bolsa",
//  "cliente exige crachá na portaria".
//
//  ── O RASCUNHO ──
//
//  As marcas do checklist ainda não registradas (supabase/17). Elas eram
//  só estado de tela: quem conferia doze itens, assinava e fechava o popup
//  antes de registrar, marcava os doze de novo.
//
//  Gravar as marcas DE VERDADE aqui seria o erro: `entregue` e `devolvido`
//  são o que dá baixa e entrada no estoque, e quem as escreve é
//  `registrar_entrega_solicitacao` / `..._devolucao_...`, numa transação
//  só. Isto grava o RASCUNHO — a tela guardada, que não move nada e que o
//  registro zera.
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
import {
  carregarFilhasDaSolicitacao,
  carregarSituacaoDasAssinaturas,
  carregarSolicitacao,
} from "@/lib/dados";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";
import { podeEditar } from "@/lib/papeis";

export const dynamic = "force-dynamic";

/**
 * GET — o que o POPUP do checklist precisa e a lista não trouxe: as
 * assinaturas (com a imagem) e a situação delas.
 *
 * ── POR QUE NÃO VEM NO CARREGAMENTO GLOBAL ──
 *
 * As assinaturas são PNG de até 400 KB cada, quatro por pedido. Trazê-las
 * em `carregarDados()` — que toda tela chama, porque o menu precisa dos
 * contadores — fazia abrir o CALENDÁRIO transferir toda assinatura da
 * empresa. Aqui elas custam uma ida, na hora em que alguém abre a folha.
 */
export async function GET(_request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/solicitacoes/${params.id}/checklist`);
  if (!autorizacao.ok) return autorizacao.resposta;

  const [{ assinaturas }, situacao] = await Promise.all([
    carregarFilhasDaSolicitacao(autorizacao.usuario.accessToken, params.id),
    carregarSituacaoDasAssinaturas(autorizacao.usuario.accessToken, params.id),
  ]);

  return NextResponse.json({ assinaturas, situacao });
}

/** Generoso para observação de campo e longe de virar depósito de texto. */
const OBSERVACOES_MAX = 4000;

/** Cem itens de checklist com avaria descrita cabem folgados nisto. */
const RASCUNHO_MAX = 200_000;

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

  const c = (corpo as { observacoes?: unknown; rascunho?: unknown }) ?? {};
  const mudancas: Record<string, unknown> = {};

  if ("observacoes" in c) {
    if (c.observacoes !== null && typeof c.observacoes !== "string") {
      return NextResponse.json({ error: "Observações inválidas." }, { status: 400 });
    }
    const texto = typeof c.observacoes === "string" ? c.observacoes.trim() : "";
    if (texto.length > OBSERVACOES_MAX) {
      return NextResponse.json(
        { error: `As observações passam de ${OBSERVACOES_MAX} caracteres.` },
        { status: 400 }
      );
    }
    mudancas.checklist_observacoes = texto || null;
  }

  if ("rascunho" in c) {
    // `null` é o gesto de LIMPAR — é o que a tela manda depois de
    // registrar a conferência, quando as marcas viraram fato e o rascunho
    // deixou de ter sentido.
    if (c.rascunho === null) {
      mudancas.checklist_rascunho = null;
    } else if (typeof c.rascunho !== "object" || Array.isArray(c.rascunho)) {
      return NextResponse.json({ error: "Rascunho inválido." }, { status: 400 });
    } else {
      // O CONTEÚDO não é validado campo por campo de propósito: é a tela
      // guardada, o formato é o do formulário e muda com ele. Quem valida
      // é o cliente na hora de aplicar — rascunho de formato velho é
      // descartado lá. O que se valida aqui é o TAMANHO, para a coluna não
      // virar depósito.
      const tamanho = JSON.stringify(c.rascunho).length;
      if (tamanho > RASCUNHO_MAX) {
        return NextResponse.json({ error: "Rascunho do checklist grande demais." }, { status: 400 });
      }
      mudancas.checklist_rascunho = c.rascunho;
    }
  }

  if (Object.keys(mudancas).length === 0) {
    return NextResponse.json({ error: "Nada para salvar." }, { status: 400 });
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
    const { error } = await sb.from("solicitacoes").update(mudancas).eq("id", params.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (erro) {
    console.error(`[PATCH /api/solicitacoes/${params.id}/checklist]`, erro);
    return NextResponse.json(
      { error: mensagemDeErro(erro, "salvar a folha do checklist") },
      { status: statusDoErro(erro) }
    );
  }
}
