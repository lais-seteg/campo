// ═══════════════════════════════════════════════════════════════════════
//  O ESTADO DO FORMULÁRIO DE SOLICITAÇÃO
//
//  Um objeto tipado, no lugar dos ~90 `document.getElementById("sAlgo")`
//  que a versão anterior lia e escrevia. A diferença prática: o formulário
//  passa a ter um formato declarado — errar o nome de um campo vira erro
//  de compilação, e não um `null.value` em tempo de execução.
//
//  ── POR QUE OS VALORES SÃO STRING ──
//
//  Data e dinheiro ficam como o usuário digitou ("31/12/2026",
//  "1.234,56"), porque é isso que a máscara produz e é isso que o campo
//  precisa mostrar de volta. A conversão para o formato do banco (ISO e
//  número) acontece uma vez, em `montarCorpo()`, na saída — e não em cada
//  leitura, como acontecia antes.
// ═══════════════════════════════════════════════════════════════════════

import type {
  DiariaValor,
  GrupoDespesa,
  Locadora,
  Projeto,
  SolicitacaoDeLista,
  TipoSolicitacao,
  Vinculo,
} from "@/lib/tipos";
import { dataBRparaISO, dataISOparaBR, diasDeCampo, formatarNumeroBR, parseMoeda } from "@/lib/formato";
import { referenciaDaDiaria } from "@/lib/listas";

// A equipe NÃO tem mais código Clockify por pessoa. O código que importa é
// o do PROJETO, que fica no cabeçalho da solicitação e vem da API do
// Clockify — repeti-lo por pessoa era pedir o mesmo dado N vezes, e a coluna
// `solicitacao_equipe.codigo_clockify` continua no banco com o que já foi
// gravado, sem nada novo sendo escrito nela.
export interface LinhaDeEquipeForm {
  chave: string;
  colaborador: string;
  funcao: string;
  vinculo: Vinculo;
  telefone: string;
  lider: boolean;
}

export interface LinhaDeHospedagemForm {
  chave: string;
  cidade: string;
  /** Quem dorme nesta cidade — a linha é por cidade e pode abrigar vários. */
  hospedes: string;
  hotelId: string;
  entrada: string;
  saida: string;
  diaria: string;
}

export interface LinhaDeEquipamentoForm {
  chave: string;
  itemId: string;
  quantidade: string;
}

export interface LinhaDeDespesaForm {
  chave: string;
  grupo: GrupoDespesa;
  descricao: string;
  valor: string;
}

export interface LinhaDeDiariaForm {
  chave: string;
  colaborador: string;
  vinculo: Vinculo;
  tipoDiaria: string;
  dias: string;
  valor: string;
  dadosBancarios: string;
}

export interface LinhaDeEpiForm {
  chave: string;
  epi: string;
  quantidade: string;
  ca: string;
  conferido: boolean;
}

export interface EstadoDoFormulario {
  tipo: TipoSolicitacao;
  setor: string;
  projetoId: string;
  dataRecurso: string;
  clienteProjeto: string;
  /**
   * O PROGRAMA deste campo, escolhido entre os do projeto (Fauna, Ruído,
   * Flora…). É ele que permite somar gasto por programa, e não só por
   * contrato — um contrato com quatro programas tem quatro orçamentos que
   * se consomem em ritmos diferentes.
   */
  escopo: string;
  codigoClockify: string;
  destino: string;
  periodoInicio: string;
  periodoFim: string;
  observacao: string;

  equipe: LinhaDeEquipeForm[];

  veiculoNecessario: boolean;
  transporteModalidade: string;
  transporteLocadora: Locadora | "";
  transporteLocadoraOutra: string;
  transporteContrato: string;
  transportePlaca: string;
  condutor: string;
  condutorCpf: string;
  veiculoDescricao: string;
  localRetirada: string;
  dataRetirada: string;
  horaRetirada: string;
  localEntrega: string;
  dataEntrega: string;
  horaEntrega: string;

  hospedagemNecessaria: boolean;
  hospedagens: LinhaDeHospedagemForm[];
  equipamentos: LinhaDeEquipamentoForm[];

  despesas: LinhaDeDespesaForm[];
  diarias: LinhaDeDiariaForm[];
  dadosTransferencia: string;

  sstAplicavel: boolean;
  sstApr: boolean;
  sstPt: boolean;
  sstDds: boolean;
  sstTreinamento: boolean;
  sstAso: boolean;
  sstEpi: boolean;
  sstResponsavel: string;
  sstObservacao: string;
  epis: LinhaDeEpiForm[];

