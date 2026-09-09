// ═══════════════════════════════════════════════════════════════════════
//  VALIDAÇÃO DA SOLICITAÇÃO — compartilhada entre POST e PATCH.
//
//  Módulo puro de servidor (sem "use client"), importado só por route
//  handlers. É o equivalente ao `camposObrigatoriosVazios()` da versão
//  anterior, com uma diferença que não é de estilo:
//
//    ANTES  a validação morava no navegador e lia o DOM. Quem chamasse a
//           API do Supabase direto — e a chave publishable estava à vista,
//           então qualquer um podia — passava por cima dela inteira. O que
//           sobrava era o que o banco checasse por conta própria.
//    AGORA  o navegador não fala com o banco. A única porta é esta, e ela
//           valida antes de deixar passar.
//
//  Continua NÃO sendo a última palavra: o banco tem as suas restrições
//  (`solicitacoes_veiculo_check`, `solicitacoes_periodo_check`,
//  `solicitacao_equipe_um_lider`, a reserva que confere saldo) e elas
//  continuam valendo. A diferença é que aqui o erro sai como uma frase
//  que diz o que preencher, em vez de um nome de constraint.
// ═══════════════════════════════════════════════════════════════════════

import {
  GRUPOS_DESPESA,
  LOCADORAS,
  TIPOS_SOLICITACAO,
  VINCULOS,
  type GrupoDespesa,
  type Locadora,
  type Projeto,
  type TipoSolicitacao,
  type Vinculo,
} from "@/lib/tipos";
// Os leitores de corpo vivem em lib/validacao.ts e são os mesmos de toda
// rota: um lugar só decide o que é texto válido, data válida e dinheiro
// válido neste sistema.
import {
  MAX_LINHAS,
  TEXTO_LONGO,
  booleano,
  daLista,
  data,
  dataOpcional,
  dinheiro,
  horaOpcional,
  inteiroNaoNegativo,
  inteiroPositivo,
  lista,
  maiusculas,
  texto,
  textoOpcional,
  uuid,
} from "@/lib/validacao";

function erro(mensagem: string): ResultadoValidacao {
  return { ok: false, erro: mensagem };
}

// ─── O corpo que a tela envia ────────────────────────────────────────────

export interface LinhaDeEquipe {
  colaborador: string;
  funcao: string | null;
  vinculo: Vinculo;
  codigo_clockify: string | null;
  telefone: string | null;
  lider: boolean;
}

export interface LinhaDeHospedagem {
  cidade: string;
  /** Quem dorme nesta cidade. Opcional: nem sempre se sabe na abertura. */
  hospedes: string | null;
  hotel_id: string | null;
  entrada: string | null;
  saida: string | null;
  dias: number | null;
  diaria_prevista: number;
}

export interface LinhaDeEquipamento {
  item_id: string;
  quantidade: number;
}

export interface LinhaDeDespesa {
  grupo: GrupoDespesa;
  descricao: string;
  valor: number;
}

export interface LinhaDeDiaria {
  colaborador: string;
  vinculo: Vinculo;
  tipo_diaria: string;
  dias: number;
  valor_unitario: number;
  dados_bancarios: string | null;
}

export interface LinhaDeEpi {
  epi: string;
  quantidade: number;
  ca: string | null;
  conferido: boolean;
}

/** O que a tela manda. Tudo já em formato de banco: data em ISO, dinheiro
 *  em número — a conversão de "31/12/2026" e "1.234,56" é do cliente, que
 *  é quem tem as máscaras. */
export interface CorpoDeSolicitacao {
  tipo: TipoSolicitacao;
  setor: string;
  projeto_id: string;
  data_recurso: string | null;
  cliente_projeto: string;
  /** O programa deste campo, entre os de `projetos.escopo`. Opcional:
   *  projeto sem programa cadastrado não tem o que escolher. */
  escopo: string | null;
  codigo_clockify: string;
  destino: string;
  periodo_inicio: string;
  periodo_fim: string;
  observacao: string | null;

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

  transporte_modalidade: string | null;
  transporte_locadora: Locadora | null;
  transporte_locadora_outra: string | null;
  transporte_contrato: string | null;
  transporte_placa: string | null;

