// ═══════════════════════════════════════════════════════════════════════
//  TIPOS DO DOMÍNIO — Solicitação de Campo
//
//  Fonte da verdade: supabase/01_solicitacoes.sql, 02_campo_v2.sql e
//  04_direcao_e_aprovacao.sql. Cada união aqui espelha um
//  `check (... in (...))` do banco — quando um dos dois mudar, o outro
//  tem de mudar junto, e é de propósito que a lista esteja escrita duas
//  vezes: o banco recusa o valor errado, mas só o TypeScript recusa o
//  valor errado ANTES de a requisição sair.
//
//  Não há geração automática de tipos a partir do Supabase aqui, por
//  escolha: o banco é compartilhado com o Controle de Estoque e tem
//  tabelas que este sistema não deve nem enxergar. Declarar à mão o que
//  o campo usa é também documentar a superfície de contato entre os dois.
// ═══════════════════════════════════════════════════════════════════════

// ─── Papéis ──────────────────────────────────────────────────────────────
//
// São CINCO, e "líder" não é um deles. Ser líder é ser `lider_id` de uma
// linha de `projetos` — a mesma pessoa pode liderar um projeto e não
// liderar outro. Ver lib/papeis.ts, onde essa distinção vira função.
//
// `administrativo` e `financeiro` não cadastram e não aprovam. O primeiro
// OPERA (hotel, veículo, material) e o segundo existe para VER VALOR
// CONSOLIDADO — e desde o 09 os dois veem valor, junto com a Direção e com
// quem lidera projeto.
//
// `gestor` continua no CHECK do banco porque a tabela é compartilhada com o
// Controle de Estoque, mas não há acesso com esse papel e ele não vê valor.
export const PAPEIS = ["direcao", "gestor", "administrativo", "financeiro", "tecnico"] as const;
export type Papel = (typeof PAPEIS)[number];

/** Linha de `perfis` — tabela criada pelo Controle de Estoque e compartilhada. */
export interface Perfil {
  id: string;
  usuario: string;
  nome: string;
  papel: Papel;
  cargo: string | null;
  ativo: boolean;
  /**
   * VETO individual sobre valor real × projetado (supabase/09). Padrão
   * `true` — é o papel que decide. Em `false`, a pessoa não vê valor mesmo
   * que o papel dela veja, e isso vale até para a Direção.
   *
   * Opcional no tipo porque `perfis` é lida com `select *` de um banco
   * compartilhado: um site publicado antes da coluna existir não pode
   * quebrar o login por causa dela.
   */
  ve_valores?: boolean;
}

// ─── Organograma ─────────────────────────────────────────────────────────
//
// `perfis` é a lista de quem ENTRA no sistema (a chave dela tem FK para
// `auth.users`); `colaboradores` é a lista de quem TRABALHA na empresa.
// São coisas diferentes, e é por isso que são duas tabelas — ver o
// cabeçalho de supabase/08_organograma.sql.
//
// Só a Direção lê esta tabela, e é a RLS que decide isso.

/** Linha de `colaboradores`. */
export interface Colaborador {
  id: string;
  nome: string;
  /** Matrícula, CREA ou documento. É o que desempata homônimo. */
  codigo: string | null;
  cargo: string | null;
  setor: string | null;
  telefone: string | null;
  email: string | null;
  vinculo: Vinculo;
  /**
   * O acesso desta pessoa ao sistema, quando existe. NULO é o caso comum:
   * colaborador de campo não precisa de login.
   *
   * É este id — e não o `id` do colaborador — que vai para
   * `projetos.lider_id`: quem aprova campo é conferido pela RLS contra
   * `auth.uid()`, e `auth.uid()` é o id do perfil.
   */
  perfil_id: string | null;
  ativo: boolean;
  observacao: string | null;
  criado_em: string;
  criado_por: string | null;
  atualizado_em: string;
}

/**
 * Um candidato a líder de projeto, já resolvido: colaborador do organograma
 * que está ativo e TEM acesso ao sistema. Estar cadastrado basta — não há
 * autorização por pessoa a conceder.
 *
 * `perfil_id` aqui é `string` e não `string | null` de propósito — é o que
 * permite usá-lo direto como `lider_id` sem um `?? ""` em cada tela. Quem
 * estreita o tipo é `lideresDisponiveis()` em lib/consultas.ts.
 */