  previstoVeiculo: string;
  previstoHospedagem: string;
  previstoAlimentacao: string;
  previstoOutros: string;
  realVeiculo: string;
  realHospedagem: string;
  realAlimentacao: string;
  realOutros: string;
  /**
   * SOMENTE LEITURA. O custo das avarias deste campo é calculado pelo banco
   * a partir de `solicitacao_avarias` e entra no real_total — está aqui
   * porque a prévia do previsto × real tem de dizer o MESMO que a coluna
   * vai dizer depois de salvar. Deixá-lo fora faria a prévia mostrar um
   * total menor e um desvio que não é o desvio.
   *
   * Nunca é enviado em `montarCorpo`: o banco recusa a escrita direta.
   */
  realAvaria: number;
}

/** Chave estável para o `key` do React. Índice não serve: remover a linha
 *  do meio faria o React reaproveitar o estado do campo errado. */
let contador = 0;
export function novaChave(): string {
  contador += 1;
  return `l${contador}`;
}

export function formularioVazio(): EstadoDoFormulario {
  return {
    tipo: "Administrativo",
    setor: "",
    projetoId: "",
    dataRecurso: "",
    clienteProjeto: "",
    escopo: "",
    codigoClockify: "",
    destino: "",
    periodoInicio: "",
    periodoFim: "",
    observacao: "",

    equipe: [linhaDeEquipeVazia()],

    veiculoNecessario: false,
    transporteModalidade: "",
    transporteLocadora: "",
    transporteLocadoraOutra: "",
    transporteContrato: "",
    transportePlaca: "",
    condutor: "",
    condutorCpf: "",
    veiculoDescricao: "",
    localRetirada: "",
    dataRetirada: "",
    horaRetirada: "",
    localEntrega: "",
    dataEntrega: "",
    horaEntrega: "",

    hospedagemNecessaria: false,
    hospedagens: [],
    equipamentos: [],

    despesas: [],
    diarias: [],
    dadosTransferencia: "",

    // SST começa LIGADO: campo que exige segurança é a regra, e a exceção
    // é que precisa ser declarada. O contrário faria a conferência
    // depender de alguém lembrar de ligá-la.
    sstAplicavel: true,
    sstApr: false,
    sstPt: false,
    sstDds: false,
    sstTreinamento: false,
    sstAso: false,
    sstEpi: false,
    sstResponsavel: "",
    sstObservacao: "",
    epis: [],

    previstoVeiculo: "",
    previstoHospedagem: "",
    previstoAlimentacao: "",
    previstoOutros: "",
    realVeiculo: "",
    realHospedagem: "",
    realAlimentacao: "",
    realOutros: "",
    // Campo novo não tem avaria: ela só existe depois de o material sair.
    realAvaria: 0,
  };
}

export function linhaDeEquipeVazia(): LinhaDeEquipeForm {
  return {
    chave: novaChave(),
    colaborador: "",
    funcao: "",
    vinculo: "Seteg",
    telefone: "",
    lider: false,
  };
}

export function linhaDeHospedagemVazia(): LinhaDeHospedagemForm {
  return {
    chave: novaChave(),
    cidade: "",
    hospedes: "",
    hotelId: "",
    entrada: "",
    saida: "",
    diaria: "",
  };
}

export function linhaDeEquipamentoVazia(): LinhaDeEquipamentoForm {
  return { chave: novaChave(), itemId: "", quantidade: "1" };
}

export function linhaDeDespesaVazia(grupo: GrupoDespesa): LinhaDeDespesaForm {
  return { chave: novaChave(), grupo, descricao: "", valor: "" };
}

export function linhaDeDiariaVazia(tipoDiaria: string): LinhaDeDiariaForm {
  return {
    chave: novaChave(),
    colaborador: "",
    vinculo: "Seteg",
    tipoDiaria,
    dias: "1",
    valor: "",
    dadosBancarios: "",
  };
}

export function linhaDeEpiVazia(): LinhaDeEpiForm {
  return { chave: novaChave(), epi: "", quantidade: "1", ca: "", conferido: false };
}

/**
 * Carrega o formulário a partir de uma solicitação existente.
 *
 * Só os equipamentos AINDA NÃO ENTREGUES entram: os que já saíram estão
 * fisicamente com a equipe e não são editáveis — a linha deles é a
 * obrigação de devolver, e a tela avisa quantos ficaram de fora.
 */