  hospedagem_necessaria: boolean;
  dados_transferencia: string | null;

  previsto_veiculo: number;
  previsto_hospedagem: number;
  previsto_alimentacao: number;
  previsto_outros: number;
  real_veiculo: number;
  real_hospedagem: number;
  real_alimentacao: number;
  real_outros: number;

  sst_aplicavel: boolean;
  sst_apr_emitida: boolean;
  sst_pt_emitida: boolean;
  sst_dds_realizado: boolean;
  sst_treinamento_conferido: boolean;
  sst_aso_conferido: boolean;
  sst_epi_conferido: boolean;
  sst_responsavel: string | null;
  sst_observacao: string | null;

  equipe: LinhaDeEquipe[];
  epis: LinhaDeEpi[];
  equipamentos: LinhaDeEquipamento[];
  hospedagens: LinhaDeHospedagem[];
  despesas: LinhaDeDespesa[];
  diarias: LinhaDeDiaria[];
}

export type ResultadoValidacao =
  | { ok: true; dados: CorpoDeSolicitacao }
  | { ok: false; erro: string };

// ─── A validação ─────────────────────────────────────────────────────────

/**
 * @param corpo     corpo cru da requisição
 * @param projetos  cadastro de projetos, para conferir que o escolhido
 *                  existe, está Ativo e TEM LÍDER — sem líder não há quem
 *                  aprove, e o banco recusa o pedido de qualquer forma.
 * @param pedidoNovo `true` no POST, `false` na edição. A exigência de o
 *                  projeto estar ATIVO vale só para pedido novo: campo que
 *                  já está em andamento não pode ficar impossível de
 *                  corrigir porque a Direção pôs o projeto em Stand By no
 *                  meio do caminho. É a mesma divisão que o banco faz — a
 *                  trava de situação está no INSERT.
 */