export interface LiderDisponivel {
  perfil_id: string;
  nome: string;
  cargo: string | null;
  setor: string | null;
}

// ─── Fluxo da solicitação ────────────────────────────────────────────────
//
//   Aguardando aprovação → Aprovada → Logística confirmada
//                        → Em campo → Finalizada
//   (Recusada pelo líder, com motivo · Cancelada a qualquer momento)
export const STATUS_SOLICITACAO = [
  "Aguardando aprovação",
  "Aprovada",
  "Logística confirmada",
  "Em campo",
  "Finalizada",
  "Recusada",
  "Cancelada",
] as const;
export type StatusSolicitacao = (typeof STATUS_SOLICITACAO)[number];

/**
 * Quatro estados NÃO saem de um update direto na tabela:
 * `Aprovada`/`Recusada` são o ato do líder e passam por
 * `aprovar_solicitacao_lider()`; `Em campo`/`Finalizada` são consequência
 * da conferência, que é quem mexe no saldo do estoque. Deixar um update
 * qualquer declarar "em campo" faria o estoque e a solicitação contarem
 * histórias diferentes. O banco recusa; esta constante deixa a regra
 * legível no servidor, antes de a chamada sair.
 */
export const STATUS_NAO_EDITAVEIS_DIRETAMENTE: readonly StatusSolicitacao[] = [
  "Aprovada",
  "Recusada",
  "Em campo",
  "Finalizada",
];

/** Pedido terminado é registro: reescrever registro apaga a história. */
export const STATUS_ENCERRADOS: readonly StatusSolicitacao[] = ["Finalizada", "Cancelada"];

export const TIPOS_SOLICITACAO = ["Administrativo", "Financeiro"] as const;
export type TipoSolicitacao = (typeof TIPOS_SOLICITACAO)[number];

/** Calculado por trigger, com faixa de tolerância de 5%. Nunca digitado. */
export const STATUS_CURSO = [
  "Abaixo do previsto",
  "Dentro do previsto",
  "Acima do previsto",
  "Sem realizado",
  "Sem previsto",
] as const;
export type StatusCurso = (typeof STATUS_CURSO)[number];

/** Calculada pelo banco: `Conforme` só com a conferência inteira fechada. */
export const IDENTIFICACOES_SST = ["Conforme", "Pendente", "Não aplicável"] as const;
export type IdentificacaoSst = (typeof IDENTIFICACOES_SST)[number];

export const VINCULOS = ["Seteg", "Temporário"] as const;
export type Vinculo = (typeof VINCULOS)[number];

/**
 * Os cargos do organograma. Lista FECHADA, e não texto livre: em texto
 * livre "Analista Ambiental II", "analista ambiental 2" e "Analista Amb.
 * II" seriam três cargos diferentes, e o filtro por cargo deixaria de
 * somar.
 *
 * O cargo NÃO decide quem lidera projeto: quem está no organograma, ativo e
 * com acesso ao sistema já é candidato a líder, qualquer que seja o cargo
 * (ver `lideresDisponiveis`). Esta lista existe para o campo ter uma grafia
 * só, não para filtrar liderança.
 *
 * Cargo ANTIGO, de fora desta lista, continua válido no banco e é
 * preservado na edição — ver `validarColaborador`. Só não se escolhe mais.
 */
export const CARGOS = [
  "Analista Ambiental I",
  "Analista Ambiental II",
  "Analista Ambiental III",
  "Gestão",
] as const;
export type Cargo = (typeof CARGOS)[number];

export const GRUPOS_DESPESA = ["Transporte", "Combustível", "Outros"] as const;
export type GrupoDespesa = (typeof GRUPOS_DESPESA)[number];

/**
 * Lista FECHADA porque é sobre a locadora que se negocia contrato: em
 * texto livre, "Movida" viraria cinco grafias e o gasto por locadora não
 * somaria. Com "Outros", dizer qual passa a ser obrigatório (o banco
 * cobra isso em solicitacoes_locadora_outra_check).
 */
export const LOCADORAS = ["Movida", "Localiza", "Unidas", "Outros"] as const;
export type Locadora = (typeof LOCADORAS)[number];

