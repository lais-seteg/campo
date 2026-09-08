// ═══════════════════════════════════════════════════════════════════════
//  PATCH  /api/solicitacoes/[id]  — edita a solicitação
//  DELETE /api/solicitacoes/[id]  — exclui (só a Gestão; ver RLS)
//
//  ── O QUE A EDIÇÃO REESCREVE, E O QUE ELA NÃO TOCA ──
//
//  Pedido de campo muda depois de aberto: a data anda, o hotel troca,
//  entra mais um equipamento. Mas:
//
//   · não se edita o que TERMINOU — pedido Finalizado ou Cancelado é
//     registro, e reescrever registro apaga a história em vez de
//     corrigi-la;
//   · equipamento JÁ ENTREGUE não sai pela edição — ele está fisicamente
//     com a equipe, e a linha é a obrigação de devolver;
//   · acrescentar equipamento é ação PRÓPRIA (POST em .../equipamentos),
//     e não uma linha nova no formulário: material novo disputa as datas
//     como qualquer outro, e a reserva tem de acontecer na mesma
//     transação.
//
//  O `status` continua fora do corpo aceito: `Aprovada`/`Recusada` são o
//  ato do líder e `Em campo`/`Finalizada` são consequência da conferência.
//  Deixar um PATCH declarar "em campo" faria o estoque e a solicitação
//  contarem histórias diferentes.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { carregarDados } from "@/lib/dados";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";
import { podeEditar } from "@/lib/papeis";
import { validarSolicitacao } from "@/app/api/solicitacoes/validacao";
import {
  cabecalhoDe,
  contarEquipamentosEntregues,
  gravarFilhas,
  limparFilhas,
  reservarMaterial,
} from "@/app/api/solicitacoes/persistencia";
import type { StatusSolicitacao } from "@/lib/tipos";

export const dynamic = "force-dynamic";

interface Contexto {
  params: { id: string };
}

export async function PATCH(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/solicitacoes/${params.id}`);
  if (!autorizacao.ok) return autorizacao.resposta;
  const { usuario } = autorizacao;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const sb = clienteDoUsuario(usuario.accessToken);

  const { data: atual, error: erroLeitura } = await sb
    .from("solicitacoes")
    .select("id,codigo,status")
    .eq("id", params.id)
    .maybeSingle();

  if (erroLeitura) {
    return NextResponse.json(
      { error: mensagemDeErro(erroLeitura, "abrir a solicitação") },
      { status: statusDoErro(erroLeitura) }
    );
  }
  if (!atual) {
    return NextResponse.json({ error: "Solicitação não encontrada." }, { status: 404 });
  }

  const status = atual.status as StatusSolicitacao;
  if (!podeEditar(status)) {
    return NextResponse.json(
      {
        error: `A solicitação ${atual.codigo} está ${status} — pedido encerrado é registro e não se reescreve.`,
      },
      { status: 409 }
    );
  }

  const dados = await carregarDados(usuario.accessToken);
  // `false` = não é pedido novo. A exigência de o projeto estar ATIVO vale
  // só na criação: campo em andamento não pode ficar impossível de
  // corrigir porque a Direção pôs o projeto em Stand By no meio do
  // caminho.
  const validacao = validarSolicitacao(corpo, dados.projetos, false);
  if (!validacao.ok) {
    return NextResponse.json({ error: validacao.erro }, { status: 400 });
  }

  try {
    // Quantos já saíram — contado ANTES de reescrever, para a resposta
    // poder dizer quantos itens ficaram de fora da edição.
    const entregues = await contarEquipamentosEntregues(sb, params.id);

    const { error } = await sb
      .from("solicitacoes")
      .update(cabecalhoDe(validacao.dados))
      .eq("id", params.id);
    if (error) throw error;

    await limparFilhas(sb, params.id);
    const v2Completa = await gravarFilhas(sb, params.id, validacao.dados);

    // A reserva é refeita mesmo quando a lista de equipamentos ficou
    // vazia: mudar o PERÍODO do campo obriga a refazer o compromisso, e a
    // função é idempotente — ela apaga a reserva ainda não baixada e a
    // reescreve, sem tocar no que já foi para campo.
    const reservados = await reservarMaterial(sb, params.id);

    return NextResponse.json({ ok: true, reservados, entreguesForaDaEdicao: entregues, v2Completa });
  } catch (erro) {
    // Ao contrário do POST, aqui NÃO se desfaz nada: a solicitação já
    // existia antes desta chamada. Uma reserva recusada deixa o cabeçalho
    // salvo e o material como estava — que é o comportamento certo,
    // porque o pedido continua sendo um pedido real.
    console.error(`[PATCH /api/solicitacoes/${params.id}]`, erro);
    return NextResponse.json(
      { error: mensagemDeErro(erro, "salvar as alterações") },
      { status: statusDoErro(erro) }
    );
  }
}

/**
 * Excluir de vez. Quem pode é só a Gestão, e quem decide isso é a RLS
 * ("solicitações: só Gestão exclui") — não este código. A checagem de
 * papel aqui seria uma segunda cópia da mesma regra, livre para divergir;
 * o que a rota faz é traduzir o 42501 do Postgres numa frase legível.
 *
 * O `on delete cascade` das tabelas filhas leva junto equipamentos,
 * hospedagens, despesas, diárias, equipe, EPIs, reservas e histórico.
 */
export async function DELETE(_request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/solicitacoes/${params.id}`);
  if (!autorizacao.ok) return autorizacao.resposta;

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);
  const { error } = await sb.from("solicitacoes").delete().eq("id", params.id);

  if (error) {
    return NextResponse.json(
      { error: mensagemDeErro(error, "excluir a solicitação") },
      { status: statusDoErro(error) }
    );
  }
  return NextResponse.json({ ok: true });
}