export function validarSolicitacao(
  corpo: unknown,
  projetos: readonly Projeto[],
  pedidoNovo = true
): ResultadoValidacao {
  if (typeof corpo !== "object" || corpo === null) return erro("Corpo da requisição inválido.");
  const c = corpo as Record<string, unknown>;

  const tipo = daLista(c.tipo, TIPOS_SOLICITACAO);
  if (!tipo) return erro("Escolha o tipo de recurso: Administrativo ou Financeiro.");

  const setor = texto(c.setor);
  if (!setor) return erro("Informe o setor.");

  // ── O PROJETO É O QUE DIZ QUEM APROVA ──
  // Sem projeto não há líder, e sem líder não há aprovação. É obrigatório
  // aqui e no banco; recusar cedo é o que permite explicar por quê.
  const projetoId = uuid(c.projeto_id);
  if (!projetoId) return erro("Escolha o projeto — é ele que define quem aprova esta solicitação.");
  const projeto = projetos.find((p) => p.id === projetoId);
  if (!projeto) return erro("O projeto escolhido não existe mais. Recarregue a tela e escolha outro.");
  if (pedidoNovo && projeto.situacao !== "Ativo") {
    return erro(
      `O projeto ${projeto.cliente} | ${projeto.nome} está ${projeto.situacao} — só projeto Ativo aceita solicitação nova.`
    );
  }
  if (!projeto.lider_id) {
    return erro(
      `O projeto ${projeto.cliente} | ${projeto.nome} não tem líder cadastrado. A Direção precisa definir quem aprova antes de abrir campo nele.`
    );
  }

  const dataRecurso = dataOpcional(c.data_recurso);
  if (dataRecurso === false) return erro("Data para receber o recurso inválida.");

  const clienteProjeto = texto(c.cliente_projeto);
  if (!clienteProjeto) return erro("Informe Cliente | Projeto.");

  // O PROGRAMA do campo. Nao e obrigatorio aqui: projeto sem programa
  // cadastrado nao tem o que oferecer, e travar o pedido por isso puniria
  // quem pede por um cadastro que nao e dele. Quem cobra a escolha, quando
  // ha o que escolher, e a tela.
  const escopo = texto(c.escopo, 120);

  const codigoClockify = texto(c.codigo_clockify, 60);
  if (!codigoClockify) return erro("Informe o código Clockify.");

  const destino = texto(c.destino);
  if (!destino) return erro("Informe o destino.");

  const inicio = data(c.periodo_inicio);
  const fim = data(c.periodo_fim);
  if (!inicio || !fim) return erro("Informe o período do campo (início e fim).");
  if (fim < inicio) return erro("O fim do período não pode ser antes do início.");

  const observacao = textoOpcional(c.observacao, TEXTO_LONGO);
  if (observacao === false) return erro(`A observação deve ter no máximo ${TEXTO_LONGO} caracteres.`);

  // ── Equipe ──
  // É o que o calendário mostra e de onde sai o previsto de alimentação.
  // Pedido de campo sem ninguém indo a campo não existe.
  const equipeCrua = lista(c.equipe);
  if (!equipeCrua) return erro(`A equipe deve ser uma lista de no máximo ${MAX_LINHAS} pessoas.`);
  const equipe: LinhaDeEquipe[] = [];
  for (const linha of equipeCrua) {
    const validada = validarEquipe(linha);
    if (typeof validada === "string") return erro(validada);
    equipe.push(validada);
  }
  if (!equipe.length) return erro("Informe ao menos uma pessoa na equipe.");
  if (!equipe.some((e) => e.lider)) return erro("Marque quem é o líder da equipe.");
  if (equipe.filter((e) => e.lider).length > 1) return erro("Só uma pessoa pode ser líder da equipe.");

  // Nome repetido travaria o insert na chave única, e o erro do banco não
  // diria qual nome. Melhor dizer aqui.
  const nomes = equipe.map((e) => e.colaborador);
  const repetido = nomes.find((n, i) => nomes.indexOf(n) !== i);
  if (repetido) return erro(`A mesma pessoa aparece duas vezes na equipe (${repetido}).`);

  // ── SST ──
  //
  // Desde a v3 é UMA marca: se aplica ou não se aplica. As seis
  // conferências e o responsável saíram da tela, então o responsável
  // deixou de ser exigido — cobrar aqui um campo que ninguém tem como
  // preencher travaria toda solicitação com SST. O que chegar continua
  // sendo aceito e gravado (edição de pedido antigo, que já tem o nome).
  const sstAplicavel = booleano(c.sst_aplicavel);
  const sstResponsavel = sstAplicavel ? texto(c.sst_responsavel) : null;
  const sstObservacao = textoOpcional(c.sst_observacao, TEXTO_LONGO);
  if (sstObservacao === false) return erro("Observação de SST acima do tamanho permitido.");

  const episCrus = lista(c.epis);
  if (!episCrus) return erro(`A lista de EPIs deve ter no máximo ${MAX_LINHAS} linhas.`);
  const epis: LinhaDeEpi[] = [];
  if (sstAplicavel) {
    for (const linha of episCrus) {
      const validada = validarEpi(linha);
      if (typeof validada === "string") return erro(validada);
      epis.push(validada);
    }
    const nomesEpi = epis.map((e) => e.epi);
    const epiRepetido = nomesEpi.find((n, i) => nomesEpi.indexOf(n) !== i);
    if (epiRepetido) return erro(`O mesmo EPI aparece duas vezes na lista (${epiRepetido}).`);
  }

  // ── Previsto × real ──
  // Os TOTAIS, o desvio e o status de curso não são lidos daqui: o banco
  // os calcula por trigger. Só as oito parcelas vêm da tela.
  const valores = {
    previsto_veiculo: dinheiro(c.previsto_veiculo),
    previsto_hospedagem: dinheiro(c.previsto_hospedagem),
    previsto_alimentacao: dinheiro(c.previsto_alimentacao),
    previsto_outros: dinheiro(c.previsto_outros),
    real_veiculo: dinheiro(c.real_veiculo),
    real_hospedagem: dinheiro(c.real_hospedagem),
    real_alimentacao: dinheiro(c.real_alimentacao),
    real_outros: dinheiro(c.real_outros),
  };
  for (const [campo, valor] of Object.entries(valores)) {
    if (valor === null) return erro(`Valor inválido em ${campo.replace(/_/g, " ")}.`);
  }

  const administrativo = tipo === "Administrativo";

  // ── Bloco administrativo ──
  const veiculo = administrativo && booleano(c.veiculo_necessario);
  let dadosVeiculo = veiculoVazio();
  if (veiculo) {
    const validado = validarVeiculo(c);
    if (typeof validado === "string") return erro(validado);
    dadosVeiculo = validado;
  }

  const hospedagemNecessaria = administrativo && booleano(c.hospedagem_necessaria);
  const hospedagensCruas = lista(c.hospedagens);
  if (!hospedagensCruas) return erro(`A hospedagem deve ter no máximo ${MAX_LINHAS} cidades.`);
  const hospedagens: LinhaDeHospedagem[] = [];
  if (hospedagemNecessaria) {
    for (const linha of hospedagensCruas) {
      const validada = validarHospedagem(linha);
      if (typeof validada === "string") return erro(validada);
      hospedagens.push(validada);
    }
    if (!hospedagens.length) return erro("Informe ao menos uma cidade de hospedagem.");
  }

  const equipamentosCrus = lista(c.equipamentos);
  if (!equipamentosCrus) return erro(`O pedido deve ter no máximo ${MAX_LINHAS} equipamentos.`);
  const equipamentos: LinhaDeEquipamento[] = [];
  if (administrativo) {
    for (const linha of equipamentosCrus) {
      const validada = validarEquipamento(linha);
      if (typeof validada === "string") return erro(validada);
      equipamentos.push(validada);
    }
    // Mesmo item em duas linhas soma no banco, mas confunde na tela — e o
    // "disponível" da linha passaria a mentir sobre o total pedido.
    const itens = equipamentos.map((e) => e.item_id);
    if (itens.some((i, pos) => itens.indexOf(i) !== pos)) {
      return erro("O mesmo equipamento aparece em duas linhas. Some a quantidade numa linha só.");
    }
    // Um pedido administrativo sem nada em nenhum dos três blocos não é
    // pedido de nada.
    if (!equipamentos.length && !veiculo && !hospedagemNecessaria) {
      return erro("Um pedido administrativo precisa de veículo, hospedagem ou equipamento.");
    }
  }

  // ── Bloco financeiro ──
  const despesasCruas = lista(c.despesas);
  const diariasCruas = lista(c.diarias);
  if (!despesasCruas || !diariasCruas) {
    return erro(`Despesas e diárias devem ter no máximo ${MAX_LINHAS} linhas cada.`);
  }
  const despesas: LinhaDeDespesa[] = [];
  const diarias: LinhaDeDiaria[] = [];
  let dadosTransferencia: string | null = null;

  if (!administrativo) {
    for (const linha of despesasCruas) {
      const validada = validarDespesa(linha);
      if (typeof validada === "string") return erro(validada);
      despesas.push(validada);
    }
    for (const linha of diariasCruas) {
      const validada = validarDiaria(linha);
      if (typeof validada === "string") return erro(validada);
      diarias.push(validada);
    }
    if (!despesas.length && !diarias.length) {
      return erro("Um pedido financeiro precisa de ao menos uma despesa ou uma diária.");
    }
    const transferencia = textoOpcional(c.dados_transferencia, TEXTO_LONGO);
    if (transferencia === false) return erro("Dados da transferência acima do tamanho permitido.");
    if (despesas.length && !transferencia) {
      return erro("Informe os dados da transferência.");
    }
    dadosTransferencia = transferencia;
  }

  return {
    ok: true,
    dados: {
      tipo,
      setor,
      projeto_id: projetoId,
      data_recurso: dataRecurso,
      cliente_projeto: maiusculas(clienteProjeto),
      escopo: escopo ? maiusculas(escopo) : null,
      codigo_clockify: codigoClockify,
      destino: maiusculas(destino),
      periodo_inicio: inicio,
      periodo_fim: fim,
      observacao,

      veiculo_necessario: veiculo,
      ...dadosVeiculo,

      hospedagem_necessaria: hospedagemNecessaria,
      dados_transferencia: dadosTransferencia,

      previsto_veiculo: valores.previsto_veiculo ?? 0,
      previsto_hospedagem: valores.previsto_hospedagem ?? 0,
      previsto_alimentacao: valores.previsto_alimentacao ?? 0,
      previsto_outros: valores.previsto_outros ?? 0,
      real_veiculo: valores.real_veiculo ?? 0,
      real_hospedagem: valores.real_hospedagem ?? 0,
      real_alimentacao: valores.real_alimentacao ?? 0,
      real_outros: valores.real_outros ?? 0,

      sst_aplicavel: sstAplicavel,
      sst_apr_emitida: sstAplicavel && booleano(c.sst_apr_emitida),
      sst_pt_emitida: sstAplicavel && booleano(c.sst_pt_emitida),
      sst_dds_realizado: sstAplicavel && booleano(c.sst_dds_realizado),
      sst_treinamento_conferido: sstAplicavel && booleano(c.sst_treinamento_conferido),
      sst_aso_conferido: sstAplicavel && booleano(c.sst_aso_conferido),
      sst_epi_conferido: sstAplicavel && booleano(c.sst_epi_conferido),
      sst_responsavel: sstResponsavel ? maiusculas(sstResponsavel) : null,
      sst_observacao: sstObservacao,

      equipe,
      epis,
      equipamentos,
      hospedagens,
      despesas,
      diarias,
    },
  };
}