export const TIPOS_HOTEL = ["Hotel", "Pousada", "Flat", "Apart-hotel", "Hostel", "Outro"] as const;
export type TipoHotel = (typeof TIPOS_HOTEL)[number];

export const GRAVIDADES_AVARIA = ["Leve", "Média", "Grave", "Perda total"] as const;
export type GravidadeAvaria = (typeof GRAVIDADES_AVARIA)[number];

export const PROVIDENCIAS_AVARIA = [
  "Em análise",
  "Manutenção",
  "Substituição",
  "Descarte",
  "Sem reparo",
  "Cobrança do prestador",
] as const;
export type ProvidenciaAvaria = (typeof PROVIDENCIAS_AVARIA)[number];

export const SITUACOES_AVARIA = ["Aberta", "Em reparo", "Resolvida", "Cobrada", "Baixada"] as const;
export type SituacaoAvaria = (typeof SITUACOES_AVARIA)[number];

/** Fechar a avaria sem dizer quanto custou esvazia o relatório justamente
 *  na coluna que ele existe para mostrar (solicitacao_avarias_custo_check). */
export const SITUACOES_AVARIA_QUE_EXIGEM_CUSTO: readonly SituacaoAvaria[] = ["Resolvida", "Cobrada"];

export const SITUACOES_RESERVA = ["Reservado", "Em campo", "Devolvido", "Cancelada"] as const;
export type SituacaoReserva = (typeof SITUACOES_RESERVA)[number];

export const MOMENTOS_ASSINATURA = ["Retirada", "Devolução"] as const;
export type MomentoAssinatura = (typeof MOMENTOS_ASSINATURA)[number];

/**
 * Retorno de `situacao_das_assinaturas(id)` — quem já assinou o quê, e qual
 * papel a PESSOA LOGADA pode assinar (`null` quando ela não é parte desta
 * solicitação).
 *
 * O papel é decidido pelo banco e não escolhido pelo cliente: se fosse
 * escolhido, uma pessoa assinaria as duas linhas, que é justamente o que
 * "cada um assina no seu acesso" existe para impedir (supabase/14).
 */
export interface SituacaoDaAssinatura {
  momento: MomentoAssinatura;
  adm_assinada: boolean;
  prestador_assinada: boolean;
  eu_assino: PapelAssinatura | null;
}

export const PAPEIS_ASSINATURA = ["Administrativo", "Prestador"] as const;
export type PapelAssinatura = (typeof PAPEIS_ASSINATURA)[number];

export const TIPOS_ALTERACAO = ["Edição", "Acréscimo", "Status", "Custo"] as const;
export type TipoAlteracao = (typeof TIPOS_ALTERACAO)[number];

// ─── Linhas do banco ─────────────────────────────────────────────────────
//
// `numeric(14,2)` chega do PostgREST já convertido para `number` pelo
// supabase-js; `date` e `timestamptz` chegam como string ISO. Os tipos
// abaixo refletem o que CHEGA, não o que o Postgres armazena.

/** Catálogo do Controle de Estoque. Somente leitura daqui. */
export interface Item {
  id: string;
  codigo: string;
  produto: string;
  categoria: string | null;
  estoque_atual: number;
  em_manutencao: boolean;
}

/** Retorno de `itens_disponiveis_no_periodo(inicio, fim, ignorar)`.
 *
 *  `disponivel` NÃO é o saldo do estoque: é o saldo menos o que já está
 *  comprometido com outros campos no mesmo período. Um medidor que está na
 *  prateleira hoje pode já estar preso a outro campo na semana que vem. */
export interface ItemDisponivel {
  item_id: string;
  codigo: string;
  produto: string;
  categoria: string | null;
  estoque_atual: number;
  em_manutencao: boolean;
  /** Com a folga de `margem_reserva_dias()` aplicada — o que sai sem pedir nada a ninguém. */
  comprometido: number;
  disponivel: number;
  /**
   * O mesmo cálculo SEM a folga: só a sobreposição crua de datas.
   *
   * A diferença entre os dois é exatamente o que o administrativo pode
   * liberar. `disponivel = 0` com `disponivel_estrito > 0` quer dizer "o
   * item está livre nas datas do campo, o que atrapalha é a véspera ou o
   * dia seguinte de outro campo" — negociável. Os dois em zero é conflito
   * real, e não há liberação que resolva.
   */
  comprometido_estrito: number;
  disponivel_estrito: number;
}