export function formularioDeSolicitacao(s: SolicitacaoDeLista): EstadoDoFormulario {
  return {
    ...formularioVazio(),
    tipo: s.tipo,
    setor: s.setor,
    projetoId: s.projeto_id ?? "",
    dataRecurso: dataISOparaBR(s.data_recurso),
    clienteProjeto: s.cliente_projeto,
    escopo: s.escopo ?? "",
    codigoClockify: s.codigo_clockify ?? "",
    destino: s.destino ?? "",
    periodoInicio: dataISOparaBR(s.periodo_inicio),
    periodoFim: dataISOparaBR(s.periodo_fim),
    observacao: s.observacao ?? "",

    equipe: s.equipe.length
      ? s.equipe.map((e) => ({
          chave: novaChave(),
          colaborador: e.colaborador,
          funcao: e.funcao ?? "",
          vinculo: e.vinculo,
          telefone: e.telefone ?? "",
          lider: e.lider,
        }))
      : [linhaDeEquipeVazia()],

    veiculoNecessario: s.veiculo_necessario,
    transporteModalidade: s.transporte_modalidade ?? "",
    transporteLocadora: s.transporte_locadora ?? "",
    transporteLocadoraOutra: s.transporte_locadora_outra ?? "",
    transporteContrato: s.transporte_contrato ?? "",
    transportePlaca: s.transporte_placa ?? "",
    condutor: s.veiculo_condutor ?? "",
    condutorCpf: s.veiculo_cpf ?? "",
    veiculoDescricao: s.veiculo_descricao ?? "",
    localRetirada: s.veiculo_local_retirada ?? "",
    dataRetirada: dataISOparaBR(s.veiculo_data_retirada),
    horaRetirada: s.veiculo_hora_retirada ?? "",
    localEntrega: s.veiculo_local_entrega ?? "",
    dataEntrega: dataISOparaBR(s.veiculo_data_entrega),
    horaEntrega: s.veiculo_hora_entrega ?? "",

    hospedagemNecessaria: s.hospedagem_necessaria,
    hospedagens: s.hospedagens.map((h) => ({
      chave: novaChave(),
      cidade: h.cidade,
      hospedes: h.hospedes ?? "",
      hotelId: h.hotel_id ?? "",
      entrada: dataISOparaBR(h.entrada),
      saida: dataISOparaBR(h.saida),
      diaria: formatarNumeroBR(h.diaria_real ?? h.diaria_prevista),
    })),

    equipamentos: s.equipamentos
      .filter((e) => !e.entregue && e.item_id)
      .map((e) => ({ chave: novaChave(), itemId: e.item_id ?? "", quantidade: String(e.quantidade) })),

    despesas: s.despesas.map((d) => ({
      chave: novaChave(),
      grupo: d.grupo,
      descricao: d.descricao ?? "",
      valor: formatarNumeroBR(d.valor),
    })),

    diarias: s.diarias.map((d) => ({
      chave: novaChave(),
      colaborador: d.colaborador,
      vinculo: d.vinculo,
      tipoDiaria: d.tipo_diaria,
      dias: String(d.dias),
      valor: formatarNumeroBR(d.valor_unitario),
      dadosBancarios: d.dados_bancarios ?? "",
    })),
    dadosTransferencia: s.dados_transferencia ?? "",

    sstAplicavel: s.sst_aplicavel,
    sstApr: s.sst_apr_emitida,
    sstPt: s.sst_pt_emitida,
    sstDds: s.sst_dds_realizado,
    sstTreinamento: s.sst_treinamento_conferido,
    sstAso: s.sst_aso_conferido,
    sstEpi: s.sst_epi_conferido,
    sstResponsavel: s.sst_responsavel ?? "",
    sstObservacao: s.sst_observacao ?? "",
    epis: s.epis.map((e) => ({
      chave: novaChave(),
      epi: e.epi,
      quantidade: String(e.quantidade),
      ca: e.ca ?? "",
      conferido: e.conferido,
    })),

    previstoVeiculo: formatarNumeroBR(s.previsto_veiculo),
    previstoHospedagem: formatarNumeroBR(s.previsto_hospedagem),
    previstoAlimentacao: formatarNumeroBR(s.previsto_alimentacao),
    previstoOutros: formatarNumeroBR(s.previsto_outros),
    realVeiculo: formatarNumeroBR(s.real_veiculo),
    realHospedagem: formatarNumeroBR(s.real_hospedagem),
    realAlimentacao: formatarNumeroBR(s.real_alimentacao),
    realOutros: formatarNumeroBR(s.real_outros),
    realAvaria: Number(s.real_avaria) || 0,
  };
}

/**
 * Converte o estado da tela no corpo que a rota espera: datas em ISO,
 * dinheiro em número, linhas em branco descartadas.
 *
 * Descartar linha vazia aqui, e não obrigar quem preenche a apagá-la, é
 * herdado da versão anterior: os blocos abrem com uma linha em branco, e
 * enviá-la faria a validação reclamar de algo que ninguém tentou
 * preencher.
 */