// ─── Validadores de linha ────────────────────────────────────────────────
//
// Cada um devolve a linha pronta ou a MENSAGEM do problema (uma string).
// É um `Either` pobre, mas evita inventar tipo novo para cada linha e
// mantém a mensagem colada na regra que a produziu.

type Validada<T> = T | string;

function validarEquipe(linha: unknown): Validada<LinhaDeEquipe> {
  if (typeof linha !== "object" || linha === null) return "Linha de equipe inválida.";
  const l = linha as Record<string, unknown>;

  const colaborador = texto(l.colaborador);
  if (!colaborador) return "Informe o nome de cada pessoa da equipe.";

  const vinculo = daLista(l.vinculo, VINCULOS);
  if (!vinculo) return `Vínculo inválido para ${colaborador}. Use "Seteg" ou "Temporário".`;

  const funcao = textoOpcional(l.funcao);
  if (funcao === false) return `Função acima do tamanho permitido (${colaborador}).`;
  const codigo = textoOpcional(l.codigo_clockify, 60);
  if (codigo === false) return `Código Clockify inválido (${colaborador}).`;
  const telefone = textoOpcional(l.telefone, 40);
  if (telefone === false) return `Telefone inválido (${colaborador}).`;

  return {
    colaborador: maiusculas(colaborador),
    funcao: funcao ? maiusculas(funcao) : null,
    vinculo,
    codigo_clockify: codigo,
    telefone,
    lider: booleano(l.lider),
  };
}