/**
 * A situação do projeto. SÓ `Ativo` aceita solicitação nova — Stand By é
 * pausa, Cancelado e Finalizado são fim. Campo JÁ ABERTO segue até o
 * fim: pedido em andamento não morre porque o projeto entrou em pausa.
 *
 * Espelha `projetos_situacao_check`, e o banco também recusa o insert de
 * campo em projeto que não esteja Ativo.
 */
export const SITUACOES_PROJETO = ["Stand By", "Ativo", "Cancelado", "Finalizado"] as const;
export type SituacaoProjeto = (typeof SITUACOES_PROJETO)[number];

export interface Projeto {
  id: string;
  nome: string;
  cliente: string;
  codigo_clockify: string | null;
  /** Cópia do nome do líder, mantida por trigger (projetos_nome_do_lider). */
  lider: string | null;
  /** Quem realmente aprova. Texto livre não aprova nada. */
  lider_id: string | null;
  /** O escopo do projeto: um por linha na tela, texto separado por vírgula
   *  no banco. Até a v3 se chamava `programas`. */
  escopo: string | null;
  /** O prazo do contrato. Opcionais: projeto sem data ainda precisa de
   *  líder cadastrado, e é o líder que destrava o campo. */
  data_inicio: string | null;
  data_fim: string | null;
  observacao: string | null;
  situacao: SituacaoProjeto;
  /** DERIVADA de `situacao` por trigger no banco (ativo = situacao é
   *  Ativo). Continua aqui porque índices, filtros e políticas antigas a
   *  leem — mas quem escreve escreve em `situacao`. */
  ativo: boolean;
  criado_em: string;
  criado_por: string | null;
  atualizado_em: string;
}

/**
 * Uma linha de gasto previsto do projeto: categoria + valor TOTAL previsto
 * (não valor por dia — isso eram as três colunas `previsto_*_dia`, que a
 * v3 tirou das telas).
 *
 * Ler esta tabela exige `pode_ver_valores()` no banco: para técnico que não
 * lidera projeto, ela simplesmente volta vazia.
 */
export interface ProjetoGastoPrevisto {
  id: string;
  projeto_id: string;
  categoria: string;
  valor: number;
  observacao: string | null;
  criado_em: string;
  criado_por: string | null;
  atualizado_em: string;
}

/** As categorias que aparecem no datalist do cadastro. Sugestão, não lista
 *  fechada: cada contrato tem gasto que os outros não têm. */
export const CATEGORIAS_DE_GASTO = [
  "Aluguel de veículo",
  "Combustível",
  "Hospedagem",
  "Alimentação",
  "Diárias de equipe",
  "EPI",
  "Análise laboratorial",
  "Licença ambiental",
  "Frete de equipamento",
  "Manutenção de equipamento",
  "Passagens",
  "Pedágio e estacionamento",
  "Serviço de terceiros",
  "Outros",
] as const;

export interface Hotel {
  id: string;
  nome: string;
  tipo: TipoHotel;
  municipio: string;
  uf: string;
  endereco: string | null;
  bairro: string | null;
  telefone: string | null;
  whatsapp: string | null;
  email: string | null;
  contato_nome: string | null;
  valor_diaria: number;
  cafe_incluso: boolean;
  estacionamento: boolean;
  aceita_faturamento: boolean;
  observacao: string | null;
  ativo: boolean;
  criado_em: string;
  criado_por: string | null;
  atualizado_em: string;
}

/** Valor de referência da diária de alimentação. Mora em tabela e não no
 *  código porque mudar o valor é decisão administrativa, não deploy. */
export interface DiariaValor {
  id: string;
  tipo_diaria: string;
  vinculo: Vinculo;
  pernoite: boolean;
  valor: number;
  ativo: boolean;
  atualizado_em: string;
}

