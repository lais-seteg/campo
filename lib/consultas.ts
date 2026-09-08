// ═══════════════════════════════════════════════════════════════════════
//  AS PERGUNTAS QUE AS TELAS FAZEM SOBRE OS DADOS
//
//  Funções puras: recebem as listas, devolvem a resposta. Nenhuma toca no
//  banco, no DOM ou em estado global — a versão anterior tinha essas
//  mesmas contas espalhadas dentro de cada `render*()`, lendo o `DB`
//  global, e o mesmo cálculo aparecia escrito de dois jeitos em telas
//  diferentes.
//
//  Estar aqui é o que permite a mesma conta valer no servidor (o menu, a
//  exportação) e no cliente (os filtros ao vivo), sem duplicar.
// ═══════════════════════════════════════════════════════════════════════

import type { Papel, Projeto, Solicitacao, SolicitacaoDeLista, StatusSolicitacao } from "@/lib/tipos";
import { podeAprovar } from "@/lib/papeis";
import { dataISOparaBR, formatarMoeda } from "@/lib/formato";
import type { AvariaResolvida, Colaborador, LiderDisponivel } from "@/lib/tipos";
import type { ContadoresDoMenu } from "@/lib/navegacao";

/**
 * QUEM PODE SER LÍDER DE PROJETO — a lista que o seletor oferece.
 *
 * Até a v3 ela era `perfis` inteira: todos os acessos do sistema, sem
 * filtro. Passou a sair do ORGANOGRAMA, e a regra é "estar cadastrado
 * basta" — não há autorização por pessoa a conceder. Duas condições:
 *
 *   · `ativo` — quem saiu da empresa não assume projeto novo. Continua
 *     liderando o que já lidera (a RLS lê `projetos.lider_id`, não esta
 *     lista), só não entra em projeto novo;
 *   · `perfil_id` não nulo — LIDERAR É APROVAR, e aprovar exige login: a
 *     RLS e `aprovar_solicitacao_lider()` conferem `auth.uid()` contra
 *     `projetos.lider_id`. Essa não é uma escolha de produto que se possa
 *     afrouxar: sem acesso ao sistema, o campo nasceria esperando decisão
 *     de quem não tem como decidir.
 *
 * A segunda condição também ESTREITA O TIPO: o retorno tem
 * `perfil_id: string`, o que dispensa um `?? ""` em cada tela que monta o
 * `lider_id`.
 *
 * A ordem é por nome porque é assim que se procura gente numa lista.
 */