export function montarCorpo(f: EstadoDoFormulario): Record<string, unknown> {
  const administrativo = f.tipo === "Administrativo";
  const comVeiculo = administrativo && f.veiculoNecessario;
  const comHospedagem = administrativo && f.hospedagemNecessaria;
  // SST só existe no pedido administrativo: é ele que tira gente do
  // escritório. Pedido financeiro é prestação de contas.
  const comSst = administrativo && f.sstAplicavel;

  return {
    tipo: f.tipo,
    setor: f.setor,
    projeto_id: f.projetoId,
    data_recurso: dataBRparaISO(f.dataRecurso) || null,
    cliente_projeto: f.clienteProjeto,
    escopo: f.escopo.trim() || null,
    codigo_clockify: f.codigoClockify,
    destino: f.destino,
    periodo_inicio: dataBRparaISO(f.periodoInicio),
    periodo_fim: dataBRparaISO(f.periodoFim),
    observacao: f.observacao || null,

    veiculo_necessario: comVeiculo,
    veiculo_condutor: comVeiculo ? f.condutor : null,
    veiculo_cpf: comVeiculo ? f.condutorCpf : null,
    veiculo_descricao: comVeiculo ? f.veiculoDescricao : null,
    veiculo_local_retirada: comVeiculo ? f.localRetirada : null,
    veiculo_data_retirada: comVeiculo ? dataBRparaISO(f.dataRetirada) : null,
    veiculo_hora_retirada: comVeiculo ? f.horaRetirada : null,
    veiculo_local_entrega: comVeiculo ? f.localEntrega : null,
    veiculo_data_entrega: comVeiculo ? dataBRparaISO(f.dataEntrega) : null,
    veiculo_hora_entrega: comVeiculo ? f.horaEntrega : null,
    transporte_modalidade: comVeiculo ? f.transporteModalidade : null,
    transporte_locadora: comVeiculo ? f.transporteLocadora || null : null,
    transporte_locadora_outra:
      comVeiculo && f.transporteLocadora === "Outros" ? f.transporteLocadoraOutra : null,
    transporte_contrato: comVeiculo ? f.transporteContrato || null : null,
    transporte_placa: comVeiculo ? f.transportePlaca || null : null,

    hospedagem_necessaria: comHospedagem,
    dados_transferencia: administrativo ? null : f.dadosTransferencia || null,

    previsto_veiculo: parseMoeda(f.previstoVeiculo),
    previsto_hospedagem: parseMoeda(f.previstoHospedagem),
    previsto_alimentacao: parseMoeda(f.previstoAlimentacao),
    previsto_outros: parseMoeda(f.previstoOutros),
    real_veiculo: parseMoeda(f.realVeiculo),
    real_hospedagem: parseMoeda(f.realHospedagem),
    real_alimentacao: parseMoeda(f.realAlimentacao),
    real_outros: parseMoeda(f.realOutros),

    // ── SST É DO ADMINISTRATIVO ──
    // O formulário financeiro não pergunta SST (a seção não é montada), e o
    // padrão do estado é `sstAplicavel: true`. Sem este `comSst`, todo
    // pedido financeiro seria gravado como "SST se aplica" sem nenhum EPI —
    // e apareceria no Painel contando como campo com segurança conferida.
    // Um número errado é pior do que número nenhum.
    sst_aplicavel: comSst,
    sst_apr_emitida: comSst && f.sstApr,
    sst_pt_emitida: comSst && f.sstPt,
    sst_dds_realizado: comSst && f.sstDds,
    sst_treinamento_conferido: comSst && f.sstTreinamento,
    sst_aso_conferido: comSst && f.sstAso,
    sst_epi_conferido: comSst && f.sstEpi,
    sst_responsavel: comSst ? f.sstResponsavel : null,
    sst_observacao: comSst ? f.sstObservacao || null : null,

    equipe: f.equipe
      .filter((e) => e.colaborador.trim())
      .map((e) => ({
        colaborador: e.colaborador,
        funcao: e.funcao || null,
        vinculo: e.vinculo,
        telefone: e.telefone || null,
        lider: e.lider,
      })),

    epis: comSst
      ? f.epis
          .filter((e) => e.epi.trim())
          .map((e) => ({
            epi: e.epi,
            quantidade: Number(e.quantidade) || 1,
            ca: e.ca || null,
            conferido: e.conferido,
          }))
      : [],

    equipamentos: administrativo
      ? f.equipamentos
          .filter((e) => e.itemId)
          .map((e) => ({ item_id: e.itemId, quantidade: Number(e.quantidade) || 1 }))
      : [],

    hospedagens: comHospedagem
      ? f.hospedagens
          .filter((h) => h.cidade.trim())
          .map((h) => ({
            cidade: h.cidade,
            hospedes: h.hospedes.trim() || null,
            hotel_id: h.hotelId || null,
            entrada: dataBRparaISO(h.entrada) || null,
            saida: dataBRparaISO(h.saida) || null,
            dias: noitesDaLinha(h),
            diaria_prevista: parseMoeda(h.diaria),
          }))
      : [],

    despesas: administrativo
      ? []
      : f.despesas
          .filter((d) => d.descricao.trim() || parseMoeda(d.valor))
          .map((d) => ({ grupo: d.grupo, descricao: d.descricao, valor: parseMoeda(d.valor) })),

    diarias: administrativo
      ? []
      : f.diarias
          .filter((d) => d.colaborador.trim())
          .map((d) => ({
            colaborador: d.colaborador,
            vinculo: d.vinculo,
            tipo_diaria: d.tipoDiaria,
            dias: Number(d.dias) || 0,
            valor_unitario: parseMoeda(d.valor),
            dados_bancarios: d.dadosBancarios || null,
          })),
  };
}