export interface SolicitacaoEquipamento {
  id: string;
  solicitacao_id: string;
  item_id: string | null;
  descricao: string | null;
  quantidade: number;
  entregue: boolean;
  teste_entrega: boolean;
  devolvido: boolean;
  teste_devolucao: boolean;
  avaria: boolean;
  avaria_obs: string | null;
  /**
   * O administrativo liberou este item para sair sem a folga entre campos
   * (supabase/12). Nunca dispensa conflito real de datas — só a folga.
   *
   * Opcional porque `solicitacao_equipamentos` é lida com embed `*`: um
   * deploy anterior à coluna não pode quebrar a leitura.
   */
  folga_dispensada?: boolean;
  folga_dispensada_por?: string | null;
  folga_dispensada_em?: string | null;
  folga_dispensada_motivo?: string | null;
}

export interface SolicitacaoHospedagem {
  id: string;
  solicitacao_id: string;
  cidade: string;
  /**
   * Quem dorme nesta cidade (supabase/13). Livre porque a linha é por
   * CIDADE e pode abrigar mais de uma pessoa; o formulário oferece a equipe
   * do próprio pedido como sugestão.
   *
   * Opcional no tipo porque as filhas são lidas com embed `*`: um deploy
   * anterior à coluna não pode quebrar a leitura.
   */
  hospedes?: string | null;
  entrada: string | null;
  saida: string | null;
  dias: number | null;
  hotel_id: string | null;
  diaria_prevista: number;
  diaria_real: number | null;
  reserva_codigo: string | null;
}

/**
 * Quando a linha de custo entrou por AJUSTE EM CAMPO, e não pelo formulário
 * (supabase/17).
 *
 * Não é só auditoria: é o que PROTEGE a linha. A edição do pedido apaga as
 * diárias e as despesas e as reescreve a partir do formulário
 * (`limparFilhas`); linha marcada fica fora dessa limpeza — o mesmo
 * mecanismo que já guarda o equipamento entregue. Sem isso, a diária
 * acrescentada hoje sumiria na próxima correção de qualquer outro campo.
 *
 * Opcional no tipo porque as filhas são lidas com embed `*`: um deploy
 * anterior à coluna não pode quebrar a leitura.
 */
interface Acrescentavel {
  acrescentado_em?: string | null;
  acrescentado_por?: string | null;
}

export interface SolicitacaoDespesa extends Acrescentavel {
  id: string;
  solicitacao_id: string;
  grupo: GrupoDespesa;
  descricao: string | null;
  valor: number;
}

export interface SolicitacaoDiaria extends Acrescentavel {
  id: string;
  solicitacao_id: string;
  colaborador: string;
  vinculo: Vinculo;
  tipo_diaria: string;
  dias: number;
  valor_unitario: number;
  /** Coluna gerada (dias × valor_unitario) — nunca enviada pelo aplicativo. */
  valor_total: number;
  dados_bancarios: string | null;
}

/** Uma linha do checklist como a pessoa a deixou, ainda sem registrar. */
export interface LinhaDoRascunho {
  id: string;
  marcado: boolean;
  teste: boolean;
  avaria: boolean;
  observacao: string;
  gravidade: string;
  custo: string;
  providencia: string;
  fornecedor: string;
}

/**
 * O checklist a meio preenchimento (`solicitacoes.checklist_rascunho`,
 * supabase/17).
 *
 * `momento` existe para o rascunho da RETIRADA não ser aplicado à tela da
 * DEVOLUÇÃO: são duas conferências do mesmo pedido, e as marcas de uma não
 * dizem nada sobre a outra.
 */
export interface ChecklistRascunho {
  momento: MomentoAssinatura;
  data: string;
  linhas: LinhaDoRascunho[];
  salvo_em: string;
}

export interface SolicitacaoEquipe {
  id: string;
  solicitacao_id: string;
  colaborador: string;
  funcao: string | null;
  codigo_clockify: string | null;
  vinculo: Vinculo;
  /** Um por solicitação, garantido por índice único parcial no banco. */
  lider: boolean;
  telefone: string | null;
}

export interface SolicitacaoEpi {
  id: string;
  solicitacao_id: string;
  epi: string;
  quantidade: number;
  conferido: boolean;
  ca: string | null;
  observacao: string | null;
}

