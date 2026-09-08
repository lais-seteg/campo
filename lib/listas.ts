// ═══════════════════════════════════════════════════════════════════════
//  LISTAS E VALORES DE REFERÊNCIA
//
//  O que está aqui é o que NÃO vem do banco: ou porque ainda não tem
//  cadastro (a aba TECNICOS da planilha), ou porque é só sugestão de
//  digitação (EPIs, UFs), ou porque é o padrão de partida para a tela
//  funcionar antes de o schema ser aplicado (as diárias).
//
//  Nada aqui é autoridade sobre o banco. Quando existe tabela, ela manda —
//  ver `diariasDisponiveis()` logo abaixo.
// ═══════════════════════════════════════════════════════════════════════

import type { DiariaValor, StatusCurso, StatusSolicitacao, Vinculo } from "@/lib/tipos";
import type { IdentificacaoSst, SituacaoAvaria, SituacaoProjeto } from "@/lib/tipos";

/**
 * Aba TECNICOS da planilha (doc/FORMULARIO_…xlsx). Alimenta o seletor de
 * EQUIPE do formulário de solicitação.
 *
 * ── ESTA LISTA ESTÁ DE SAÍDA ──
 *
 * O cadastro de gente que ela esperava já existe: é o ORGANOGRAMA
 * (`colaboradores`, aba própria da Direção — ver
 * supabase/08_organograma.sql). O líder do projeto JÁ vem de lá; a equipe
 * da solicitação ainda vem daqui.
 *
 * O que falta para mudar isso não é código de tela, são duas decisões:
 *
 *   · a política de `colaboradores` hoje é da DIREÇÃO, inclusive para ler.
 *     Quem abre solicitação é técnico e administrativo — eles precisariam
 *     de leitura, e aí o organograma deixa de ser fechado;
 *   · estes dez nomes têm CÓDIGO DE REGISTRO que o organograma não tem
 *     ainda (o campo `codigo` nasceu vazio). Trocar a fonte antes de
 *     preenchê-los faria o checklist impresso sair sem o registro.
 *
 * Enquanto isso, mantenha igual à planilha: ela ainda é a fonte oficial
 * DESTA lista.
 */
export interface Tecnico {
  nome: string;
  codigo: string;
}

export const TECNICOS: readonly Tecnico[] = [
  { nome: "ALAN VICTOR", codigo: "617757852" },
  { nome: "EDMAR XIMENES", codigo: "600294056" },
  { nome: "EVELINE ESQUITA", codigo: "616371101" },
  { nome: "FELIPE GOMES", codigo: "616060670" },
  { nome: "LIZABETH SILVA", codigo: "609755005" },
  { nome: "VALERIO VIEIRA", codigo: "601013611" },
  { nome: "KARLLA MORGANA", codigo: "85673/05-D" },
  { nome: "JEFERSON FREITAS", codigo: "114503/05-P" },
  { nome: "MATHEUS FONTENELLE", codigo: "46095/5-D" },
  { nome: "JULIANA VICENTE", codigo: "0211621838-1" },
];

/** Sugestões do bloco de SST. Lista ABERTA: o campo aceita qualquer texto,
 *  isto é só o atalho para o que se repete. */
export const EPIS_PADRAO: readonly string[] = [
  "Capacete com jugular",
  "Óculos de proteção",
  "Luva isolante",
  "Luva de vaqueta",
  "Botina de segurança",
  "Cinto paraquedista",
  "Talabarte duplo",
  "Protetor auricular",
  "Vestimenta anti-arco",
  "Protetor facial",
  "Colete refletivo",
  "Máscara PFF2",
];

export const UFS: readonly string[] = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

/** A UF que abre selecionada — é onde fica a operação. */
export const UF_PADRAO = "CE";

// ─── Diárias de alimentação ──────────────────────────────────────────────

export const DIARIA_COM_PERNOITE = 55.0;
export const DIARIA_SEM_PERNOITE = 35.0;

/**
 * Padrão de PARTIDA, não autoridade. Quem manda é `diaria_valores` no
 * banco: mudar o valor da diária é decisão administrativa e não pode
 * depender de deploy. Esta lista existe para a tela funcionar enquanto o
 * schema não foi aplicado.
 */
export const DIARIAS_PADRAO: readonly Pick<DiariaValor, "tipo_diaria" | "vinculo" | "pernoite" | "valor">[] = [
  { tipo_diaria: "Diária sem pernoite | SEG À SEX", vinculo: "Seteg", pernoite: false, valor: DIARIA_SEM_PERNOITE },
  { tipo_diaria: "Diária sem pernoite | SAB À DOM", vinculo: "Seteg", pernoite: false, valor: DIARIA_SEM_PERNOITE },
  { tipo_diaria: "Diária com pernoite", vinculo: "Seteg", pernoite: true, valor: DIARIA_COM_PERNOITE },
  {
    tipo_diaria: "Diária colaborador temporário sem pernoite",
    vinculo: "Temporário",
    pernoite: false,
    valor: DIARIA_SEM_PERNOITE,
  },
  {
    tipo_diaria: "Diária colaborador temporário com pernoite",
    vinculo: "Temporário",
    pernoite: true,
    valor: DIARIA_COM_PERNOITE,
  },
];