function validarEpi(linha: unknown): Validada<LinhaDeEpi> {
  if (typeof linha !== "object" || linha === null) return "Linha de EPI inválida.";
  const l = linha as Record<string, unknown>;

  const epi = texto(l.epi);
  if (!epi) return "Informe o nome de cada EPI.";

  const quantidade = inteiroPositivo(l.quantidade);
  if (!quantidade) return `Quantidade inválida no EPI ${epi}.`;

  const ca = textoOpcional(l.ca, 40);
  if (ca === false) return `CA inválido no EPI ${epi}.`;

  return { epi: maiusculas(epi), quantidade, ca, conferido: booleano(l.conferido) };
}

function validarEquipamento(linha: unknown): Validada<LinhaDeEquipamento> {
  if (typeof linha !== "object" || linha === null) return "Linha de equipamento inválida.";
  const l = linha as Record<string, unknown>;

  // Só item do catálogo: a coluna `descricao` (texto livre) existe no banco
  // para o que ainda não foi cadastrado, mas a tela não a usa — sem
  // `item_id` não há o que reservar, e o pedido nasceria sem garantia
  // nenhuma de que o material existe.
  const itemId = uuid(l.item_id);
  if (!itemId) return "Escolha o equipamento no catálogo do estoque.";

  const quantidade = inteiroPositivo(l.quantidade);
  if (!quantidade) return "Quantidade de equipamento inválida.";

  return { item_id: itemId, quantidade };
}