/** Somente leitura para o aplicativo: quem escreve são as funções do banco,
 *  que travam as linhas do catálogo antes de conferir saldo. Deixar o
 *  servidor inserir reserva à mão desfaria a garantia contra dois pedidos
 *  simultâneos furarem o estoque. */
export interface ItemReserva {
  id: string;
  item_id: string;
  solicitacao_id: string;
  solicitacao_equipamento_id: string | null;
  quantidade: number;
  inicio: string;
  fim: string;
  situacao: SituacaoReserva;
  criado_em: string;
  usuario_id: string | null;
  usuario_nome: string | null;
  baixado_em: string | null;
  devolvido_em: string | null;
}

export interface SolicitacaoAvaria {
  id: string;
  solicitacao_id: string;
  solicitacao_equipamento_id: string | null;
  item_id: string | null;
  descricao: string;
  gravidade: GravidadeAvaria;
  causa: string | null;
  responsavel: string | null;
  custo_estimado: number;
  custo_real: number | null;
  providencia: ProvidenciaAvaria;
  fornecedor: string | null;
  nota_fiscal: string | null;
  situacao: SituacaoAvaria;
  aberto_em: string;
  fechado_em: string | null;
  usuario_id: string | null;
  usuario_nome: string | null;
}

/** Avaria com os nomes já resolvidos, para o relatório e o painel não
 *  precisarem cruzar três listas em cada linha. */
export interface AvariaResolvida extends SolicitacaoAvaria {
  solicitacao_codigo: string;
  projeto: string;
  equipamento: string;
}

/** A assinatura ENTRA E NÃO SAI: uma por momento e papel, sem update e sem
 *  delete pelo aplicativo. Assinatura que se reescreve não prova nada. */
export interface SolicitacaoAssinatura {
  id: string;
  solicitacao_id: string;
  momento: MomentoAssinatura;
  papel: PapelAssinatura;
  nome: string;
  documento: string | null;
  /** PNG em data URL, entre 200 e 400.000 caracteres (limite do banco). */
  imagem: string;
  assinado_em: string;
  usuario_id: string | null;
  usuario_nome: string | null;
}

/** Escrito por trigger, não pelo aplicativo — não depende de o cliente
 *  se comportar. Somente leitura daqui. */
export interface SolicitacaoAlteracao {
  id: string;
  solicitacao_id: string;
  data: string;
  tipo: TipoAlteracao;
  campo: string;
  de: string | null;
  para: string | null;
  usuario_id: string | null;
  usuario_nome: string | null;
}

/** O cabeçalho da solicitação — as colunas de `solicitacoes`, sem os filhos. */
export interface SolicitacaoCabecalho {
  id: string;
  /** SC-0001, vindo de sequence. O código nunca muda (trigger). */
  codigo: string;
  tipo: TipoSolicitacao;
  solicitante_id: string | null;
  solicitante_nome: string;
  /**
   * HERANÇA. O campo saiu da Identificação do formulário (supabase/16): o
   * solicitante já se identifica, e o setor dele não define quem aprova
   * (isso é o projeto) nem o rateio (isso é o escopo).
   *
   * A coluna ficou, com o que os pedidos antigos gravaram — pedido novo
   * chega nulo.
   */
  setor: string | null;
  data_recurso: string | null;
  projeto_id: string | null;
  cliente_projeto: string;
  codigo_clockify: string | null;
  /**
   * O PROGRAMA deste campo, escolhido entre os de `projetos.escopo` — FAUNA,
   * RUIDO, Flora, Qualidade do Ar… (supabase/15).
   *
   * É esta coluna que permite somar gasto POR PROGRAMA, e não só por
   * contrato: um contrato com quatro programas tem quatro orçamentos que se
   * consomem em ritmos diferentes.
   *
   * Texto e não FK — os programas vivem numa coluna separada por vírgula no
   * projeto, e o pedido registra o que existia quando foi aberto, como já
   * faz com `cliente_projeto`. Opcional porque a leitura usa `select *`.
   */
  escopo?: string | null;
  destino: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  observacao: string | null;