export function lideresDisponiveis(colaboradores: readonly Colaborador[]): LiderDisponivel[] {
  return colaboradores
    .filter((c) => c.ativo && c.perfil_id !== null)
    .map((c) => ({
      perfil_id: c.perfil_id as string,
      nome: c.nome,
      cargo: c.cargo,
      setor: c.setor,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export function porStatus(
  solicitacoes: readonly SolicitacaoDeLista[],
  status: StatusSolicitacao
): SolicitacaoDeLista[] {
  return solicitacoes.filter((s) => s.status === status);
}

/**
 * O que ESTA pessoa tem para decidir: pedidos esperando aprovação nos
 * projetos que ela lidera. A Direção vê todos — é ela que destrava campo
 * de líder ausente.
 */
export function solicitacoesParaAprovar(
  solicitacoes: readonly SolicitacaoDeLista[],
  usuarioId: string,
  papel: Papel,
  projetos: readonly Projeto[]
): SolicitacaoDeLista[] {
  return solicitacoes.filter((s) => podeAprovar(usuarioId, papel, s, projetos));
}

/**
 * Vai para a conferência tudo que tem equipamento, JÁ FOI APROVADO e não
 * terminou: antes da entrega (para registrar a saída) e depois dela (para
 * registrar a volta). Campo urgente não espera o hotel para levar o
 * medidor, mas espera o líder — o banco recusa a entrega antes disso.
 */
export function solicitacoesParaConferencia(
  solicitacoes: readonly SolicitacaoDeLista[]
): SolicitacaoDeLista[] {
  const emAndamento: readonly StatusSolicitacao[] = ["Aprovada", "Logística confirmada", "Em campo"];
  return solicitacoes.filter((s) => s.equipamentos.length > 0 && emAndamento.includes(s.status));
}

/** A avaria que ainda demanda alguma coisa de alguém. */
export function avariasEmAberto(avarias: readonly AvariaResolvida[]): AvariaResolvida[] {
  return avarias.filter((a) => a.situacao === "Aberta" || a.situacao === "Em reparo");
}

/** Os números ao lado das abas do menu. */
export function contadoresDoMenu(
  solicitacoes: readonly SolicitacaoDeLista[],
  avarias: readonly AvariaResolvida[],
  usuarioId: string,
  papel: Papel,
  projetos: readonly Projeto[]
): ContadoresDoMenu {
  return {
    aprovacoes: solicitacoesParaAprovar(solicitacoes, usuarioId, papel, projetos).length,
    logistica: porStatus(solicitacoes, "Aprovada").length,
    conferencia: solicitacoesParaConferencia(solicitacoes).length,
    avarias: avariasEmAberto(avarias).length,
  };
}

/**
 * Total da solicitação: despesas com prestação de contas + diárias. Vale
 * só para o tipo Financeiro — o administrativo não movimenta dinheiro.
 *
 * As diárias são recalculadas (dias × valor unitário) em vez de somar
 * `valor_total`, para a mesma conta valer numa linha ainda não salva, no
 * formulário, onde a coluna gerada do banco ainda não existe.
 */
export function totalDaSolicitacao(s: Pick<Solicitacao, "despesas" | "diarias">): number {
  const despesas = s.despesas.reduce((t, d) => t + (Number(d.valor) || 0), 0);
  const diarias = s.diarias.reduce(
    (t, d) => t + (Number(d.dias) || 0) * (Number(d.valor_unitario) || 0),
    0
  );
  return despesas + diarias;
}

export function periodoTexto(s: Pick<Solicitacao, "periodo_inicio" | "periodo_fim">): string {
  const de = dataISOparaBR(s.periodo_inicio);
  const ate = dataISOparaBR(s.periodo_fim);
  if (!de && !ate) return "—";
  return `${de || "?"} a ${ate || "?"}`;
}

/** Equipe resumida para a tabela: o líder na frente, e "+N" para o resto.
 *  A lista inteira fica no detalhe. */
export function equipeResumo(s: Pick<Solicitacao, "equipe">): string {
  if (!s.equipe.length) return "—";
  const lider = s.equipe.find((e) => e.lider) ?? s.equipe[0];
  const resto = s.equipe.length - 1;
  if (!lider) return "—";
  return resto > 0 ? `${lider.colaborador} +${resto}` : lider.colaborador;
}

/** O que este pedido tem dentro, em uma linha. */
export function resumoBlocos(s: SolicitacaoDeLista): string {
  const partes: string[] = [];
  if (s.equipe.length) partes.push(`${s.equipe.length} na equipe`);
  if (s.veiculo_necessario) {
    partes.push(`Veículo${s.transporte_locadora ? ` (${s.transporte_locadora})` : ""}`);
  }
  if (s.hospedagens.length) partes.push(`Hospedagem em ${s.hospedagens.length} cidade(s)`);
  if (s.equipamentos.length) partes.push(`${s.equipamentos.length} equipamento(s)`);
  if (s.despesas.length) partes.push(`${s.despesas.length} despesa(s)`);
  if (s.diarias.length) partes.push(`${s.diarias.length} diária(s)`);
  return partes.join(" · ") || "Sem itens";
}

/**
 * Rótulo curto do status de curso para a tabela — a coluna é estreita e
 * "Abaixo do previsto" não cabe. O percentual é o que se olha de fato.
 */
export function cursoCurto(s: Pick<Solicitacao, "status_curso" | "desvio_percentual">): string {
  const curso = s.status_curso || "Sem realizado";
  if (curso === "Sem previsto") return "s/ previsto";
  if (curso === "Sem realizado") return "s/ real";
  const pct = Number(s.desvio_percentual);
  if (!Number.isFinite(pct)) return curso;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/** Desvio em dinheiro e em percentual, com sinal — é o que diz se o campo
 *  custou mais ou menos, e quanto. */
export function desvioTexto(
  s: Pick<Solicitacao, "desvio_valor" | "desvio_percentual" | "previsto_total">
): string {
  if (!Number(s.previsto_total)) return "—";
  const valor = Number(s.desvio_valor) || 0;
  const pct = Number(s.desvio_percentual);
  const sinal = valor > 0 ? "+" : valor < 0 ? "−" : "";
  const pctTexto = Number.isFinite(pct) ? ` (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)` : "";
  return `${sinal}${formatarMoeda(Math.abs(valor))}${pctTexto}`;
}

/** Quem aprova esta solicitação, para a tela poder dizer o nome. */
export function liderDaSolicitacao(
  s: Pick<Solicitacao, "projeto_id">,
  projetos: readonly Projeto[]
): string {
  const projeto = projetos.find((p) => p.id === s.projeto_id);
  return projeto?.lider || "—";
}

// ─── Filtro da lista de solicitações ─────────────────────────────────────

export interface FiltrosDeSolicitacao {
  tipo: string;
  status: string;
  curso: string;
  busca: string;
}

export const FILTROS_VAZIOS: FiltrosDeSolicitacao = { tipo: "", status: "", curso: "", busca: "" };

export function filtrarSolicitacoes(
  solicitacoes: readonly SolicitacaoDeLista[],
  filtros: FiltrosDeSolicitacao
): SolicitacaoDeLista[] {
  const busca = filtros.busca.trim().toLowerCase();
  return solicitacoes.filter((s) => {
    if (filtros.tipo && s.tipo !== filtros.tipo) return false;
    if (filtros.status && s.status !== filtros.status) return false;
    if (filtros.curso && (s.status_curso || "") !== filtros.curso) return false;
    if (!busca) return true;

    // A equipe entra na busca: quem procura "quem foi para Aquiraz"
    // procura pelo nome da pessoa, não pelo código do pedido.
    const equipe = s.equipe.map((e) => e.colaborador).join(" ");
    const alvo =
      `${s.codigo} ${s.cliente_projeto} ${s.destino ?? ""} ${s.solicitante_nome} ${equipe}`.toLowerCase();
    return alvo.includes(busca);
  });
}
