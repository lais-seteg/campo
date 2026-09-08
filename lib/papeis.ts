// ═══════════════════════════════════════════════════════════════════════
//  QUEM PODE O QUÊ — módulo puro, sem banco e sem I/O.
//
//  Existe separado por dois motivos. O primeiro é o de sempre: função pura
//  é testável e não arrasta dependência. O segundo é específico daqui — o
//  middleware roda em Edge Runtime e importa este arquivo; se ele
//  encostasse no supabase-js, o bundle de Edge quebraria.
//
//  ── OS CINCO PAPÉIS, E O QUE NÃO É PAPEL ──
//
//    direcao        — o topo. Só ela cadastra projeto, líder e organograma.
//    administrativo — OPERA: cadastra hotel, providencia logística e
//                     material, abre e acompanha pedido. VÊ valor.
//    financeiro     — vê valor consolidado. Não cadastra e não aprova.
//    tecnico        — abre solicitação, edita, registra conferência.
//    gestor         — HERANÇA. Continua na lista porque `perfis` é
//                     compartilhada com o Controle de Estoque e o CHECK de
//                     lá conhece o papel, mas nenhum acesso o tem desde o
//                     supabase/09, e ele NÃO vê valor.
//
//  ── QUEM VÊ VALOR REAL × PROJETADO ──
//
//  Líder de projeto, Direção e administrativo — mais o financeiro. A regra
//  vem do supabase/09, e ela inverteu o que o 07 tinha decidido: o 07 tirou
//  o `administrativo` da lista porque "operar não exige o previsto × real".
//  Na operação real é o contrário — quem fecha veículo, hotel e material é
//  quem precisa saber se o campo está estourando o previsto, porque
//  descobrir no fechamento é tarde para trocar de hotel ou de locadora.
//
//  ── O VETO POR PESSOA ──
//
//  `perfis.ve_valores` NEGA por pessoa, e é conferido antes do papel. Existe
//  porque houve um pedido sobre alguém e não sobre uma função: um acesso do
//  administrativo que não pode ver o previsto × real. Um sexto papel para
//  abrigar essa exceção transformaria uma decisão de gente numa categoria
//  permanente do sistema.
//
//  Por ser VETO e não concessão, o padrão ligado é seguro: coluna ausente
//  ou nula deixa o papel decidir, que é o comportamento de sempre.
//
//  LÍDER NÃO É PAPEL. É ser `lider_id` de uma linha de `projetos`. Um
//  colaborador pode liderar um projeto e não liderar outro, e é por isso
//  que a pergunta certa nunca é "esta pessoa é líder?", e sim "esta pessoa
//  é líder DESTE projeto?" — quem responde é `ehLiderDoProjeto`.
//
//  Quem PODE se tornar líder é outra pergunta, e ela não se responde aqui:
//  é estar no ORGANOGRAMA (`colaboradores`), ativo e com acesso ao sistema
//  — lido por `lideresDisponiveis()` em lib/consultas.ts. Este arquivo
//  trata de quem JÁ é líder; aquele, de quem pode vir a ser.
//
//  Nada aqui é a barreira de verdade: a barreira é a RLS do banco (ver
//  supabase/04_direcao_e_aprovacao.sql). Estas funções decidem o que a
//  tela mostra e devolvem 403 antes de a chamada sair, o que é diferente
//  de impedir. Esconder a aba evita o uso casual; a RLS impede o resto.
// ═══════════════════════════════════════════════════════════════════════

import type { Papel, Projeto, Solicitacao, StatusSolicitacao } from "@/lib/tipos";
import { STATUS_ENCERRADOS } from "@/lib/tipos";

/** Só a Direção cadastra projeto e líder. */
export function ehDirecao(papel: Papel): boolean {
  return papel === "direcao";
}

/**
 * A Direção pode tudo que a Gestão pode: papel de cima com menos poder que
 * o de baixo não faria sentido. É a mesma regra que a função `eh_gestor()`
 * do banco passou a seguir — e ela vale também no Controle de Estoque, que
 * usa a mesma função.
 */