  // Veículo (bloco 1 do formulário administrativo)
  veiculo_necessario: boolean;
  veiculo_condutor: string | null;
  veiculo_cpf: string | null;
  veiculo_descricao: string | null;
  veiculo_local_retirada: string | null;
  veiculo_data_retirada: string | null;
  veiculo_hora_retirada: string | null;
  veiculo_local_entrega: string | null;
  veiculo_data_entrega: string | null;
  veiculo_hora_entrega: string | null;

  // Transporte: o valor REAL, com a locadora
  transporte_modalidade: string | null;
  transporte_locadora: Locadora | null;
  transporte_locadora_outra: string | null;
  transporte_contrato: string | null;
  transporte_placa: string | null;

  hospedagem_necessaria: boolean;
  dados_transferencia: string | null;

  // Fluxo
  status: StatusSolicitacao;
  motivo_recusa: string | null;
  aprovado_por: string | null;
  aprovado_em: string | null;
  motivo_cancelamento: string | null;
  cancelado_por: string | null;
  cancelado_em: string | null;
  logistica_por: string | null;
  logistica_em: string | null;
  logistica_obs: string | null;

  // Conferência (o quadro do papel)
  entrega_data: string | null;
  entrega_adm: string | null;
  entrega_prestador: string | null;
  devolucao_data: string | null;
  devolucao_adm: string | null;
  devolucao_prestador: string | null;

  // Previsto × real. Totais, desvio e status de curso são calculados por
  // trigger — enviar qualquer um deles é trabalho jogado fora.
  previsto_veiculo: number;
  previsto_hospedagem: number;
  previsto_alimentacao: number;
  previsto_outros: number;
  real_veiculo: number;
  real_hospedagem: number;
  real_alimentacao: number;
  real_outros: number;
  /** Custo das avarias deste campo, somado por trigger a partir de
   *  `solicitacao_avarias`. Entra no `real_total` — avaria é gasto do
   *  projeto, e deixá-la fora fazia campo com medidor quebrado aparecer
   *  "dentro do previsto". NUNCA enviada pelo aplicativo. */
  real_avaria: number;
  previsto_total: number;
  real_total: number;
  desvio_valor: number;
  desvio_percentual: number | null;
  status_curso: StatusCurso;

  // SST — desde a v3, UMA marca: se aplica ou não se aplica. As seis
  // colunas de conferência abaixo saíram das telas e continuam no banco
  // com o que já estava gravado; nada novo é escrito nelas.
  sst_aplicavel: boolean;
  sst_apr_emitida: boolean;
  sst_pt_emitida: boolean;
  sst_dds_realizado: boolean;
  sst_treinamento_conferido: boolean;
  sst_aso_conferido: boolean;
  sst_epi_conferido: boolean;
  sst_responsavel: string | null;
  sst_observacao: string | null;
  /** Calculada pelo banco. Meia conferência não é conferência. */
  sst_identificacao: IdentificacaoSst;

  /**
   * A área editável do checklist (supabase/14): o que o formulário não
   * previu e sai impresso na folha.
   *
   * TEXTO, e não HTML — ao contrário da Ordem de Compra do SGC, que este
   * checklist imita. A OC é documento congelado e guarda HTML editado;
   * aqui a estrutura da folha é gerada e viva (os quadradinhos movem o
   * estoque), e o que se escreve é frase. Texto puro dispensa o
   * sanitizador que a OC precisou ter.
   *
   * Opcional porque `solicitacoes` é lida com `select *`.
   */
  checklist_observacoes?: string | null;

  /**
   * O checklist a meio preenchimento (supabase/17): o que a pessoa marcou e
   * ainda não registrou.
   *
   * ── POR QUE UM RASCUNHO, E NÃO GRAVAR AS MARCAS ──
   *
   * As marcas de verdade (`entregue`, `teste_entrega`, `avaria`) são
   * escritas por `registrar_entrega_solicitacao` / `..._devolucao_...`,
   * numa transação só, porque é ela que MOVE O ESTOQUE. Gravar clique por
   * clique deixaria o estoque a meio caminho se a conexão caísse.
   *
   * Mas o efeito colateral era perder o trabalho: quem conferia doze
   * itens, assinava e fechava o popup antes de registrar, marcava os doze
   * de novo. O rascunho resolve isso sem tocar no estoque — ele não é
   * fato, é a tela guardada. O registro o zera.
   *
   * `unknown` de propósito: o formato é o do formulário e muda com ele,
   * sem migração. Quem valida é `ChecklistRascunho` na hora de usar; um
   * rascunho de formato velho é descartado, e o pior que acontece é
   * marcar de novo.
   */
  checklist_rascunho?: unknown;