function validarHospedagem(linha: unknown): Validada<LinhaDeHospedagem> {
  if (typeof linha !== "object" || linha === null) return "Linha de hospedagem inválida.";
  const l = linha as Record<string, unknown>;

  const cidade = texto(l.cidade);
  if (!cidade) return "Informe a cidade de cada hospedagem.";

  const hotelId = l.hotel_id === null || l.hotel_id === undefined || l.hotel_id === "" ? null : uuid(l.hotel_id);
  if (l.hotel_id && !hotelId) return `Hotel inválido em ${cidade}.`;

  const entrada = dataOpcional(l.entrada);
  const saida = dataOpcional(l.saida);
  if (entrada === false || saida === false) return `Data de entrada ou saída inválida em ${cidade}.`;
  if (entrada && saida && saida < entrada) return `Em ${cidade}, a saída não pode ser antes da entrada.`;

  const dias = l.dias === null || l.dias === undefined ? null : inteiroNaoNegativo(l.dias, 366);
  if (l.dias !== null && l.dias !== undefined && dias === null) return `Número de diárias inválido em ${cidade}.`;

  const diaria = dinheiro(l.diaria_prevista ?? 0);
  if (diaria === null) return `Valor de diária inválido em ${cidade}.`;

  // Não é obrigatório: na abertura do pedido a escala pode não estar
  // fechada, e travar o salvamento por isso empurraria a pessoa a inventar
  // um nome. Fica em branco e a logística preenche depois.
  const hospedes = texto(l.hospedes);

  return {
    cidade: maiusculas(cidade),
    hospedes: hospedes ? maiusculas(hospedes) : null,
    hotel_id: hotelId,
    entrada,
    saida,
    dias,
    diaria_prevista: diaria,
  };
}

function validarDespesa(linha: unknown): Validada<LinhaDeDespesa> {
  if (typeof linha !== "object" || linha === null) return "Linha de despesa inválida.";
  const l = linha as Record<string, unknown>;

  const grupo = daLista(l.grupo, GRUPOS_DESPESA);
  if (!grupo) return "Grupo de despesa inválido.";

  const descricao = texto(l.descricao, TEXTO_LONGO);
  if (!descricao) return `Descreva cada despesa de ${grupo}.`;

  const valor = dinheiro(l.valor);
  if (valor === null) return `Valor inválido numa despesa de ${grupo}.`;

  return { grupo, descricao: maiusculas(descricao), valor };
}

function validarDiaria(linha: unknown): Validada<LinhaDeDiaria> {
  if (typeof linha !== "object" || linha === null) return "Linha de diária inválida.";
  const l = linha as Record<string, unknown>;

  const colaborador = texto(l.colaborador);
  if (!colaborador) return "Informe o colaborador de cada diária.";

  const vinculo = daLista(l.vinculo, VINCULOS);
  if (!vinculo) return `Vínculo inválido na diária de ${colaborador}.`;

  // O tipo de diária NÃO é lista fechada aqui: quem manda é a tabela
  // `diaria_valores`, que é administrada sem deploy. Fechar a lista no
  // código faria uma diária nova cadastrada no banco ser recusada por
  // esta rota.
  const tipoDiaria = texto(l.tipo_diaria);
  if (!tipoDiaria) return `Escolha o tipo de diária de ${colaborador}.`;

  const dias = inteiroPositivo(l.dias, 366);
  if (!dias) return `Informe os dias da diária de ${colaborador}.`;

  const valorUnitario = dinheiro(l.valor_unitario);
  if (valorUnitario === null || valorUnitario === 0) {
    return `Informe o valor da diária de ${colaborador}.`;
  }

  const dadosBancarios = textoOpcional(l.dados_bancarios, TEXTO_LONGO);
  if (dadosBancarios === false) return `Dados bancários acima do tamanho permitido (${colaborador}).`;

  return {
    colaborador: maiusculas(colaborador),
    vinculo,
    tipo_diaria: tipoDiaria,
    dias,
    valor_unitario: valorUnitario,
    dados_bancarios: dadosBancarios,
  };
}

type CamposDeVeiculo = Pick<
  CorpoDeSolicitacao,
  | "veiculo_condutor"
  | "veiculo_cpf"
  | "veiculo_descricao"
  | "veiculo_local_retirada"
  | "veiculo_data_retirada"
  | "veiculo_hora_retirada"
  | "veiculo_local_entrega"
  | "veiculo_data_entrega"
  | "veiculo_hora_entrega"
  | "transporte_modalidade"
  | "transporte_locadora"
  | "transporte_locadora_outra"
  | "transporte_contrato"
  | "transporte_placa"