export function ehGestao(papel: Papel): boolean {
  return papel === "gestor" || papel === "direcao";
}

/**
 * Lidera ESTE projeto? A Direção entra como líder de qualquer um — líder
 * de férias não pode travar o campo inteiro.
 */
export function ehLiderDoProjeto(
  usuarioId: string,
  papel: Papel,
  projetoId: string | null | undefined,
  projetos: readonly Projeto[]
): boolean {
  if (!projetoId) return false;
  if (ehDirecao(papel)) return true;
  const projeto = projetos.find((p) => p.id === projetoId);
  return !!projeto && projeto.lider_id === usuarioId;
}

/** Lidera algum projeto? É o que acende a aba de Aprovações. */
export function ehLider(usuarioId: string, papel: Papel, projetos: readonly Projeto[]): boolean {
  return ehDirecao(papel) || projetos.some((p) => p.lider_id === usuarioId);
}

// ─── Quem vê dinheiro ────────────────────────────────────────────────────
//
// Até a v3, todo usuário ativo via todo valor: o Painel abria para
// qualquer um, com o previsto × real da empresa inteira. Passou a valer o
// contrário — valor é de quem responde por ele ou opera com ele:
//
//   · o LÍDER vê o dinheiro DOS PROJETOS DELE, porque a conta é dele;
//   · Direção, administrativo e financeiro veem o consolidado;
//   · quem não é nenhum desses não vê valor nenhum;
//   · e QUALQUER UM dos acima para de ver se `ve_valores` estiver em
//     `false` — o veto individual vem antes do papel.
//
// Nada disso é a barreira: é a política do banco (`pode_ver_valores()`)
// que não entrega a linha. Esconder na tela evita a pergunta; a RLS impede
// a resposta.

/**
 * O mínimo que estas funções precisam saber sobre quem está perguntando.
 *
 * Estruturalmente satisfeito por `UsuarioLogado` (lib/sessao.ts), que este
 * arquivo NÃO importa de propósito: o middleware roda em Edge e importa
 * daqui; puxar `sessao.ts` arrastaria o supabase-js para o bundle de Edge
 * e quebraria o build.
 */
export interface QuemPergunta {
  id: string;
  papel: Papel;
  /** `perfis.ve_valores`. O veto individual — ver o cabeçalho. */
  veValores: boolean;
}

/** Financeiro: existe para ver o consolidado. */
export function ehFinanceiro(papel: Papel): boolean {
  return papel === "financeiro";
}

/**
 * O administrativo: QUEM OPERA. Cadastra hotel, providencia logística e
 * material, abre e acompanha pedido — e vê valor, porque é com ele que
 * opera.
 */
export function ehAdministrativo(papel: Papel): boolean {
  return papel === "administrativo";
}

/**
 * Quem libera a FOLGA ENTRE CAMPOS de um equipamento — a véspera e o dia
 * seguinte que a reserva segura por padrão (ver supabase/11 e 12).
 *
 * O administrativo, porque é ele que opera a logística e é o único que sabe
 * se dá tempo de conferir na volta e separar de novo; e a Direção, cujo
 * acesso é total. A Gestão fica de fora de propósito: isto não é
 * supervisão, é a decisão de quem carrega o equipamento.
 *
 * Isto libera SÓ a folga. Conflito real de datas — outro campo com o mesmo
 * item no mesmo período — continua barrado para todo mundo, e quem barra é
 * `reservar_equipamentos_solicitacao()` no banco.
 */
export function podeLiberarFolga(papel: Papel): boolean {
  return ehAdministrativo(papel) || ehDirecao(papel);
}

/**
 * Quem entra na aba Cadastros (hotéis e valor de referência da diária): o
 * administrativo, que faz o trabalho, e a Gestão, que supervisiona e
 * corrige. `ehGestao` já inclui a Direção.
 *
 * Fora daqui: técnico e financeiro. Espelha as políticas de `hoteis` e
 * `diaria_valores` em supabase/07 — a barreira é lá, isto só evita mostrar
 * a aba a quem tomaria 403 ao salvar.
 */