  criado_em: string;
  atualizado_em: string;
}

/** A solicitação COMPLETA: cabeçalho + as dez listas filhas. É o que a tela
 *  de detalhe e o checklist consomem — as duas únicas que precisam de
 *  assinatura e histórico. */
export interface Solicitacao extends SolicitacaoCabecalho {
  equipamentos: SolicitacaoEquipamento[];
  hospedagens: SolicitacaoHospedagem[];
  despesas: SolicitacaoDespesa[];
  diarias: SolicitacaoDiaria[];
  equipe: SolicitacaoEquipe[];
  epis: SolicitacaoEpi[];
  avarias: SolicitacaoAvaria[];
  assinaturas: SolicitacaoAssinatura[];
  alteracoes: SolicitacaoAlteracao[];
  reservas: ItemReserva[];
}

/**
 * A solicitação como as TELAS DE LISTA a recebem — tudo, menos assinatura e
 * histórico de alteração.
 *
 * ── POR QUE ESTE TIPO EXISTE ──
 *
 * `carregarDados()` lê a operação inteira em uma rodada, e essas duas
 * tabelas eram as piores para estarem nela:
 *
 *   · `solicitacao_assinaturas` guarda o PNG desenhado na tela, até 400 mil
 *     caracteres por assinatura, quatro por solicitação. Carregá-las na
 *     lista significava trazer TODA assinatura já feita na empresa a cada
 *     navegação — inclusive para abrir o calendário, que não mostra
 *     nenhuma;
 *   · `solicitacao_alteracoes` é o log de auditoria: cresce para sempre e
 *     nunca é apagado.
 *
 * Nenhuma tela de lista usa as duas. Então elas saíram do carregamento
 * global e passaram a ser lidas POR SOLICITAÇÃO, onde são de fato
 * mostradas (ver `carregarFilhasDaSolicitacao` em lib/dados.ts).
 *
 * O tipo é `Omit`, e não `Solicitacao` com as listas vazias, de propósito:
 * lista vazia diria "esta solicitação não tem assinatura", que é diferente
 * de "esta lista não carrega assinatura". Assim o compilador recusa quem
 * tentar ler `.assinaturas` de um item de lista, em vez de a tela mostrar
 * "sem assinatura" sobre um pedido que tem quatro.
 */
export type SolicitacaoDeLista = Omit<Solicitacao, "assinaturas" | "alteracoes">;

// ─── Estado do schema ────────────────────────────────────────────────────
//
// O sistema entra e continua navegável mesmo com o banco incompleto, e diz
// o que está desligado em vez de fingir. `base` é 01_solicitacoes.sql;
// `v2` é 02_campo_v2.sql + 04_direcao_e_aprovacao.sql (reserva de material,
// calendário, previsto × real).
export interface EstadoEstrutura {
  base: boolean;
  v2: boolean;
}

/** Tudo que uma tela precisa, carregado de uma vez. Ver lib/dados.ts. */
export interface DadosCampo {
  /** SEM assinatura e SEM histórico de alteração — ver `SolicitacaoDeLista`.
   *  Quem precisa das duas é o detalhe, e ele as lê por solicitação. */
  solicitacoes: SolicitacaoDeLista[];
  catalogo: Item[];
  projetos: Projeto[];
  /** Volta VAZIA para quem a RLS não deixa ver valor (técnico que não
   *  lidera projeto). Não é erro: é a política funcionando. */
  gastosPrevistos: ProjetoGastoPrevisto[];
  hoteis: Hotel[];
  diarias: DiariaValor[];
  avarias: AvariaResolvida[];
  perfis: Perfil[];
  estrutura: EstadoEstrutura;
}

// ─── Resposta padrão das rotas ───────────────────────────────────────────
//
// Toda rota de API responde `{ error: string }` em caso de falha, com a
// mensagem já traduzida por lib/erros.ts. O cliente nunca monta mensagem a
// partir de código de erro do Postgres.
export interface RespostaErro {
  error: string;
}