>;

function veiculoVazio(): CamposDeVeiculo {
  return {
    veiculo_condutor: null,
    veiculo_cpf: null,
    veiculo_descricao: null,
    veiculo_local_retirada: null,
    veiculo_data_retirada: null,
    veiculo_hora_retirada: null,
    veiculo_local_entrega: null,
    veiculo_data_entrega: null,
    veiculo_hora_entrega: null,
    transporte_modalidade: null,
    transporte_locadora: null,
    transporte_locadora_outra: null,
    transporte_contrato: null,
    transporte_placa: null,
  };
}

function validarVeiculo(c: Record<string, unknown>): Validada<CamposDeVeiculo> {
  const modalidade = texto(c.transporte_modalidade, 60);
  if (!modalidade) return "Informe a modalidade do transporte.";

  // Lista FECHADA porque é sobre a locadora que se negocia contrato: em
  // texto livre, "Movida" viraria cinco grafias e o gasto por locadora não
  // somaria. O banco cobra o mesmo em solicitacoes_locadora_check.
  const locadoraCrua = c.transporte_locadora;
  const locadora =
    locadoraCrua === null || locadoraCrua === undefined || locadoraCrua === ""
      ? null
      : daLista(locadoraCrua, LOCADORAS);
  if (locadoraCrua && !locadora) return "Locadora inválida. Escolha uma da lista.";

  let locadoraOutra: string | null = null;
  if (locadora === "Outros") {
    const informada = texto(c.transporte_locadora_outra);
    if (!informada) return 'Com a locadora "Outros", diga qual é.';
    locadoraOutra = maiusculas(informada);
  }

  const condutor = texto(c.veiculo_condutor);
  if (!condutor) return "Informe o nome do condutor — é quem assume o carro.";

  const cpf = texto(c.veiculo_cpf, 20);
  if (!cpf) return "Informe o CPF do condutor.";

  const descricao = texto(c.veiculo_descricao);
  if (!descricao) return "Informe o veículo.";

  const localRetirada = texto(c.veiculo_local_retirada, TEXTO_LONGO);
  if (!localRetirada) return "Informe o local de recebimento do veículo.";
  const localEntrega = texto(c.veiculo_local_entrega, TEXTO_LONGO);
  if (!localEntrega) return "Informe o local de entrega do veículo.";

  const dataRetirada = data(c.veiculo_data_retirada);
  if (!dataRetirada) return "Informe a data de retirada do veículo.";
  const dataEntrega = data(c.veiculo_data_entrega);
  if (!dataEntrega) return "Informe a data de entrega do veículo.";
  if (dataEntrega < dataRetirada) return "A entrega do veículo não pode ser antes da retirada.";

  const horaRetirada = horaOpcional(c.veiculo_hora_retirada);
  if (horaRetirada === false) return "Horário de retirada inválido. Use HH:MM.";
  if (!horaRetirada) return "Informe o horário de retirada.";
  const horaEntrega = horaOpcional(c.veiculo_hora_entrega);
  if (horaEntrega === false) return "Horário de entrega inválido. Use HH:MM.";
  if (!horaEntrega) return "Informe o horário de entrega.";

  const contrato = textoOpcional(c.transporte_contrato, 60);
  if (contrato === false) return "Contrato/reserva acima do tamanho permitido.";
  const placa = textoOpcional(c.transporte_placa, 10);
  if (placa === false) return "Placa acima do tamanho permitido.";

  return {
    veiculo_condutor: maiusculas(condutor),
    veiculo_cpf: cpf,
    veiculo_descricao: maiusculas(descricao),
    veiculo_local_retirada: maiusculas(localRetirada),
    veiculo_data_retirada: dataRetirada,
    veiculo_hora_retirada: horaRetirada,
    veiculo_local_entrega: maiusculas(localEntrega),
    veiculo_data_entrega: dataEntrega,
    veiculo_hora_entrega: horaEntrega,
    transporte_modalidade: modalidade,
    transporte_locadora: locadora,
    transporte_locadora_outra: locadoraOutra,
    transporte_contrato: contrato,
    transporte_placa: placa ? maiusculas(placa) : null,
  };
}