/** Diárias de hotel: NOITES, não dias. Entrar e sair no mesmo dia é zero
 *  diária — é a conta que o hotel faz. */
export function noitesDaLinha(h: LinhaDeHospedagemForm): number {
  const entrada = dataBRparaISO(h.entrada);
  const saida = dataBRparaISO(h.saida);
  if (!entrada || !saida) return 0;
  const a = new Date(`${entrada}T00:00:00.000Z`).getTime();
  const b = new Date(`${saida}T00:00:00.000Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

// ─── Sugestão de previsto ────────────────────────────────────────────────

export interface SugestaoDePrevisto {
  veiculo: number;
  hospedagem: number;
  alimentacao: number;
  dias: number;
  equipe: number;
  temPernoite: boolean;
  referenciaDaDiaria: number;
}

/**
 * O que a tela sugere de previsto para ESTE campo.
 *
 * ── O QUE MUDOU NA v3 ──
 *
 * O gasto previsto do projeto deixou de ser TRÊS VALORES POR DIA (veículo,
 * hotel, alimentação) e passou a ser uma lista de categorias com o valor
 * TOTAL do projeto. Valor total de contrato não se divide por dia de campo:
 * "R$ 40.000 de aluguel de veículo no projeto" não diz quanto custa a
 * diária desta viagem de quatro dias.
 *
 * Então a sugestão passou a sair do que a PRÓPRIA TELA já sabe:
 *
 *   · hospedagem — das linhas de hospedagem, que trazem a diária do hotel
 *     escolhido (é o dado mais específico que existe: um valor combinado
 *     com aquele hotel, não uma média);
 *   · alimentação — do valor de referência da diária × dias × equipe,
 *     com pernoite ou sem, que é a regra que a empresa já usa;
 *   · veículo — não há mais de onde sugerir, e vai zerado. Quem preenche o
 *     formulário informa, como já informava o real.
 *
 * SUGESTÃO, não imposição: quem confirma é quem clica no botão.
 */
export function sugerirPrevisto(
  f: EstadoDoFormulario,
  projetos: readonly Projeto[],
  diariasCadastradas: readonly DiariaValor[]
): SugestaoDePrevisto | null {
  const dias = diasDeCampo(dataBRparaISO(f.periodoInicio), dataBRparaISO(f.periodoFim));
  if (!dias) return null;

  void projetos;
  const equipe = f.equipe.filter((e) => e.colaborador.trim()).length || 1;

  // Hospedagem: soma o que as LINHAS já dizem — hotel escolhido tem diária
  // combinada. Sem linha de hospedagem não há o que sugerir.
  const linhas = f.hospedagens.filter((h) => h.cidade.trim());
  const hospedagem = linhas.reduce((t, h) => t + noitesDaLinha(h) * parseMoeda(h.diaria), 0);

  // Alimentação: o valor de referência da diária — COM pernoite se o campo
  // tem hospedagem, SEM se não tem. É essa a diferença entre R$ 55,00 e
  // R$ 35,00.
  const temPernoite = linhas.length > 0 || f.hospedagemNecessaria;
  const referencia = referenciaDaDiaria(diariasCadastradas, temPernoite);

  return {
    veiculo: 0,
    hospedagem,
    alimentacao: referencia * dias * equipe,
    dias,
    equipe,
    temPernoite,
    referenciaDaDiaria: referencia,
  };
}