export function podeAbrirCadastros(papel: Papel): boolean {
  return ehAdministrativo(papel) || ehGestao(papel);
}

/**
 * Vê valor CONSOLIDADO DE TODO MUNDO? Só quem tem a visão da empresa. O
 * líder não entra aqui: ele vê os projetos dele, o que é diferente de ver
 * o total da operação.
 *
 * O veto individual é conferido PRIMEIRO — quem está vetado não vê valor
 * nenhum, e a pergunta sobre o papel nem chega a ser feita.
 */
export function veTodosOsProjetos(quem: QuemPergunta): boolean {
  if (!quem.veValores) return false;
  return ehDirecao(quem.papel) || ehAdministrativo(quem.papel) || ehFinanceiro(quem.papel);
}

/**
 * Pode ver valor, em alguma medida? É a pergunta que o previsto × real, o
 * gasto do projeto e o custo de avaria fazem antes de aparecer.
 *
 * Espelha `pode_ver_valores()` do banco — que é a barreira de verdade. Lá,
 * como aqui, o veto vem antes de tudo: nem liderar projeto devolve o valor
 * a quem foi vetado.
 */
export function podeVerValores(quem: QuemPergunta, projetos: readonly Projeto[]): boolean {
  if (!quem.veValores) return false;
  return veTodosOsProjetos(quem) || ehLider(quem.id, quem.papel, projetos);
}

/** O Painel é a tela do valor consolidado: quem não vê valor não tem o que
 *  fazer nela, e a aba nem aparece. */
export function podeAbrirPainel(quem: QuemPergunta, projetos: readonly Projeto[]): boolean {
  return podeVerValores(quem, projetos);
}

/**
 * Os projetos que ESTA pessoa vê no Painel: os dela, se é líder; todos, se
 * a função é olhar o todo.
 *
 * Devolver a lista (em vez de um booleano "pode ver tudo") é o que faz o
 * Painel do líder ser o painel DELE: as somas de lá partem desta lista, e
 * não da lista inteira com um filtro esquecido em alguma linha.
 */
export function projetosVisiveis(quem: QuemPergunta, projetos: readonly Projeto[]): Projeto[] {
  if (veTodosOsProjetos(quem)) return [...projetos];
  return projetos.filter((p) => p.lider_id === quem.id);
}

/** Projeto que aceita solicitação NOVA. Stand By é pausa, Cancelado e
 *  Finalizado são fim — e o banco recusa o insert nos três. */
export function aceitaSolicitacaoNova(projeto: Projeto): boolean {
  return projeto.situacao === "Ativo";
}

/**
 * Pode decidir ESTA solicitação? Só o líder do projeto dela (ou a Direção),
 * e só enquanto ela espera decisão. A checagem autoritativa é a de
 * `aprovar_solicitacao_lider()` no banco, que confere `auth.uid()` contra
 * `projetos.lider_id` dentro da mesma transação em que muda o status.
 */
export function podeAprovar(
  usuarioId: string,
  papel: Papel,
  solicitacao: Pick<Solicitacao, "status" | "projeto_id">,
  projetos: readonly Projeto[]
): boolean {
  if (solicitacao.status !== "Aguardando aprovação") return false;
  return ehLiderDoProjeto(usuarioId, papel, solicitacao.projeto_id, projetos);
}

/**
 * Pode editar? Não se edita o que terminou: pedido Finalizado ou Cancelado
 * é registro, e reescrever registro apaga a história em vez de corrigi-la.
 */
export function podeEditar(status: StatusSolicitacao): boolean {
  return !STATUS_ENCERRADOS.includes(status);
}

/**
 * Logística só depois de aprovado. Fechar hotel e carro de um campo que o
 * líder ainda não validou é gastar antes da hora.
 */
