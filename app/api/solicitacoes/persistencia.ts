// ═══════════════════════════════════════════════════════════════════════
//  GRAVAÇÃO DA SOLICITAÇÃO — o que POST e PATCH têm em comum.
//
//  Três coisas moram aqui: separar o cabeçalho das listas filhas,
//  reescrever as filhas na edição e disparar a reserva de material.
//
//  ── O QUE ESTE MÓDULO NÃO FAZ, DE PROPÓSITO ──
//
//  Não decide status, não carimba autoria, não calcula total, desvio nem
//  status de curso, e não escreve em `item_reservas`. Tudo isso é do
//  banco, por trigger ou por função — e continua sendo mesmo agora que
//  existe um servidor no meio. Mandar qualquer um desses campos daqui
//  seria trabalho jogado fora no melhor caso, e duas versões da verdade
//  no pior.
// ═══════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from "@supabase/supabase-js";
import { colunaNaoExiste, tabelaNaoExiste } from "@/lib/erros";
import type { CorpoDeSolicitacao } from "@/app/api/solicitacoes/validacao";

/** As colunas de `solicitacoes` — o corpo validado menos as listas filhas. */
export function cabecalhoDe(dados: CorpoDeSolicitacao) {
  const { equipe, epis, equipamentos, hospedagens, despesas, diarias, ...cabecalho } = dados;
  // As seis listas são gravadas em outras tabelas; desestruturar aqui é o
  // que garante que nenhuma delas vaze para o update de `solicitacoes` e
  // provoque um "column does not exist".
  void equipe;
  void epis;
  void equipamentos;
  void hospedagens;
  void despesas;
  void diarias;
  return cabecalho;
}

/**
 * Apaga as linhas-filhas que a edição reescreve.
 *
 * ── TRÊS COISAS NÃO SÃO APAGADAS, E É O MESMO MOTIVO ──
 *
 * A edição reescreve o que veio DO FORMULÁRIO. O que não veio do formulário
 * não é dela para reescrever:
 *
 *   · Equipamento JÁ ENTREGUE fica: ele está fisicamente com a equipe, e a
 *     linha é a obrigação de devolver. Apagá-la faria a devolução não ter o
 *     que conferir e o estoque nunca receber o item de volta.
 *
 *   · Hospedagem, diária e despesa ACRESCENTADAS em campo ficam
 *     (supabase/17). Elas entraram por outro ato, com motivo e histórico
 *     próprios, depois de o formulário ter sido enviado. Sem esta exceção, a
 *     diária lançada hoje porque o campo estendeu desaparecia na próxima
 *     correção de qualquer outro campo do pedido — e num pedido do tipo
 *     Administrativo, que não envia diárias, ela era apagada e nunca
 *     reescrita.
 *
 * Quem monta o formulário filtra as mesmas linhas para fora
 * (`carregarNoFormulario`), senão elas seriam reenviadas e duplicariam.
 */
export async function limparFilhas(sb: SupabaseClient, id: string): Promise<void> {
  const tabelas = ["solicitacao_equipe", "solicitacao_sst_epis"];

  for (const tabela of tabelas) {
    const { error } = await sb.from(tabela).delete().eq("solicitacao_id", id);
    // Tabela da v2 que ainda não existe não é erro fatal: o sistema
    // funciona sem ela, avisando o que está desligado.
    if (error && !tabelaNaoExiste(error)) throw error;
  }

  for (const tabela of ["solicitacao_hospedagens", "solicitacao_despesas", "solicitacao_diarias"]) {
    const { error } = await sb
      .from(tabela)
      .delete()
      .eq("solicitacao_id", id)
      // `.is(...)` e não `.eq(..., null)`: em SQL, `= null` nunca é
      // verdadeiro e a limpeza não apagaria linha nenhuma.
      .is("acrescentado_em", null);
    // Coluna ainda não criada (deploy anterior a supabase/17) volta ao
    // comportamento antigo: apaga tudo, que é o que fazia antes.
    if (error && colunaNaoExiste(error)) {
      const { error: erroSemFiltro } = await sb.from(tabela).delete().eq("solicitacao_id", id);
      if (erroSemFiltro && !tabelaNaoExiste(erroSemFiltro)) throw erroSemFiltro;
      continue;
    }
    if (error && !tabelaNaoExiste(error)) throw error;
  }

  const { error } = await sb
    .from("solicitacao_equipamentos")
    .delete()
    .eq("solicitacao_id", id)
    .eq("entregue", false);
  if (error) throw error;
}

/** Quantos equipamentos a edição NÃO pôde reescrever por já terem saído.
 *  A tela avisa: a pessoa precisa saber por que a linha continua ali. */