/** O que a tela oferece de diária: o cadastro, quando existe; o padrão,
 *  enquanto não existe. */
export type DiariaOferecida = Pick<DiariaValor, "tipo_diaria" | "vinculo" | "pernoite" | "valor">;

export function diariasDoVinculo(
  cadastradas: readonly DiariaValor[],
  vinculo: Vinculo
): readonly DiariaOferecida[] {
  const doBanco = cadastradas.filter((d) => d.vinculo === vinculo && d.ativo !== false);
  if (doBanco.length) return doBanco;
  return DIARIAS_PADRAO.filter((d) => d.vinculo === vinculo);
}

export function diariaPorTipo(
  cadastradas: readonly DiariaValor[],
  tipo: string
): DiariaOferecida | null {
  const fonte = cadastradas.length ? cadastradas : DIARIAS_PADRAO;
  return fonte.find((d) => d.tipo_diaria === tipo) ?? null;
}

/** A referência para o valor digitado ficar marcado quando destoa. */
export function referenciaDaDiaria(cadastradas: readonly DiariaValor[], comPernoite: boolean): number {
  const fonte = cadastradas.length ? cadastradas : DIARIAS_PADRAO;
  const achada = fonte.find((d) => d.pernoite === comPernoite && d.vinculo === "Seteg");
  return achada ? achada.valor : comPernoite ? DIARIA_COM_PERNOITE : DIARIA_SEM_PERNOITE;
}

// ─── Cores de status ─────────────────────────────────────────────────────
//
// As classes vêm do design system do Controle de Estoque (style.css). Só se
// pinta aqui — quem calcula status de curso e identificação de SST é o
// banco, por trigger.

const CLASSE_STATUS: Readonly<Record<StatusSolicitacao, string>> = {
  "Aguardando aprovação": "st-perto",
  Aprovada: "st-info",
  "Logística confirmada": "st-info",
  "Em campo": "st-info",
  Finalizada: "st-ok",
  Recusada: "st-ruim",
  Cancelada: "st-neutro",
};

export function classeDoStatus(status: string): string {
  return CLASSE_STATUS[status as StatusSolicitacao] ?? "st-neutro";
}

const CLASSE_CURSO: Readonly<Record<StatusCurso, string>> = {
  "Abaixo do previsto": "st-ok",
  "Dentro do previsto": "st-info",
  "Acima do previsto": "st-ruim",
  "Sem realizado": "st-neutro",
  "Sem previsto": "st-perto",
};

export function classeDoCurso(curso: string): string {
  return CLASSE_CURSO[curso as StatusCurso] ?? "st-neutro";
}

const CLASSE_SST: Readonly<Record<IdentificacaoSst, string>> = {
  Conforme: "st-ok",
  Pendente: "st-perto",
  "Não aplicável": "st-neutro",
};

export function classeDoSst(identificacao: string): string {
  return CLASSE_SST[identificacao as IdentificacaoSst] ?? "st-neutro";
}

const CLASSE_SITUACAO_PROJETO: Readonly<Record<SituacaoProjeto, string>> = {
  Ativo: "st-ok",
  // Stand By é pausa e Cancelado/Finalizado são fim: o amarelo do Stand By
  // é o que faz a Direção lembrar que existe projeto parado esperando
  // decisão, em vez de ele se perder no meio dos neutros.
  "Stand By": "st-perto",
  Cancelado: "st-ruim",
  Finalizado: "st-neutro",
};

export function classeDaSituacaoDoProjeto(situacao: string): string {
  return CLASSE_SITUACAO_PROJETO[situacao as SituacaoProjeto] ?? "st-neutro";
}

const CLASSE_AVARIA: Readonly<Record<SituacaoAvaria, string>> = {
  Aberta: "st-ruim",
  "Em reparo": "st-perto",
  Resolvida: "st-ok",
  Cobrada: "st-ok",
  Baixada: "st-neutro",
};

export function classeDaAvaria(situacao: string): string {
  return CLASSE_AVARIA[situacao as SituacaoAvaria] ?? "st-neutro";
}

/**
 * A MESMA faixa de tolerância do trigger no banco. Existe aqui só para a
 * prévia do formulário dizer o mesmo que a coluna vai dizer depois de
 * salvar — sem ela, um combustível de dez reais jogaria todo campo para
 * "acima" ou "abaixo" e o indicador não diria mais nada.
 *
 * Se o valor mudar no banco, mude aqui junto: divergir faz a prévia
 * mentir, que é pior do que não ter prévia.
 */
export const TOLERANCIA_CURSO = 0.05;

/** A prévia do status de curso, com a mesma regra do trigger. */
export function calcularStatusCurso(previsto: number, real: number): StatusCurso {
  if (previsto <= 0 && real <= 0) return "Sem realizado";
  if (previsto <= 0) return "Sem previsto";
  if (real <= 0) return "Sem realizado";
  const desvio = (real - previsto) / previsto;
  if (desvio > TOLERANCIA_CURSO) return "Acima do previsto";
  if (desvio < -TOLERANCIA_CURSO) return "Abaixo do previsto";
  return "Dentro do previsto";
}