export function podeFecharLogistica(status: StatusSolicitacao): boolean {
  return status === "Aprovada" || status === "Logística confirmada";
}

/**
 * Equipamento não sai antes da aprovação — a conferência de entrega recusa
 * pedido `Aguardando aprovação` (e o banco recusa junto, em
 * `registrar_entrega_solicitacao`).
 */
export function podeRegistrarEntrega(status: StatusSolicitacao): boolean {
  return status === "Aprovada" || status === "Logística confirmada";
}

export function podeRegistrarDevolucao(status: StatusSolicitacao): boolean {
  return status === "Em campo";
}

/** Cancelar é possível a qualquer momento, menos depois do fim. */
export function podeCancelar(status: StatusSolicitacao): boolean {
  return !STATUS_ENCERRADOS.includes(status);
}

// ─── Rotas por papel ─────────────────────────────────────────────────────
//
// A mesma lista serve ao middleware (primeira barreira, sem acesso ao
// banco) e a cada página (checagem autoritativa via requirePapel). Estar
// num lugar só evita a divergência clássica: proteger a página e esquecer
// a rota de API que ela chama.
export interface RestricaoDeRota {
  prefixo: string;
  papeis: readonly Papel[];
}

export const ROTAS_RESTRITAS: readonly RestricaoDeRota[] = [
  // Cadastro de projetos e líderes: exclusivo da Direção, na tela e na RLS.
  { prefixo: "/direcao", papeis: ["direcao"] },
  { prefixo: "/api/projetos", papeis: ["direcao"] },
  // O ORGANOGRAMA é da Direção — inclusive para LER, ao contrário de
  // `hoteis`, que todo mundo consulta. Cadastro de pessoal (cargo, setor,
  // contato, vínculo da empresa inteira) não é dado de navegação. A
  // política de `colaboradores` em supabase/08_organograma.sql diz o
  // mesmo, e ela é a barreira; isto aqui evita o clique que terminaria em
  // 403. Note que a GESTÃO fica fora — foi decisão explícita, e é a única
  // exceção ao "a Gestão pode tudo que a Direção pode".
  { prefixo: "/organograma", papeis: ["direcao"] },
  { prefixo: "/api/colaboradores", papeis: ["direcao"] },
  // Cadastros — hotéis e valor de referência da diária: do ADMINISTRATIVO,
  // que opera, e da GESTÃO, que supervisiona. Fora do menu do técnico e do
  // financeiro — e fora da rota também: menu escondido não impede quem
  // digita o endereço.
  { prefixo: "/cadastros", papeis: ["administrativo", "gestor", "direcao"] },
  { prefixo: "/api/hoteis", papeis: ["administrativo", "gestor", "direcao"] },
  { prefixo: "/api/diarias", papeis: ["administrativo", "gestor", "direcao"] },
];

/** Rota exigida por prefixo, ou `null` quando o caminho é livre a
 *  qualquer usuário ativo. */
export function restricaoDaRota(pathname: string): RestricaoDeRota | null {
  return ROTAS_RESTRITAS.find((r) => pathname === r.prefixo || pathname.startsWith(`${r.prefixo}/`)) ?? null;
}

// ─── Cargo exibido no cabeçalho ──────────────────────────────────────────
//
// Fallback herdado da versão anterior: enquanto `perfis.cargo` não estiver
// preenchido para todo mundo, estes quatro acessos históricos continuam
// mostrando o cargo certo em vez de um espaço em branco.
const CARGOS_PADRAO: Readonly<Record<string, string>> = {
  maite: "Assistente de PMO",
  jonatas: "Assistente de Compras",
  juliana: "Coordenadora do Administrativo",
  gestao: "Gestão",
};

export function cargoDoPerfil(usuario: string, cargo: string | null): string {
  const informado = (cargo ?? "").trim();
  if (informado) return informado;
  return CARGOS_PADRAO[usuario.toLowerCase()] ?? "";
}