export async function contarEquipamentosEntregues(sb: SupabaseClient, id: string): Promise<number> {
  const { count, error } = await sb
    .from("solicitacao_equipamentos")
    .select("id", { count: "exact", head: true })
    .eq("solicitacao_id", id)
    .eq("entregue", true);
  if (error) return 0;
  return count ?? 0;
}

/**
 * Grava as listas filhas. Cada bloco é um insert em lote — e tabela da v2
 * ausente vira aviso, não queda.
 *
 * Devolve `false` quando alguma tabela da v2 não existe, para a resposta
 * poder dizer que aquilo ficou de fora em vez de a pessoa descobrir
 * depois que a equipe não foi salva.
 */
export async function gravarFilhas(
  sb: SupabaseClient,
  id: string,
  dados: CorpoDeSolicitacao
): Promise<boolean> {
  let v2Completa = true;

  const inserir = async (tabela: string, linhas: readonly object[]): Promise<void> => {
    if (!linhas.length) return;
    const { error } = await sb.from(tabela).insert(linhas);
    if (error) {
      if (tabelaNaoExiste(error)) {
        v2Completa = false;
        return;
      }
      throw error;
    }
  };

  await inserir(
    "solicitacao_equipe",
    dados.equipe.map((e) => ({ solicitacao_id: id, ...e }))
  );

  if (dados.sst_aplicavel) {
    await inserir(
      "solicitacao_sst_epis",
      dados.epis.map((e) => ({ solicitacao_id: id, ...e }))
    );
  }

  if (dados.tipo === "Administrativo") {
    await inserir(
      "solicitacao_equipamentos",
      dados.equipamentos.map((e) => ({ solicitacao_id: id, ...e }))
    );
    await inserir(
      "solicitacao_hospedagens",
      dados.hospedagem_necessaria ? dados.hospedagens.map((h) => ({ solicitacao_id: id, ...h })) : []
    );
  } else {
    await inserir(
      "solicitacao_despesas",
      dados.despesas.map((d) => ({ solicitacao_id: id, ...d }))
    );
    await inserir(
      "solicitacao_diarias",
      // `valor_total` NÃO é enviado: é coluna gerada (dias × valor
      // unitário). O "VALOR A TRANSFERIR" da planilha nunca diverge do
      // que foi digitado, nem por SQL direto.
      dados.diarias.map((d) => ({ solicitacao_id: id, ...d }))
    );
  }

  return v2Completa;
}

/**
 * A RESERVA — é aqui que campo encosta no estoque.
 *
 * O material pedido fica indisponível NAS DATAS deste campo. Não é baixa,
 * é compromisso: o saldo só muda quando o item fisicamente sai, na
 * entrega. Quem confere saldo e datas é a função no banco, e não este
 * servidor — ela trava as linhas do catálogo antes de conferir, e é
 * idempotente, então retry de rede não reserva duas vezes.
 *
 * Deixar esta conta do lado de cá reabriria exatamente o buraco que a
 * função existe para fechar: duas pessoas salvando ao mesmo tempo furando
 * o estoque, cada uma tendo lido um saldo que já não valia.
 */
export async function reservarMaterial(sb: SupabaseClient, id: string): Promise<number> {
  const { data, error } = await sb.rpc("reservar_equipamentos_solicitacao", { p_solicitacao: id });
  if (error) throw error;
  return Number(data) || 0;
}

/**
 * Pedido novo cuja reserva não passou não pode ficar pela metade: ele
 * apareceria na lista como se estivesse combinado, sem material nenhum
 * garantido.
 *
 * Excluir é o certo, mas só a Gestão exclui — é a política do banco, e é
 * ela que impede alguém de apagar pedido alheio. Quando quem está salvando
 * não é da Gestão, o caminho é cancelar com o motivo: o pedido sai do
 * fluxo ativo e fica dizendo por quê, em vez de virar rascunho órfão.
 */
export async function desfazerSolicitacaoNova(
  sb: SupabaseClient,
  id: string,
  motivoDaFalha: string
): Promise<void> {
  const exclusao = await sb.from("solicitacoes").delete().eq("id", id);
  if (!exclusao.error) return;

  const motivo =
    `Cancelada automaticamente: o material pedido não estava disponível nas datas do campo. ${motivoDaFalha}`.slice(
      0,
      500
    );
  const cancelamento = await sb
    .from("solicitacoes")
    .update({ status: "Cancelada", motivo_cancelamento: motivo })
    .eq("id", id);

  if (cancelamento.error) {
    // Nem excluir nem cancelar funcionou. Não há terceiro caminho daqui —
    // registra alto para alguém conseguir achar o pedido órfão depois.
    console.error(`[solicitacoes] não foi possível desfazer a solicitação ${id}`, cancelamento.error);
  }
}
