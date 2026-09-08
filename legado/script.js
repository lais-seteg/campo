// ══════════════════════════════════════════════════════
//  SOLICITAÇÃO DE CAMPO · Seteg
//
//  Versão digital do formulário FORMULARIO_SOLICITACAO_ADMINISTRATIVA_
//  FINANCEIRA_CODIGO CLOCKIFY_REV00.xlsx (ver doc/). A planilha tem três
//  abas e é delas que sai a estrutura daqui:
//
//    · FINANCEIRO     → recurso com prestação de contas (transporte,
//                       combustível, outros) + diárias de alimentação
//                       pagas mediante recibo.
//    · ADMINISTRATIVO → veículo, hospedagem e equipamento de campo, com
//                       o quadro de CONFERÊNCIA (entrega e devolução,
//                       com teste e avaria, assinado dos dois lados).
//    · TECNICOS       → técnico ↔ código Clockify (vira o datalist).
//
//  Montado sobre a base do Controle de Estoque: mesmo design system
//  (style.css é cópia), mesmo login de senha única e o MESMO projeto
//  Supabase — as duas telas compartilham `perfis`, identificar_acesso()
//  e o catálogo de `itens`.
//
//  O QUE A v2 ACRESCENTOU (supabase/02_campo_v2.sql):
//
//   · A aprovação SAIU. O pedido nasce valendo:
//     Solicitada → Logística confirmada → Em campo → Finalizada.
//   · O material pedido fica INDISPONÍVEL nas datas do campo. É a
//     integração com o estoque: reserva na solicitação, Saída na entrega,
//     Entrada na devolução, manutenção quando há avaria. Quem confere
//     saldo e datas é o banco, não esta tela.
//   · Calendário de equipe × projeto × data.
//   · Cadastro de hotéis por município e de projetos com o previsto por
//     dia; PREVISTO × REAL com status de curso (± 5% de tolerância).
//   · SST como bloco de conferência do pedido, impresso no checklist.
//   · Assinatura desenhada na tela, no lugar do nome digitado.
//   · Avaria com custo estimado e custo real.
//   · Edição e acréscimo, com histórico gravado por trigger.
//
//  Schema em duas partes: 01_solicitacoes.sql (o formulário) e
//  02_campo_v2.sql (o resto). Faltando qualquer um dos dois, o app entra,
//  avisa o que está desligado e continua utilizável.
// ══════════════════════════════════════════════════════
if (!window.SUPABASE_URL || !window.SUPABASE_KEY) {
  throw new Error("config.js não encontrado ou incompleto — defina window.SUPABASE_URL e window.SUPABASE_KEY.");
}
if (!window.supabase || !window.supabase.createClient) {
  throw new Error("vendor/supabase.js não foi carregado antes de script.js.");
}

// storageKey próprio: uma aba do estoque e uma aba daqui não brigam pela
// mesma sessão no localStorage, mesmo sendo o mesmo projeto Supabase.
const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "campo_seteg_sessao" }
});

const THEME_KEY = "campo_seteg_theme";

let SESSAO = null;

// ── OS TRÊS PAPÉIS E O QUE NÃO É PAPEL ──
//
//   direcao — acima da Gestão. Só ela cadastra projeto e líder.
//   gestor  — Gestão: exclui cadastro, ajusta o valor da diária.
//   tecnico — abre solicitação, edita, registra conferência.
//
// LÍDER NÃO É PAPEL: é ser o líder de alguma linha de `projetos`. Um
// colaborador pode liderar um projeto e não liderar outro, e é por isso
// que a pergunta certa nunca é "esta pessoa é líder?", e sim "esta pessoa
// é líder DESTE projeto?" — quem responde é ehLiderDoProjeto.
function ehDirecao() { return !!SESSAO && SESSAO.papel === "direcao"; }

// A Direção pode tudo que a Gestão pode: papel de cima com menos poder
// que o de baixo não faria sentido. Mesma regra que a função eh_gestor()
// do banco passou a seguir.
function ehAdmin() { return !!SESSAO && (SESSAO.papel === "gestor" || SESSAO.papel === "direcao"); }

// Lidera este projeto? A Direção entra como líder de qualquer um: líder
// de férias não pode travar o campo inteiro.
function ehLiderDoProjeto(projetoId) {
  if (!SESSAO || !projetoId) return false;
  if (ehDirecao()) return true;
  const projeto = DB.projetos.find(p => p.id === projetoId);
  return !!projeto && projeto.lider_id === SESSAO.id;
}

// Lidera algum projeto? É o que acende a aba de Aprovações.
function ehLider() {
  return ehDirecao() || (!!SESSAO && DB.projetos.some(p => p.lider_id === SESSAO.id));
}

// Quem aprova esta solicitação, para a tela poder dizer o nome.
function liderDaSolicitacao(s) {
  const projeto = DB.projetos.find(p => p.id === s.projeto_id);
  return projeto ? (projeto.lider || "—") : "—";
}

// Pode decidir ESTA solicitação? Só o líder do projeto dela (ou a
// Direção), e só enquanto ela espera decisão.
function podeAprovar(s) {
  return !!s && s.status === "Aguardando aprovação" && ehLiderDoProjeto(s.projeto_id);
}

const CARGOS_PADRAO = {
  maite:   "Assistente de PMO",
  jonatas: "Assistente de Compras",
  juliana: "Coordenadora do Administrativo",
  gestao:  "Gestão",
};
function cargoSessao() {
  if (!SESSAO) return "";
  const cargo = (SESSAO.cargo || "").trim();
  if (cargo) return cargo;
  return CARGOS_PADRAO[(SESSAO.usuario || "").toLowerCase()] || "";
}

// Aba TECNICOS da planilha. Fica aqui até existir cadastro de técnicos no
// banco — mantenha igual à planilha enquanto ela for a fonte oficial.
const TECNICOS = [
  { nome: "ALAN VICTOR",        codigo: "617757852" },
  { nome: "EDMAR XIMENES",      codigo: "600294056" },
  { nome: "EVELINE ESQUITA",    codigo: "616371101" },
  { nome: "FELIPE GOMES",       codigo: "616060670" },
  { nome: "LIZABETH SILVA",     codigo: "609755005" },
  { nome: "VALERIO VIEIRA",     codigo: "601013611" },
  { nome: "KARLLA MORGANA",     codigo: "85673/05-D" },
  { nome: "JEFERSON FREITAS",   codigo: "114503/05-P" },
  { nome: "MATHEUS FONTENELLE", codigo: "46095/5-D" },
  { nome: "JULIANA VICENTE",    codigo: "0211621838-1" },
];

// Grupos de despesa com prestação de contas — os três blocos numerados
// da aba FINANCEIRO, na mesma ordem.
const GRUPOS_DESPESA = [
  { nome: "Transporte",  container: "sTransporte",  preview: "previewTransporte" },
  { nome: "Combustível", container: "sCombustivel", preview: "previewCombustivel" },
  { nome: "Outros",      container: "sOutros",      preview: "previewOutros" },
];

// Tipos de diária, exatamente como estão na planilha, agora com o VALOR
// DE REFERÊNCIA: R$ 55,00 com pernoite e R$ 35,00 sem pernoite.
//
// Isto aqui é só o padrão de partida. Quem manda é a tabela
// `diaria_valores` no banco, carregada em DB.diarias — mudar o valor da
// diária é decisão administrativa, e não pode depender de deploy. A
// constante existe para a tela funcionar antes de o schema ser aplicado.
const DIARIA_COM_PERNOITE = 55.00;
const DIARIA_SEM_PERNOITE = 35.00;

const DIARIAS_PADRAO = [
  { tipo_diaria: "Diária sem pernoite | SEG À SEX",            vinculo: "Seteg",      pernoite: false, valor: DIARIA_SEM_PERNOITE },
  { tipo_diaria: "Diária sem pernoite | SAB À DOM",            vinculo: "Seteg",      pernoite: false, valor: DIARIA_SEM_PERNOITE },
  { tipo_diaria: "Diária com pernoite",                        vinculo: "Seteg",      pernoite: true,  valor: DIARIA_COM_PERNOITE },
  { tipo_diaria: "Diária colaborador temporário sem pernoite", vinculo: "Temporário", pernoite: false, valor: DIARIA_SEM_PERNOITE },
  { tipo_diaria: "Diária colaborador temporário com pernoite", vinculo: "Temporário", pernoite: true,  valor: DIARIA_COM_PERNOITE },
];

// Diárias do vínculo escolhido, na ordem da planilha.
function diariasDoVinculo(vinculo) {
  const lista = (DB.diarias && DB.diarias.length ? DB.diarias : DIARIAS_PADRAO)
    .filter(d => d.vinculo === vinculo && d.ativo !== false);
  return lista.length ? lista : DIARIAS_PADRAO.filter(d => d.vinculo === vinculo);
}
function diariaPorTipo(tipo) {
  return (DB.diarias && DB.diarias.length ? DB.diarias : DIARIAS_PADRAO)
    .find(d => d.tipo_diaria === tipo) || null;
}

// Locadoras em lista fechada: é sobre elas que se negocia contrato, e
// texto livre transformaria "Movida" em cinco grafias diferentes — o
// gasto por locadora deixaria de somar.
const LOCADORAS = ["Movida", "Localiza", "Unidas", "Outros"];

// EPIs oferecidos como sugestão no bloco de SST. Lista aberta: o campo
// aceita qualquer texto, isto é só o atalho para o que se repete.
const EPIS_PADRAO = [
  "Capacete com jugular", "Óculos de proteção", "Luva isolante",
  "Luva de vaqueta", "Botina de segurança", "Cinto paraquedista",
  "Talabarte duplo", "Protetor auricular", "Vestimenta anti-arco",
  "Protetor facial", "Colete refletivo", "Máscara PFF2",
];

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
             "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

// O fluxo: a aprovação da Gestão saiu, e entrou a do LÍDER DO PROJETO —
// ele confirma que o campo é do escopo dele. Aguardando aprovação →
// Aprovada → Logística confirmada → Em campo → Finalizada, com Recusada
// (pelo líder, com motivo) e Cancelada em qualquer ponto.
const STATUS_CLASSE = {
  "Aguardando aprovação":  "st-perto",
  "Aprovada":              "st-info",
  "Logística confirmada":  "st-info",
  "Em campo":              "st-info",
  "Finalizada":            "st-ok",
  "Recusada":              "st-ruim",
  "Cancelada":             "st-neutro",
};
function statusClass(status) { return STATUS_CLASSE[status] || "st-neutro"; }

// Status de curso: como o gasto real está em relação ao previsto. Quem
// calcula é o banco (faixa de tolerância de 5%); aqui só se pinta.
const CURSO_CLASSE = {
  "Abaixo do previsto": "st-ok",
  "Dentro do previsto": "st-info",
  "Acima do previsto":  "st-ruim",
  "Sem realizado":      "st-neutro",
  "Sem previsto":       "st-perto",
};
function cursoClass(curso) { return CURSO_CLASSE[curso] || "st-neutro"; }

// A mesma faixa do banco. Existe aqui só para a prévia do formulário
// dizer o mesmo que a coluna vai dizer depois de salvar.
const TOLERANCIA_CURSO = 0.05;

const SST_CLASSE = {
  "Conforme":      "st-ok",
  "Pendente":      "st-perto",
  "Não aplicável": "st-neutro",
};

const AVARIA_CLASSE = {
  "Aberta":    "st-ruim",
  "Em reparo": "st-perto",
  "Resolvida": "st-ok",
  "Cobrada":   "st-ok",
  "Baixada":   "st-neutro",
};

let DB = {
  solicitacoes: [], catalogo: [], projetos: [], hoteis: [], diarias: [], avarias: [],
  // Quem existe no sistema. Serve para a Direção escolher o líder de um
  // projeto numa lista, em vez de digitar o nome e o vínculo não existir.
  perfis: [],
  // Disponibilidade do catálogo NAS DATAS do formulário aberto. Não é
  // saldo de estoque: é saldo menos o que já está comprometido com outros
  // campos no mesmo período. Vem da função itens_disponiveis_no_periodo.
  disponibilidade: { inicio: null, fim: null, itens: [] },
};
// Vira false quando o banco ainda não tem as tabelas do rascunho. A tela
// segue funcionando vazia, com aviso — não quebra na cara de quem abrir.
let ESTRUTURA_OK = true;
// Vira false enquanto 02_campo_v2.sql não tiver rodado. A diferença
// importa: sem ele a tela funciona, mas sem reserva, sem calendário e sem
// previsto × real — e é melhor dizer isso do que fingir.
let ESTRUTURA_V2_OK = true;

const hoje = new Date();
let STATE = {
  secaoAtiva: "solicitacoes",
  filtros: { tipo: "", status: "", curso: "", busca: "", pagina: 1, porPagina: 20 },
  detalheId: null,
  cancelamentoAlvo: null,
  recusaAlvo: null,
  acrescimoAlvo: null,
  logisticaAlvo: null,
  conferencia: { id: null, modo: "entrega" },
  edicaoId: null,
  calendario: { ano: hoje.getFullYear(), mes: hoje.getMonth(), dia: null, projeto: "", colaborador: "" },
  cadastroAba: "hoteis",
  hoteisFiltros: { uf: "", municipio: "", busca: "" },
  projetosFiltros: { busca: "", lider: "" },
  avariasFiltros: { situacao: "", gravidade: "", busca: "" },
};

// ══════════════════════════════════════════════════════
//  ÍCONES (mesmo estilo do estoque: stroke, viewBox 24x24)
// ══════════════════════════════════════════════════════
const ICONES = {
  eye:   '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  checklist: '<path d="M9 11l2 2 4-4"/><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  truck: '<rect x="1" y="7" width="15" height="12" rx="1"/><path d="M16 11h3.5l2.5 3.5V19h-6"/><circle cx="5.5" cy="19.5" r="1.5"/><circle cx="17.5" cy="19.5" r="1.5"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  edit:  '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  seta:  '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
};
function svgIcon(nome, tamanho) {
  tamanho = tamanho || 16;
  return `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;vertical-align:-3px">${ICONES[nome] || ""}</svg>`;
}

// ══════════════════════════════════════════════════════
//  TEMA
// ══════════════════════════════════════════════════════
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const slider = document.getElementById("themeSlider");
  if (!slider) return;
  slider.innerHTML = theme === "light"
    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    : '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
}
function toggleTheme() {
  const atual = document.documentElement.getAttribute("data-theme") || "light";
  const proximo = atual === "dark" ? "light" : "dark";
  applyTheme(proximo);
  localStorage.setItem(THEME_KEY, proximo);
}

// ══════════════════════════════════════════════════════
//  ERROS
// ══════════════════════════════════════════════════════
// Postgres 42P01 = "relation does not exist": é o que responde enquanto o
// rascunho do schema não foi rodado. Vale um aviso claro, não um erro
// genérico que faria alguém procurar problema na internet.
function tabelaNaoExiste(erro) {
  return !!erro && (erro.code === "42P01" || /does not exist/i.test(String(erro.message || "")));
}
function mensagemErro(erro, acao) {
  const texto = String((erro && (erro.message || erro.details || erro.hint)) || "");
  if (tabelaNaoExiste(erro))
    return "As tabelas de solicitação ainda não existem no banco (ver supabase/01_solicitacoes.sql e 02_campo_v2.sql).";

  // P0001 é o RAISE EXCEPTION das nossas funções (reserva, entrega,
  // devolução, acréscimo). Essas mensagens são escritas para serem lidas
  // por quem está usando o sistema — "Material indisponível nas datas do
  // campo: medidor X, pedido 3, disponível 1" resolve o problema, e
  // trocá-la por "não foi possível concluir a operação" não resolve nada.
  if (erro && erro.code === "P0001" && texto) return texto;

  // Restrição do banco tem mensagem para programador, não para usuário —
  // aqui as que a tela pode encostar ganham tradução.
  if (/solicitacoes_cancelamento_check/.test(texto)) return "Cancelar exige o motivo.";
  if (/solicitacao_avarias_custo_check/.test(texto)) return "Avaria resolvida ou cobrada exige o custo real.";
  if (/solicitacoes_locadora_outra_check/.test(texto)) return "Locadora \"Outros\" exige dizer qual é.";
  if (/solicitacoes_periodo_check/.test(texto)) return "O fim do período não pode ser antes do início.";
  if (/solicitacoes_conferencia_check/.test(texto)) return "Registre a entrega antes da devolução.";
  if (/solicitacao_equipe_unica/.test(texto)) return "A mesma pessoa aparece duas vezes na equipe.";
  if (/solicitacao_equipe_um_lider/.test(texto)) return "Só uma pessoa pode ser líder da equipe.";
  if (/solicitacao_assinaturas_unica/.test(texto)) return "Esta assinatura já foi registrada.";
  if (/hoteis_unico/.test(texto)) return "Já existe um hotel com este nome neste município.";
  if (/projetos_unico/.test(texto)) return "Já existe este projeto para este cliente.";
  if (/check constraint "itens_manutencao_check"/.test(texto))
    return "Abrir manutenção do bem exige o fornecedor do reparo.";

  if (/duplicate key|already exists/i.test(texto)) return "Já existe um registro com esses dados.";
  if (erro && (erro.code === "42501" || /permission denied|row-level security/i.test(texto)))
    return "Você não tem permissão para isso.";
  if (/Failed to fetch|NetworkError|fetch failed/i.test(texto))
    return "Sem conexão com o banco de dados. Verifique a internet e tente de novo.";
  return `Não foi possível ${acao || "concluir a operação"}.`;
}
function avisarErro(erro, acao) {
  console.error(acao || "erro", erro);
  mostrarToast(mensagemErro(erro, acao), "err");
}

// ══════════════════════════════════════════════════════
//  PERSISTÊNCIA
// ══════════════════════════════════════════════════════
// Lê uma tabela da v2 sem derrubar o resto: enquanto 02_campo_v2.sql não
// rodar, essas relações não existem, e a tela precisa continuar de pé —
// com menos recurso, e dizendo qual.
async function lerV2(tabela, colunas, ordem) {
  let q = sb.from(tabela).select(colunas || "*");
  if (ordem) q = q.order(ordem.campo, { ascending: ordem.asc !== false });
  const r = await q;
  if (r.error) {
    if (tabelaNaoExiste(r.error)) { ESTRUTURA_V2_OK = false; return []; }
    avisarErro(r.error, `carregar ${tabela}`);
    return [];
  }
  return r.data || [];
}

// Agrupa uma lista plana pelo id da solicitação — as tabelas-filhas da v2
// são lidas soltas, e não como embed, justamente para uma delas faltando
// não invalidar a consulta inteira.
function porSolicitacao(lista) {
  const mapa = new Map();
  (lista || []).forEach(linha => {
    const chave = linha.solicitacao_id;
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(linha);
  });
  return mapa;
}

async function carregarDB() {
  ESTRUTURA_V2_OK = true;

  // O catálogo vem do Controle de Estoque — mesma tabela, mesmo banco.
  const catalogo = await sb
    .from("itens")
    .select("id,codigo,produto,categoria,estoque_atual,em_manutencao")
    .order("produto", { ascending: true });
  if (catalogo.error) { avisarErro(catalogo.error, "carregar o catálogo de itens"); DB.catalogo = []; }
  else DB.catalogo = catalogo.data || [];

  const sols = await sb
    .from("solicitacoes")
    .select("*, solicitacao_equipamentos(*), solicitacao_hospedagens(*), solicitacao_despesas(*), solicitacao_diarias(*)")
    .order("criado_em", { ascending: false });

  if (sols.error) {
    DB.solicitacoes = [];
    ESTRUTURA_OK = !tabelaNaoExiste(sols.error);
    if (!ESTRUTURA_OK) console.warn("Schema ainda não aplicado — ver supabase/01_solicitacoes.sql.");
    else avisarErro(sols.error, "carregar as solicitações");
    return;
  }
  ESTRUTURA_OK = true;

  // Os nomes de quem usa o sistema. A política de `perfis` já libera
  // consulta para usuário ativo (é ela que o estoque usa), então não é
  // dado novo exposto — é o mesmo que a tela de acesso lê.
  const perfis = await sb.from("perfis").select("id,usuario,nome,papel,cargo,ativo")
    .eq("ativo", true).order("nome");
  DB.perfis = perfis.error ? [] : (perfis.data || []);
  if (perfis.error) console.warn("perfis", perfis.error);

  const [projetos, hoteis, diarias, equipe, epis, avarias, assinaturas, alteracoes, reservas] = await Promise.all([
    lerV2("projetos", "*", { campo: "cliente" }),
    lerV2("hoteis", "*", { campo: "municipio" }),
    lerV2("diaria_valores", "*", { campo: "tipo_diaria" }),
    lerV2("solicitacao_equipe"),
    lerV2("solicitacao_sst_epis"),
    lerV2("solicitacao_avarias", "*", { campo: "aberto_em", asc: false }),
    lerV2("solicitacao_assinaturas"),
    lerV2("solicitacao_alteracoes", "*", { campo: "data", asc: false }),
    lerV2("item_reservas"),
  ]);

  DB.projetos = projetos;
  DB.hoteis   = hoteis;
  DB.diarias  = diarias;
  DB.avarias  = avarias;

  const porEquipe      = porSolicitacao(equipe);
  const porEpis        = porSolicitacao(epis);
  const porAvarias     = porSolicitacao(avarias);
  const porAssinaturas = porSolicitacao(assinaturas);
  const porAlteracoes  = porSolicitacao(alteracoes);
  const porReservas    = porSolicitacao(reservas);

  DB.solicitacoes = (sols.data || []).map(s => ({
    ...s,
    equipamentos: s.solicitacao_equipamentos || [],
    hospedagens:  s.solicitacao_hospedagens || [],
    despesas:     s.solicitacao_despesas || [],
    diarias:      s.solicitacao_diarias || [],
    equipe:       porEquipe.get(s.id) || [],
    epis:         porEpis.get(s.id) || [],
    avarias:      porAvarias.get(s.id) || [],
    assinaturas:  porAssinaturas.get(s.id) || [],
    alteracoes:   porAlteracoes.get(s.id) || [],
    reservas:     porReservas.get(s.id) || [],
  }));

  // A avaria guarda o id do equipamento, não o nome; resolver aqui deixa
  // o relatório e o painel simples.
  DB.avarias = DB.avarias.map(a => {
    const s = DB.solicitacoes.find(x => x.id === a.solicitacao_id);
    const cat = DB.catalogo.find(c => c.id === a.item_id);
    return {
      ...a,
      solicitacao_codigo: s ? s.codigo : "—",
      projeto: s ? s.cliente_projeto : "—",
      equipamento: cat ? `${cat.produto} · ${cat.codigo}` : "Item fora do catálogo",
    };
  });
}

async function recarregarTudo() {
  await carregarDB();
  renderTudo();
}

// ══════════════════════════════════════════════════════
//  LOGIN — um campo só, igual ao estoque: a senha diz quem é a pessoa,
//  e quem compara é o banco (identificar_acesso).
// ══════════════════════════════════════════════════════
function mostrarLogin() {
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("appScreen").classList.add("hidden");
  document.getElementById("sidebar").classList.add("hidden");
  document.getElementById("inputCodigo").value = "";
  document.getElementById("loginErro").classList.add("hidden");
  setTimeout(() => document.getElementById("inputCodigo").focus(), 80);
}

async function mostrarApp() {
  if (!SESSAO) { mostrarLogin(); return; }
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appScreen").classList.remove("hidden");
  document.getElementById("sidebar").classList.remove("hidden");
  document.getElementById("sessaoNome").textContent = SESSAO.nome;
  document.getElementById("sessaoPapel").textContent = cargoSessao();
  const dataDeHoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  document.getElementById("solData").textContent = dataDeHoje;
  document.getElementById("painelData").textContent = dataDeHoje;
  document.getElementById("avariasData").textContent = dataDeHoje;
  // Duas listas dos mesmos técnicos, em ordens invertidas: no campo de
  // Clockify o valor é o código (e o nome é a dica); no campo de nome da
  // equipe é o contrário.
  document.getElementById("listaTecnicos").innerHTML = TECNICOS
    .map(t => `<option value="${esc(t.codigo)}">${esc(t.nome)}</option>`).join("");
  document.getElementById("listaNomesTecnicos").innerHTML = TECNICOS
    .map(t => `<option value="${esc(t.nome)}">${esc(t.codigo)}</option>`).join("");
  document.getElementById("hUf").innerHTML = UFS.map(u => `<option${u === "CE" ? " selected" : ""}>${u}</option>`).join("");
  document.getElementById("listaEpis").innerHTML = EPIS_PADRAO.map(e => `<option value="${esc(e)}"></option>`).join("");
  registrarListeners();
  await carregarDB();
  irParaSecao(secaoInicial());
}

async function carregarSessao() {
  const { data, error } = await sb.auth.getSession();
  if (error || !data || !data.session) return null;
  // `select *` de propósito (mesma razão do estoque): coluna nova no banco
  // não pode derrubar o login de um site já publicado.
  const { data: perfil, error: erroPerfil } = await sb
    .from("perfis").select("*").eq("id", data.session.user.id).maybeSingle();
  if (erroPerfil || !perfil || !perfil.ativo) {
    await sb.auth.signOut();
    return null;
  }
  return perfil;
}

async function validarLogin() {
  const senha = document.getElementById("inputCodigo").value;
  const erro  = document.getElementById("loginErro");
  const botao = document.getElementById("btnEntrar");
  if (!senha) return;

  const rotuloOriginal = botao.textContent;
  botao.disabled = true;
  botao.textContent = "Entrando…";
  erro.classList.add("hidden");

  try {
    const { data, error } = await sb.rpc("identificar_acesso", { p_senha: senha });
    if (error) throw error;

    if (!data || !data.ok) {
      erro.textContent = data && data.motivo === "bloqueado"
        ? `Muitas tentativas seguidas. Aguarde ${data.minutos} minutos e tente de novo.`
        : "Senha inválida. Tente novamente.";
      erro.classList.remove("hidden");
      document.getElementById("inputCodigo").select();
      return;
    }

    const { error: erroLogin } = await sb.auth.signInWithPassword({ email: data.email, password: senha });
    if (erroLogin) throw erroLogin;

    SESSAO = await carregarSessao();
    if (!SESSAO) {
      erro.textContent = "Este acesso está desativado. Procure a Gestão.";
      erro.classList.remove("hidden");
      return;
    }
    await mostrarApp();
  } catch (e) {
    console.error("login", e);
    erro.textContent = mensagemErro(e, "entrar");
    erro.classList.remove("hidden");
  } finally {
    botao.disabled = false;
    botao.textContent = rotuloOriginal;
  }
}

async function sair() {
  await sb.auth.signOut();
  SESSAO = null;
  DB = { solicitacoes: [], catalogo: [], projetos: [], hoteis: [], diarias: [], avarias: [],
         perfis: [], disponibilidade: { inicio: null, fim: null, itens: [] } };
  mostrarLogin();
}

function initLoginEvents() {
  const input = document.getElementById("inputCodigo");
  const btnToggle = document.getElementById("btnToggleSenha");
  const olhoAberto = document.getElementById("iconOlhoAberto");
  const olhoFechado = document.getElementById("iconOlhoFechado");
  document.getElementById("btnEntrar").addEventListener("click", validarLogin);
  input.addEventListener("keydown", e => { if (e.key === "Enter") validarLogin(); });
  btnToggle.addEventListener("click", () => {
    if (input.type === "password") {
      input.type = "text"; olhoAberto.style.display = "none"; olhoFechado.style.display = "";
    } else {
      input.type = "password"; olhoAberto.style.display = ""; olhoFechado.style.display = "none";
    }
  });
}

// ══════════════════════════════════════════════════════
//  NAVEGAÇÃO
// ══════════════════════════════════════════════════════
function irParaSecao(secao) {
  STATE.secaoAtiva = secao;
  document.querySelectorAll(".secao").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".sidebar-btn").forEach(t => t.classList.remove("active"));
  const el = document.getElementById("secao-" + secao);
  if (el) el.classList.add("active");
  const tab = document.querySelector(`.sidebar-btn[data-secao="${secao}"]`);
  if (tab) tab.classList.add("active");
  renderTudo();
}

// ══════════════════════════════════════════════════════
//  LISTENERS
// ══════════════════════════════════════════════════════
let _listenersRegistrados = false;
function registrarListeners() {
  if (_listenersRegistrados) return;
  _listenersRegistrados = true;

  document.querySelectorAll(".sidebar-btn").forEach(btn =>
    btn.addEventListener("click", () => irParaSecao(btn.dataset.secao)));
  document.getElementById("btnSair").addEventListener("click", sair);
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);

  // ESC fecha o pop-up aberto. Quando há mais de um empilhado (detalhe →
  // recusa, por exemplo), fecha só o de cima — o de baixo continua onde
  // estava. Fechar não salva nada: é o mesmo que clicar em Cancelar.
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const abertos = document.querySelectorAll(".modal-overlay.active");
    if (!abertos.length) return;
    e.preventDefault();
    abertos[abertos.length - 1].classList.remove("active");
  });

  const f = STATE.filtros;
  document.getElementById("filtroTipo").addEventListener("change", e => { f.tipo = e.target.value; f.pagina = 1; renderSolicitacoes(); });
  document.getElementById("filtroStatus").addEventListener("change", e => { f.status = e.target.value; f.pagina = 1; renderSolicitacoes(); });
  document.getElementById("filtroCurso").addEventListener("change", e => { f.curso = e.target.value; f.pagina = 1; renderSolicitacoes(); });
  document.getElementById("buscaSolicitacao").addEventListener("input", e => { f.busca = e.target.value; f.pagina = 1; renderSolicitacoes(); });
  document.getElementById("porPagina").addEventListener("change", e => { f.porPagina = Number(e.target.value) || 20; f.pagina = 1; renderSolicitacoes(); });
  document.getElementById("btnLimparFiltros").addEventListener("click", () => {
    STATE.filtros = { tipo: "", status: "", curso: "", busca: "", pagina: 1, porPagina: f.porPagina };
    ["filtroTipo", "filtroStatus", "filtroCurso", "buscaSolicitacao"].forEach(id => document.getElementById(id).value = "");
    renderSolicitacoes();
  });
  document.getElementById("btnExportarCSV").addEventListener("click", exportarCSV);

  registrarListenersCampoV2();

  document.getElementById("btnNovaSolicitacao").addEventListener("click", abrirFormNovaSolicitacao);
  document.getElementById("btnFecharSolicitacao").addEventListener("click", () => fecharModal("formSolicitacao"));
  document.getElementById("btnCancelarSolicitacao").addEventListener("click", () => fecharModal("formSolicitacao"));
  document.getElementById("btnSalvarSolicitacao").addEventListener("click", salvarSolicitacao);

  document.querySelectorAll('input[name="sTipo"]').forEach(r =>
    r.addEventListener("change", aplicarTipoNoForm));
  document.querySelectorAll('input[name="sVeiculo"]').forEach(r =>
    r.addEventListener("change", () => alternarGrupo("sVeiculo", "grpVeiculo")));
  document.querySelectorAll('input[name="sHospedagem"]').forEach(r =>
    r.addEventListener("change", () => {
      alternarGrupo("sHospedagem", "grpHospedagem");
      // Marcar "precisa de hospedagem" sem nenhuma linha na tela deixa a
      // pessoa olhando para um bloco vazio — já abre a primeira cidade.
      if (grupoAtivo("sHospedagem") && !lerHospedagens().length) adicionarHospedagem();
    }));

  document.getElementById("btnAddHospedagem").addEventListener("click", () => adicionarHospedagem());
  document.getElementById("btnAddEquipamento").addEventListener("click", () => adicionarEquipamento());
  document.getElementById("btnAddDiaria").addEventListener("click", () => adicionarDiaria());
  document.querySelectorAll("button[data-grupo]").forEach(btn =>
    btn.addEventListener("click", () => adicionarDespesa(btn.dataset.grupo)));

  document.getElementById("btnFecharDetalhe").addEventListener("click", () => fecharModal("modalDetalhe"));
  document.getElementById("btnFecharDetalheOk").addEventListener("click", () => fecharModal("modalDetalhe"));
  document.getElementById("btnCancelarPedido").addEventListener("click", () => abrirModalCancelamento(STATE.detalheId));
  document.getElementById("btnEditarPedido").addEventListener("click", () => editarSolicitacao(STATE.detalheId));
  document.getElementById("btnAcrescentar").addEventListener("click", () => abrirModalAcrescimo(STATE.detalheId));
  document.getElementById("btnAprovarPedido").addEventListener("click", () => aprovarPedido(STATE.detalheId));
  document.getElementById("btnRecusarPedido").addEventListener("click", () => abrirModalRecusa(STATE.detalheId));

  document.getElementById("btnFecharRecusa").addEventListener("click", () => fecharModal("modalRecusa"));
  document.getElementById("btnCancelarRecusa").addEventListener("click", () => fecharModal("modalRecusa"));
  document.getElementById("btnConfirmarRecusa").addEventListener("click", confirmarRecusa);

  document.getElementById("btnFecharCancelamento").addEventListener("click", () => fecharModal("modalCancelamento"));
  document.getElementById("btnFecharCancelamentoOk").addEventListener("click", () => fecharModal("modalCancelamento"));
  document.getElementById("btnConfirmarCancelamento").addEventListener("click", confirmarCancelamento);

  document.getElementById("btnFecharConferencia").addEventListener("click", () => fecharModal("modalConferencia"));
  document.getElementById("btnCancelarConferencia").addEventListener("click", () => fecharModal("modalConferencia"));
  document.getElementById("btnSalvarConferencia").addEventListener("click", salvarConferencia);

  document.getElementById("btnFecharChecklist").addEventListener("click", () => fecharModal("modalChecklist"));
  document.getElementById("btnFecharChecklistOk").addEventListener("click", () => fecharModal("modalChecklist"));
  document.getElementById("btnImprimirChecklist").addEventListener("click", () => window.print());
}

// ══════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════
function renderTudo() {
  aplicarPapelNaNavegacao();
  renderSolicitacoes();
  renderCalendario();
  renderAprovacoes();
  renderLogistica();
  renderConferencia();
  renderCadastros();
  renderProjetos();
  renderAvarias();
  renderPainel();
  renderBadges();
}

// A Direção não abre nem acompanha pedido de campo — o menu dela é só o
// que ela decide: Painel, Direção, Aprovações e Calendário, nessa ordem.
// Os demais papéis seguem a ordem que está no HTML.
const MENU_DIRECAO = ["painel", "direcao", "aprovacoes", "calendario"];

// Ordem original das abas, lida do HTML na primeira renderização: é ela
// que devolve o menu ao normal quando outro papel entra na mesma máquina.
let ORDEM_MENU = null;

// Qual menu já está montado na tela ("direcao" ou "padrao"). renderTudo
// roda a cada mexida; sem isto o menu seria remontado à toa toda vez.
let MENU_APLICADO = null;

// Onde o papel cai ao entrar — e para onde volta se a aba em que estava
// deixar de existir para ele.
function secaoInicial() { return ehDirecao() ? "painel" : "solicitacoes"; }

// Aba que a pessoa não pode usar não fica na tela. Não é a barreira — a
// barreira é a política do banco; isto evita o uso casual e o clique que
// termina em erro.
function aplicarPapelNaNavegacao() {
  const nav = document.querySelector(".sidebar-nav");
  if (!nav) return;
  const botoes = Array.from(nav.querySelectorAll(".sidebar-btn"));
  if (!ORDEM_MENU) ORDEM_MENU = botoes.map(b => b.dataset.secao);

  const direcao = ehDirecao();
  const ordem = direcao ? MENU_DIRECAO : ORDEM_MENU;
  const permitidas = direcao
    ? MENU_DIRECAO
    : ORDEM_MENU.filter(s => s !== "direcao" && (s !== "aprovacoes" || ehLider()));

  botoes.forEach(b => b.classList.toggle("hidden", !permitidas.includes(b.dataset.secao)));

  // A barra é um flex: a ordem do DOM é a ordem na tela. appendChild move
  // o nó (não copia), então os listeners registrados continuam valendo.
  const chave = direcao ? "direcao" : "padrao";
  if (MENU_APLICADO !== chave) {
    ordem.forEach(s => {
      const b = nav.querySelector(`.sidebar-btn[data-secao="${s}"]`);
      if (b) nav.appendChild(b);
    });
    MENU_APLICADO = chave;
  }

  // Se a pessoa estava numa aba que acabou de sumir (trocou de acesso na
  // mesma máquina), volta para a aba inicial do papel em vez de ficar
  // numa tela vazia sem saber por quê.
  //
  // A troca é feita à mão, e não por irParaSecao: esta função é chamada
  // DE DENTRO de renderTudo, e irParaSecao chama renderTudo de volta —
  // seria recursão infinita.
  if (!permitidas.includes(STATE.secaoAtiva)) {
    STATE.secaoAtiva = secaoInicial();
    document.querySelectorAll(".secao").forEach(s => s.classList.remove("active"));
    botoes.forEach(t => t.classList.remove("active"));
    const sec = document.getElementById("secao-" + STATE.secaoAtiva);
    if (sec) sec.classList.add("active");
    const tab = nav.querySelector(`.sidebar-btn[data-secao="${STATE.secaoAtiva}"]`);
    if (tab) tab.classList.add("active");
  }
}

function porStatus(status) { return DB.solicitacoes.filter(s => s.status === status); }

function renderBadges() {
  const badge = (id, n) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = n;
    el.classList.toggle("hidden", n === 0);
  };
  badge("badgeAprovacoes", solicitacoesParaAprovar().length);
  badge("badgeLogistica", porStatus("Aprovada").length);
  badge("badgeConferencia", solicitacoesParaConferencia().length);
  badge("badgeAvarias", DB.avarias.filter(a => a.situacao === "Aberta" || a.situacao === "Em reparo").length);
}

// O que ESTA pessoa tem para decidir: pedidos esperando aprovação nos
// projetos que ela lidera. A Direção vê todos — é ela que destrava campo
// de líder ausente.
function solicitacoesParaAprovar() {
  return DB.solicitacoes.filter(s =>
    s.status === "Aguardando aprovação" && ehLiderDoProjeto(s.projeto_id));
}

// Total da solicitação: despesas com prestação de contas + diárias. Vale
// só para o tipo Financeiro; o administrativo não movimenta dinheiro.
function totalSolicitacao(s) {
  const despesas = (s.despesas || []).reduce((t, d) => t + (Number(d.valor) || 0), 0);
  const diarias  = (s.diarias  || []).reduce((t, d) => t + (Number(d.dias) || 0) * (Number(d.valor_unitario) || 0), 0);
  return despesas + diarias;
}

function solicitacoesFiltradas() {
  const f = STATE.filtros;
  const busca = f.busca.trim().toLowerCase();
  return DB.solicitacoes.filter(s => {
    if (f.tipo && s.tipo !== f.tipo) return false;
    if (f.status && s.status !== f.status) return false;
    if (f.curso && (s.status_curso || "") !== f.curso) return false;
    if (busca) {
      // A equipe entra na busca: quem procura "quem foi para Aquiraz"
      // procura pelo nome da pessoa, não pelo código do pedido.
      const equipe = (s.equipe || []).map(e => e.colaborador).join(" ");
      const alvo = `${s.codigo || ""} ${s.cliente_projeto || ""} ${s.destino || ""} ${s.solicitante_nome || ""} ${equipe}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

// Equipe resumida para a tabela: o líder na frente, e "+N" para o resto.
// A lista inteira fica no detalhe.
function equipeResumo(s) {
  const equipe = s.equipe || [];
  if (!equipe.length) return "—";
  const lider = equipe.find(e => e.lider) || equipe[0];
  const resto = equipe.length - 1;
  return resto > 0 ? `${lider.colaborador} +${resto}` : lider.colaborador;
}

function renderSolicitacoes() {
  const f = STATE.filtros;
  const lista = solicitacoesFiltradas();
  const totalPaginas = Math.max(1, Math.ceil(lista.length / f.porPagina));
  f.pagina = Math.min(Math.max(1, f.pagina), totalPaginas);
  const inicio = (f.pagina - 1) * f.porPagina;
  const pagina = lista.slice(inicio, inicio + f.porPagina);

  document.getElementById("tabelaSolicitacoes").innerHTML = pagina.map(s => `<tr>
      <td>${esc(s.codigo || "—")}</td>
      <td>${esc(s.tipo || "—")}</td>
      <td>${esc(s.solicitante_nome || "—")}</td>
      <td>${esc(s.cliente_projeto || "—")}</td>
      <td>${esc(s.destino || "—")}</td>
      <td>${esc(periodoTexto(s))}</td>
      <td>${esc(equipeResumo(s))}</td>
      <td>${esc(formatarMoeda(s.previsto_total))}</td>
      <td>${esc(formatarMoeda(s.real_total))}</td>
      <td><span class="status-badge ${cursoClass(s.status_curso)}">${esc(cursoCurto(s))}</span></td>
      <td><span class="status-badge ${SST_CLASSE[s.sst_identificacao] || "st-neutro"}">${esc(s.sst_identificacao || "—")}</span></td>
      <td><span class="status-badge ${statusClass(s.status)}">${esc(s.status || "—")}</span></td>
      <td class="table-actions">
        <button class="btn-icon" title="Ver solicitação" onclick="abrirDetalhe('${s.id}')">${svgIcon("eye")}</button>
        ${(s.equipamentos || []).length ? `<button class="btn-icon" title="Checklist de campo" onclick="abrirChecklist('${s.id}')">${svgIcon("checklist")}</button>
        <button class="btn-icon" title="Conferência" onclick="abrirConferenciaAuto('${s.id}')">${svgIcon("truck")}</button>` : ""}
      </td>
    </tr>`).join("");

  document.getElementById("emptySolicitacoes").classList.toggle("visible", lista.length === 0);
  document.getElementById("emptySolicitacoesTexto").textContent = ESTRUTURA_OK
    ? "Nenhuma solicitação registrada"
    : "O banco ainda não tem as tabelas de solicitação (supabase/01_solicitacoes.sql)";

  document.getElementById("resumoSolicitacoes").textContent = !ESTRUTURA_OK
    ? "Estrutura do banco pendente — a tela funciona, mas ainda não há onde gravar."
    : !ESTRUTURA_V2_OK
      ? `${lista.length} solicitaç${lista.length === 1 ? "ão" : "ões"} · rode supabase/02_campo_v2.sql para ligar reserva de material, calendário e previsto × real.`
      : `${lista.length} solicitaç${lista.length === 1 ? "ão" : "ões"} · ${porStatus("Aguardando aprovação").length} aguardando líder · ${porStatus("Aprovada").length} com logística a fechar · ${porStatus("Em campo").length} em campo`;

  document.getElementById("paginacaoInfo").textContent = `${lista.length} registro${lista.length === 1 ? "" : "s"}`;
  document.getElementById("paginacaoControles").innerHTML = `
    <button class="btn-pagination" ${f.pagina <= 1 ? "disabled" : ""} onclick="irParaPagina(${f.pagina - 1})">‹</button>
    <span class="page-number">${f.pagina}</span>
    <button class="btn-pagination" ${f.pagina >= totalPaginas ? "disabled" : ""} onclick="irParaPagina(${f.pagina + 1})">›</button>`;
}
function irParaPagina(n) { STATE.filtros.pagina = n; renderSolicitacoes(); }

function periodoTexto(s) {
  const de = dataISOparaBR(s.periodo_inicio), ate = dataISOparaBR(s.periodo_fim);
  if (!de && !ate) return "—";
  return `${de || "?"} a ${ate || "?"}`;
}

function resumoBlocos(s) {
  const partes = [];
  if ((s.equipe || []).length) partes.push(`${s.equipe.length} na equipe`);
  if (s.veiculo_necessario) partes.push(`Veículo${s.transporte_locadora ? ` (${s.transporte_locadora})` : ""}`);
  if ((s.hospedagens || []).length) partes.push(`Hospedagem em ${s.hospedagens.length} cidade(s)`);
  if ((s.equipamentos || []).length) partes.push(`${s.equipamentos.length} equipamento(s)`);
  if ((s.despesas || []).length) partes.push(`${s.despesas.length} despesa(s)`);
  if ((s.diarias || []).length) partes.push(`${s.diarias.length} diária(s)`);
  return partes.join(" · ") || "Sem itens";
}

// Rótulo curto do status de curso para a tabela — a coluna é estreita e
// "Abaixo do previsto" não cabe. O percentual é o que se olha de fato.
function cursoCurto(s) {
  const curso = s.status_curso || "Sem realizado";
  if (curso === "Sem realizado" || curso === "Sem previsto") return curso === "Sem previsto" ? "s/ previsto" : "s/ real";
  const pct = Number(s.desvio_percentual);
  const sinal = pct > 0 ? "+" : "";
  return isFinite(pct) ? `${sinal}${pct.toFixed(1)}%` : curso;
}

function cardSolicitacao(s, acoes) {
  return `<div class="alerta-card ${s.tipo === "Financeiro" ? "alerta-atencao" : "alerta-critico"}">
    <div class="alerta-titulo">${esc(s.codigo || "—")} · ${esc(s.cliente_projeto || "—")}</div>
    <div class="alerta-desc">${esc(s.tipo)} · ${esc(s.solicitante_nome || "—")} · ${esc(s.destino || "—")}</div>
    <div class="alerta-meta">${esc(resumoBlocos(s))}</div>
    <div class="alerta-meta">Período ${esc(periodoTexto(s))} · previsto ${esc(formatarMoeda(s.previsto_total))} · real ${esc(formatarMoeda(s.real_total))}</div>
    <div class="alerta-meta">
      <span class="status-badge ${SST_CLASSE[s.sst_identificacao] || "st-neutro"}">SST ${esc(s.sst_identificacao || "—")}</span>
      <span class="status-badge ${cursoClass(s.status_curso)}">${esc(s.status_curso || "—")}</span>
    </div>
    <div class="table-actions" style="margin-top:.6rem">${acoes}</div>
  </div>`;
}

// A fila do líder. Cada cartão diz de quem é o pedido e para qual
// projeto — é essa a decisão: "este campo é do meu projeto?".
function renderAprovacoes() {
  const lista = solicitacoesParaAprovar();
  const sub = document.getElementById("aprovacoesSub");
  if (sub) {
    sub.textContent = ehDirecao()
      ? "Todos os campos aguardando o líder — a Direção também aprova"
      : "Campos aguardando sua decisão como líder";
  }
  document.getElementById("listaAprovacoes").innerHTML = lista.length
    ? lista.map(s => cardSolicitacao(s, `
        <button class="btn-icon" title="Ver" onclick="abrirDetalhe('${s.id}')">${svgIcon("eye")}</button>
        <button class="btn btn-green btn-sm" onclick="aprovarPedido('${s.id}')">Aprovar</button>
        <button class="btn btn-red btn-sm" onclick="abrirModalRecusa('${s.id}')">Recusar</button>`)).join("")
    : `<div class="alertas-empty">${
        !ESTRUTURA_OK ? "Estrutura do banco pendente."
        : ehLider() ? "Nada aguardando sua decisão."
        : "Você não lidera nenhum projeto."}</div>`;
}

// A fila da logística: pedido JÁ APROVADO pelo líder que ainda não teve
// veículo, hotel e material fechados. Antes da aprovação não entra aqui —
// fechar hotel de um campo que o líder ainda não validou é gastar antes
// da hora.
function renderLogistica() {
  const lista = porStatus("Aprovada");
  document.getElementById("listaLogistica").innerHTML = lista.length
    ? lista.map(s => cardSolicitacao(s, `
        <button class="btn-icon" title="Ver" onclick="abrirDetalhe('${s.id}')">${svgIcon("eye")}</button>
        <button class="btn btn-green btn-sm" onclick="abrirModalLogistica('${s.id}')">Confirmar logística</button>
        <button class="btn btn-red btn-sm" onclick="abrirModalCancelamento('${s.id}')">Cancelar</button>`)).join("")
    : `<div class="alertas-empty">${ESTRUTURA_OK
        ? `Nenhuma logística pendente.${porStatus("Aguardando aprovação").length
            ? ` ${porStatus("Aguardando aprovação").length} pedido(s) ainda esperando o líder.` : ""}`
        : "Estrutura do banco pendente."}</div>`;
}

// Vai para a conferência tudo que tem equipamento, JÁ FOI APROVADO e não
// terminou: antes da entrega (para registrar a saída) e depois dela (para
// registrar a volta). Campo urgente não espera o hotel para levar o
// medidor, mas espera o líder — o banco recusa a entrega antes disso.
function solicitacoesParaConferencia() {
  return DB.solicitacoes.filter(s =>
    (s.equipamentos || []).length &&
    ["Aprovada", "Logística confirmada", "Em campo"].includes(s.status));
}

function renderConferencia() {
  const lista = solicitacoesParaConferencia();
  document.getElementById("listaConferencia").innerHTML = lista.length
    ? lista.map(s => {
        const entregue = !!s.entrega_data;
        return cardSolicitacao(s, `
          <button class="btn-icon" title="Ver" onclick="abrirDetalhe('${s.id}')">${svgIcon("eye")}</button>
          <button class="btn-icon" title="Checklist de campo" onclick="abrirChecklist('${s.id}')">${svgIcon("checklist")}</button>
          ${entregue
            ? `<button class="btn btn-primary btn-sm" onclick="abrirConferencia('${s.id}','devolucao')">Registrar devolução</button>`
            : `<button class="btn btn-primary btn-sm" onclick="abrirConferencia('${s.id}','entrega')">Registrar entrega</button>`}`);
      }).join("")
    : `<div class="alertas-empty">${ESTRUTURA_OK ? "Nenhum equipamento aguardando conferência." : "Estrutura do banco pendente."}</div>`;
}

function renderPainel() {
  const noventaDias = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const recentes = DB.solicitacoes.filter(s => new Date(s.criado_em || 0).getTime() >= noventaDias);
  const previsto = recentes.reduce((t, s) => t + (Number(s.previsto_total) || 0), 0);
  const real     = recentes.reduce((t, s) => t + (Number(s.real_total) || 0), 0);

  // O curso é contado só onde faz sentido comparar — campo sem realizado
  // ainda não é "dentro do previsto", é campo que não aconteceu.
  const porCurso = curso => DB.solicitacoes.filter(s => s.status_curso === curso);
  const abaixo = porCurso("Abaixo do previsto");
  const acima  = porCurso("Acima do previsto");
  const economia = abaixo.reduce((t, s) => t + Math.abs(Number(s.desvio_valor) || 0), 0);
  const excesso  = acima.reduce((t, s) => t + Math.abs(Number(s.desvio_valor) || 0), 0);

  const aplicaveis = DB.solicitacoes.filter(s => s.sst_aplicavel !== false);
  const conformes  = aplicaveis.filter(s => s.sst_identificacao === "Conforme").length;

  const custoAvaria  = DB.avarias.reduce((t, a) => t + (Number(a.custo_real ?? a.custo_estimado) || 0), 0);
  const avariaAberta = DB.avarias.filter(a => a.situacao === "Aberta" || a.situacao === "Em reparo").length;

  document.getElementById("kpiSolicitadas").textContent = porStatus("Aprovada").length;
  document.getElementById("kpiAguardando").textContent  = porStatus("Aguardando aprovação").length;
  document.getElementById("kpiEmCampo").textContent     = porStatus("Em campo").length;
  document.getElementById("kpiPrevistoReal").textContent = `${formatarMoeda(real)} / ${formatarMoeda(previsto)}`;
  document.getElementById("kpiPrevistoRealSub").textContent =
    previsto > 0
      ? `Real sobre previsto nos últimos 90 dias · ${(real / previsto * 100).toFixed(0)}%`
      : "Nenhum previsto informado nos últimos 90 dias";
  document.getElementById("kpiSst").textContent = conformes;
  document.getElementById("kpiSstSub").textContent =
    `de ${aplicaveis.length} campo(s) que exigem SST`;
  document.getElementById("kpiAvarias").textContent = formatarMoeda(custoAvaria);
  document.getElementById("kpiAvariasSub").textContent =
    `${DB.avarias.length} avaria(s) · ${avariaAberta} em aberto`;

  document.getElementById("cursoAbaixo").textContent = abaixo.length;
  document.getElementById("cursoDentro").textContent = porCurso("Dentro do previsto").length;
  document.getElementById("cursoAcima").textContent  = acima.length;
  document.getElementById("cursoSem").textContent    = porCurso("Sem realizado").length;
  document.getElementById("cursoAbaixoValor").textContent = `${formatarMoeda(economia)} economizados`;
  document.getElementById("cursoAcimaValor").textContent  = `${formatarMoeda(excesso)} a mais`;

  const ultimas = DB.solicitacoes.slice(0, 12);
  document.getElementById("tabelaPainelHistorico").innerHTML = ultimas.map(s => `<tr>
    <td>${esc(s.codigo || "—")}</td>
    <td>${esc(s.cliente_projeto || "—")}</td>
    <td>${esc(periodoTexto(s))}</td>
    <td>${esc(formatarMoeda(s.previsto_total))}</td>
    <td>${esc(formatarMoeda(s.real_total))}</td>
    <td>${esc(desvioTexto(s))}</td>
    <td><span class="status-badge ${cursoClass(s.status_curso)}">${esc(s.status_curso || "—")}</span></td>
    <td><span class="status-badge ${statusClass(s.status)}">${esc(s.status || "—")}</span></td>
    <td>${esc(formatarDataHora(s.atualizado_em || s.criado_em))}</td>
  </tr>`).join("");
  document.getElementById("emptyPainel").classList.toggle("visible", ultimas.length === 0);
}

// Desvio em dinheiro e em percentual, com sinal — é o que diz se o campo
// custou mais ou menos, e quanto.
function desvioTexto(s) {
  const valor = Number(s.desvio_valor) || 0;
  const pct = Number(s.desvio_percentual);
  if (!Number(s.previsto_total)) return "—";
  const sinal = valor > 0 ? "+" : valor < 0 ? "−" : "";
  const pctTexto = isFinite(pct) ? ` (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)` : "";
  return `${sinal}${formatarMoeda(Math.abs(valor))}${pctTexto}`;
}

// ══════════════════════════════════════════════════════
//  FORMULÁRIO — linhas dinâmicas
//
//  O estado das linhas mora no DOM (o formulário é curto e some ao
//  fechar): estas funções leem o que está lá e remontam sem perder o que
//  já foi digitado. Mesmo padrão do formulário de item do estoque.
// ══════════════════════════════════════════════════════
function tipoSelecionado() {
  const marcado = document.querySelector('input[name="sTipo"]:checked');
  return marcado ? marcado.value : "Administrativo";
}
function aplicarTipoNoForm() {
  const admin = tipoSelecionado() === "Administrativo";
  document.getElementById("blocoAdministrativo").classList.toggle("hidden", !admin);
  document.getElementById("blocoFinanceiro").classList.toggle("hidden", admin);
}
function alternarGrupo(nomeRadio, idGrupo) {
  const marcado = document.querySelector(`input[name="${nomeRadio}"]:checked`);
  document.getElementById(idGrupo).classList.toggle("hidden", !marcado || marcado.value !== "Sim");
}
function grupoAtivo(nomeRadio) {
  const marcado = document.querySelector(`input[name="${nomeRadio}"]:checked`);
  return !!marcado && marcado.value === "Sim";
}

// ─── Hospedagem (uma linha por cidade) ──────────────
// Campo que passa por mais de uma base dorme em mais de um lugar; cada
// trecho tem cidade, entrada, saída e diária própria.
function linhaHospedagem(idx, d) {
  // Linha salva vira só leitura: quem está preenchendo enxerga o que já
  // está confirmado e o que ainda falta, e o Enviar não aceita linha
  // pela metade (ver camposObrigatoriosVazios).
  const salvo = !!d.salvo;
  const trava = salvo ? "readonly" : "";
  // Datas só aceitam número: inputmode abre o teclado numérico no celular
  // e a máscara descarta qualquer outra tecla no desktop.
  const dataAttrs = `type="text" inputmode="numeric" maxlength="10" oninput="mascaraDataEl(this); calcularDiasHospedagem(this)"`;
  // Os hotéis oferecidos são os do município digitado — cadastro por
  // município existe justamente para a lista não ser o país inteiro.
  const cidade = (d.cidade || "").trim().toUpperCase();
  const doMunicipio = DB.hoteis.filter(h =>
    h.ativo !== false && (!cidade || (h.municipio || "").toUpperCase() === cidade));
  const opcoes = doMunicipio.map(h =>
    `<option value="${h.id}" ${h.id === d.hotel_id ? "selected" : ""}>${esc(h.nome)} · ${esc(h.tipo)} · ${esc(formatarMoeda(h.valor_diaria))}</option>`).join("");
  return `<div class="sol-hospedagem${salvo ? " sol-hospedagem-salva" : ""}" data-idx="${idx}" data-salvo="${salvo ? "1" : ""}">
    <input class="form-control h-cidade" placeholder="Cidade" value="${esc(d.cidade || "")}" ${trava} oninput="atualizarHoteisDaLinha(this)" />
    <select class="form-control h-hotel" ${salvo ? "disabled" : ""} onchange="aplicarHotelNaLinha(this)" title="Hotel ou pousada cadastrada no município">
      <option value="">Hotel a definir</option>${opcoes}
    </select>
    <input class="form-control h-entrada" ${dataAttrs} placeholder="Entrada 00/00/0000" value="${esc(d.entrada_texto || "")}" ${trava} />
    <input class="form-control h-saida" ${dataAttrs} placeholder="Saída 00/00/0000" value="${esc(d.saida_texto || "")}" ${trava} />
    <input class="form-control h-dias" readonly placeholder="Dia(s)" value="${esc(d.dias ?? "")}" title="Dia(s)" />
    <input class="form-control h-diaria" placeholder="Diária" value="${esc(d.diaria_texto || "")}" title="Diária prevista" ${trava} oninput="mascaraMoedaEl(this)" />
    ${salvo
      ? `<button class="btn-icon" title="Editar cidade" onclick="editarHospedagem(${idx})">${svgIcon("edit")}</button>`
      : `<button class="btn-icon btn-icon-ok" title="Salvar cidade" onclick="salvarHospedagem(${idx})">${svgIcon("check")}</button>`}
    <button class="btn-icon btn-icon-danger" title="Remover cidade" onclick="removerHospedagem(${idx})">${svgIcon("trash")}</button>
  </div>`;
}
function lerHospedagens() {
  return Array.from(document.querySelectorAll("#sHospedagens .sol-hospedagem")).map(el => ({
    cidade: el.querySelector(".h-cidade").value,
    hotel_id: el.querySelector(".h-hotel").value || null,
    entrada_texto: el.querySelector(".h-entrada").value,
    saida_texto: el.querySelector(".h-saida").value,
    dias: el.querySelector(".h-dias").value,
    diaria_texto: el.querySelector(".h-diaria").value,
    salvo: el.dataset.salvo === "1",
  }));
}

// Digitar a cidade troca a lista de hotéis. Remonta a linha inteira em
// vez de mexer no <select> na mão — o mesmo padrão das outras linhas.
let _timerHoteis = null;
function atualizarHoteisDaLinha(el) {
  clearTimeout(_timerHoteis);
  const idx = Number(el.closest(".sol-hospedagem").dataset.idx);
  const cursor = el.selectionStart;
  _timerHoteis = setTimeout(() => {
    remontarHospedagens(lerHospedagens());
    const campo = document.querySelector(`#sHospedagens .sol-hospedagem[data-idx="${idx}"] .h-cidade`);
    if (campo) { campo.focus(); campo.setSelectionRange(cursor, cursor); }
  }, 450);
}

// Escolher o hotel traz a diária combinada com a casa — é para isso que o
// cadastro existe.
function aplicarHotelNaLinha(el) {
  const linha = el.closest(".sol-hospedagem");
  const hotel = DB.hoteis.find(h => h.id === el.value);
  if (hotel) {
    linha.querySelector(".h-diaria").value = formatarNumeroBR(hotel.valor_diaria);
    if (!linha.querySelector(".h-cidade").value.trim()) {
      linha.querySelector(".h-cidade").value = hotel.municipio;
    }
  }
  atualizarSugestaoPrevisto();
}

// Salvar aqui é confirmar a linha, não gravar no banco — o pedido inteiro
// vai junto no Enviar. Serve para a pessoa ver que a cidade foi aceita e
// para as datas serem checadas na hora, e não só no fim.
function salvarHospedagem(idx) {
  const linhas = lerHospedagens();
  const l = linhas[idx];
  if (!l) return;
  const entrada = dataBRparaISO(l.entrada_texto);
  const saida   = dataBRparaISO(l.saida_texto);
  if (!l.cidade.trim())      { mostrarToast("Informe a cidade da hospedagem.", "err"); return; }
  if (!entrada || !saida)    { mostrarToast("Preencha entrada e saída no formato 00/00/0000.", "err"); return; }
  if (new Date(saida) < new Date(entrada)) {
    mostrarToast("A saída não pode ser antes da entrada.", "err");
    return;
  }
  l.salvo = true;
  remontarHospedagens(linhas);
  atualizarSugestaoPrevisto();
  mostrarToast(`${l.cidade.trim().toUpperCase()} salva · ${l.dias || 0} dia(s).`, "ok");
}
function editarHospedagem(idx) {
  const linhas = lerHospedagens();
  if (!linhas[idx]) return;
  linhas[idx].salvo = false;
  remontarHospedagens(linhas);
}
function remontarHospedagens(linhas) {
  document.getElementById("sHospedagens").innerHTML = linhas.map((d, i) => linhaHospedagem(i, d)).join("");
}
function adicionarHospedagem(d) {
  const linhas = lerHospedagens();
  linhas.push(d || { cidade: "", hotel_id: null, entrada_texto: "", saida_texto: "", dias: "", diaria_texto: "" });
  remontarHospedagens(linhas);
}
function removerHospedagem(idx) {
  remontarHospedagens(lerHospedagens().filter((_, i) => i !== idx));
}
// Dia(s) sai da diferença entre entrada e saída — na planilha é digitado
// à mão, e digitado à mão diverge.
function calcularDiasHospedagem(el) {
  const linha = el.closest(".sol-hospedagem");
  if (!linha) return;
  const entrada = dataBRparaISO(linha.querySelector(".h-entrada").value);
  const saida   = dataBRparaISO(linha.querySelector(".h-saida").value);
  const campo   = linha.querySelector(".h-dias");
  if (!entrada || !saida) { campo.value = ""; return; }
  const dias = Math.round((new Date(saida) - new Date(entrada)) / 86400000);
  campo.value = dias >= 0 ? dias : "";
}

// ─── Equipamentos ───────────────────────────────────
//
// O que a lista oferece é a disponibilidade NAS DATAS DO CAMPO, e não o
// saldo do estoque. São coisas diferentes: um medidor que está na
// prateleira hoje pode já estar comprometido com outro campo na semana
// que vem, e é justamente esse cruzamento que a reserva resolve.
//
// Enquanto o período não estiver preenchido, cai no saldo do estoque com
// aviso na tela — melhor oferecer algo do que travar o formulário.
function disponibilidadeDoItem(itemId) {
  const linha = (DB.disponibilidade.itens || []).find(i => i.item_id === itemId);
  if (linha) return linha;
  const cat = DB.catalogo.find(c => c.id === itemId);
  if (!cat) return null;
  return {
    item_id: cat.id, codigo: cat.codigo, produto: cat.produto,
    estoque_atual: cat.estoque_atual, em_manutencao: cat.em_manutencao,
    comprometido: null, disponivel: cat.em_manutencao ? 0 : cat.estoque_atual,
  };
}

function linhaEquipamento(idx, d) {
  const temPeriodo = !!DB.disponibilidade.inicio;
  const base = (DB.disponibilidade.itens || []).length ? DB.disponibilidade.itens : DB.catalogo.map(c => disponibilidadeDoItem(c.id));
  const opcoes = base.filter(Boolean).map(c => {
    const rotulo = c.em_manutencao
      ? "em manutenção"
      : temPeriodo
        ? `${c.disponivel} disponível${c.disponivel === 1 ? "" : "s"} no período`
        : `saldo ${c.estoque_atual}`;
    // Item indisponível continua na lista, desabilitado: quem pede
    // precisa saber que o item existe e por que não pode levar.
    const bloqueado = c.disponivel <= 0 && c.item_id !== d.item_id;
    return `<option value="${c.item_id}" ${c.item_id === d.item_id ? "selected" : ""} ${bloqueado ? "disabled" : ""}>${esc(c.produto)} · ${esc(c.codigo)} (${rotulo})</option>`;
  }).join("");
  const disp = d.item_id ? disponibilidadeDoItem(d.item_id) : null;
  const excede = disp && (Number(d.quantidade) || 1) > disp.disponivel;
  return `<div class="sol-linha sol-linha-equip${excede ? " sol-linha-excede" : ""}" data-idx="${idx}">
    <select class="form-control sol-item" onchange="remontarEquipamentos(lerEquipamentos())"><option value="">Selecione o equipamento no estoque</option>${opcoes}</select>
    <input class="form-control sol-qtd" type="number" min="1" value="${d.quantidade || 1}" title="Quantidade" oninput="conferirLinhaEquipamento(this)" />
    <span class="sol-disp" title="Disponível nas datas do campo">${disp ? `${disp.disponivel} disp.` : "—"}</span>
    <button class="btn-icon btn-icon-danger" title="Remover" onclick="removerEquipamento(${idx})">${svgIcon("trash")}</button>
  </div>`;
}
function lerEquipamentos() {
  return Array.from(document.querySelectorAll("#sEquipamentos .sol-linha")).map(el => ({
    item_id: el.querySelector(".sol-item").value,
    quantidade: Number(el.querySelector(".sol-qtd").value) || 1,
  }));
}

// Digitar a quantidade não pode remontar a linha: o campo perderia o
// foco a cada dígito. Aqui só se repinta o aviso da própria linha —
// trocar o item, sim, remonta (o `change` do select já acabou).
function conferirLinhaEquipamento(el) {
  const linha = el.closest(".sol-linha-equip");
  if (!linha) return;
  const disp = disponibilidadeDoItem(linha.querySelector(".sol-item").value);
  const qtd = Number(el.value) || 0;
  linha.querySelector(".sol-disp").textContent = disp ? `${disp.disponivel} disp.` : "—";
  linha.classList.toggle("sol-linha-excede", !!disp && qtd > disp.disponivel);
}

// Busca no banco quanto de cada item está livre nas datas informadas. É
// uma chamada só, quando o período muda — e não uma por linha.
async function carregarDisponibilidade() {
  const inicio = dataBRparaISO(document.getElementById("sPeriodoInicio").value);
  const fim    = dataBRparaISO(document.getElementById("sPeriodoFim").value);
  const aviso  = document.getElementById("sAvisoDisponibilidade");

  atualizarDiasCampo();

  if (!inicio || !fim) {
    DB.disponibilidade = { inicio: null, fim: null, itens: [] };
    aviso.textContent = "Informe o período do campo para o sistema calcular o que está disponível nessas datas.";
    remontarEquipamentos(lerEquipamentos());
    return;
  }
  if (new Date(fim) < new Date(inicio)) {
    aviso.textContent = "O fim do período está antes do início.";
    return;
  }

  const { data, error } = await sb.rpc("itens_disponiveis_no_periodo", {
    p_inicio: inicio, p_fim: fim,
    // Ao editar, a própria solicitação não disputa consigo mesma.
    p_ignorar_solicitacao: STATE.edicaoId || null,
  });

  if (error) {
    DB.disponibilidade = { inicio: null, fim: null, itens: [] };
    aviso.textContent = tabelaNaoExiste(error)
      ? "Reserva de material indisponível: rode supabase/02_campo_v2.sql. A lista mostra o saldo do estoque, sem considerar as datas."
      : "Não foi possível calcular a disponibilidade no período; a lista mostra o saldo do estoque.";
    remontarEquipamentos(lerEquipamentos());
    return;
  }

  DB.disponibilidade = { inicio, fim, itens: data || [] };
  const comprometidos = (data || []).filter(i => (i.comprometido || 0) > 0).length;
  aviso.textContent = `Disponibilidade de ${dataISOparaBR(inicio)} a ${dataISOparaBR(fim)}`
    + (comprometidos ? ` · ${comprometidos} item(ns) já comprometido(s) com outros campos nessas datas.` : " · nada comprometido com outros campos.");
  remontarEquipamentos(lerEquipamentos());
  atualizarSugestaoPrevisto();
}

// Dias de campo: base do previsto (veículo/dia, hotel/dia, alimentação
// por pessoa/dia). Conta as duas pontas — campo de segunda a segunda são
// oito dias de diária, não sete.
function diasDeCampo() {
  const inicio = dataBRparaISO(document.getElementById("sPeriodoInicio").value);
  const fim    = dataBRparaISO(document.getElementById("sPeriodoFim").value);
  if (!inicio || !fim) return 0;
  const dias = Math.round((new Date(fim) - new Date(inicio)) / 86400000) + 1;
  return dias > 0 ? dias : 0;
}
function atualizarDiasCampo() {
  const dias = diasDeCampo();
  document.getElementById("sDiasCampo").value = dias ? `${dias} dia(s)` : "";
}
function remontarEquipamentos(linhas) {
  document.getElementById("sEquipamentos").innerHTML = linhas.map((d, i) => linhaEquipamento(i, d)).join("");
}
function adicionarEquipamento(d) {
  const linhas = lerEquipamentos();
  linhas.push(d || { item_id: "", quantidade: 1 });
  remontarEquipamentos(linhas);
}
function removerEquipamento(idx) {
  remontarEquipamentos(lerEquipamentos().filter((_, i) => i !== idx));
}

// ─── Despesas com prestação de contas ───────────────
function linhaDespesa(grupo, idx, d) {
  return `<div class="sol-linha sol-linha-despesa" data-idx="${idx}">
    <input class="form-control sol-descricao" placeholder="Descrição" value="${esc(d.descricao || "")}" />
    <input class="form-control sol-valor" placeholder="0,00" value="${esc(d.valor_texto || "")}" oninput="mascaraMoedaEl(this); atualizarTotais()" />
    <button class="btn-icon btn-icon-danger" title="Remover" onclick="removerDespesa('${grupo}', ${idx})">${svgIcon("trash")}</button>
  </div>`;
}
function containerDoGrupo(grupo) {
  const g = GRUPOS_DESPESA.find(x => x.nome === grupo);
  return g ? document.getElementById(g.container) : null;
}
function lerDespesas(grupo) {
  const el = containerDoGrupo(grupo);
  if (!el) return [];
  return Array.from(el.querySelectorAll(".sol-linha")).map(l => ({
    descricao: l.querySelector(".sol-descricao").value,
    valor_texto: l.querySelector(".sol-valor").value,
  }));
}
function remontarDespesas(grupo, linhas) {
  const el = containerDoGrupo(grupo);
  if (el) el.innerHTML = linhas.map((d, i) => linhaDespesa(grupo, i, d)).join("");
}
function adicionarDespesa(grupo, d) {
  const linhas = lerDespesas(grupo);
  linhas.push(d || { descricao: "", valor_texto: "" });
  remontarDespesas(grupo, linhas);
  atualizarTotais();
}
function removerDespesa(grupo, idx) {
  remontarDespesas(grupo, lerDespesas(grupo).filter((_, i) => i !== idx));
  atualizarTotais();
}

// ─── Diárias de alimentação ─────────────────────────
//
// O valor vem da tabela de referência (R$ 55,00 com pernoite, R$ 35,00
// sem) e é preenchido sozinho ao escolher o tipo. Continua editável: o
// caso excepcional existe, e travar o campo faria alguém lançar a diária
// errada de propósito para caber no formulário. O que a tela faz é
// AVISAR quando o valor difere da referência, para a diferença ser
// escolhida e não acidental.
function linhaDiaria(idx, d) {
  const vinculo = d.vinculo || "Seteg";
  const tipos = diariasDoVinculo(vinculo).map(t =>
    `<option value="${esc(t.tipo_diaria)}" ${t.tipo_diaria === d.tipo_diaria ? "selected" : ""}>${esc(t.tipo_diaria)} · ${esc(formatarMoeda(t.valor))}</option>`).join("");
  const referencia = diariaPorTipo(d.tipo_diaria);
  const valor = parseMoeda(d.valor_texto);
  const foraDaReferencia = referencia && valor > 0 && Math.abs(valor - Number(referencia.valor)) > 0.001;
  return `<div class="sol-diaria${foraDaReferencia ? " sol-diaria-diverge" : ""}" data-idx="${idx}">
    <input class="form-control d-colaborador" placeholder="Colaborador (nome e sobrenome)" value="${esc(d.colaborador || "")}" list="listaEquipeAtual" />
    <select class="form-control d-vinculo" onchange="trocarVinculoDiaria(${idx}, this.value)">
      <option ${vinculo === "Seteg" ? "selected" : ""}>Seteg</option>
      <option ${vinculo === "Temporário" ? "selected" : ""}>Temporário</option>
    </select>
    <select class="form-control d-tipo" onchange="aplicarReferenciaDiaria(${idx}, this.value)">${tipos}</select>
    <input class="form-control d-dias" type="number" min="0" value="${d.dias || 0}" title="Dias" oninput="atualizarTotais()" />
    <input class="form-control d-valor" placeholder="0,00" value="${esc(d.valor_texto || "")}" title="${foraDaReferencia ? `Fora da referência de ${formatarMoeda(referencia.valor)}` : "Valor da diária"}" oninput="mascaraMoedaEl(this); atualizarTotais()" />
    <input class="form-control d-banco" placeholder="Dados bancários / PIX" value="${esc(d.dados_bancarios || "")}" />
    <button class="btn-icon btn-icon-danger" title="Remover" onclick="removerDiaria(${idx})">${svgIcon("trash")}</button>
  </div>`;
}

// Trocar o tipo traz o valor de referência daquele tipo.
function aplicarReferenciaDiaria(idx, tipo) {
  const linhas = lerDiarias();
  if (!linhas[idx]) return;
  const referencia = diariaPorTipo(tipo);
  linhas[idx].tipo_diaria = tipo;
  if (referencia) linhas[idx].valor_texto = formatarNumeroBR(referencia.valor);
  remontarDiarias(linhas);
  atualizarTotais();
}
function lerDiarias() {
  return Array.from(document.querySelectorAll("#sDiarias .sol-diaria")).map(el => ({
    colaborador: el.querySelector(".d-colaborador").value,
    vinculo: el.querySelector(".d-vinculo").value,
    tipo_diaria: el.querySelector(".d-tipo").value,
    dias: Number(el.querySelector(".d-dias").value) || 0,
    valor_texto: el.querySelector(".d-valor").value,
    dados_bancarios: el.querySelector(".d-banco").value,
  }));
}
function remontarDiarias(linhas) {
  document.getElementById("sDiarias").innerHTML = linhas.map((d, i) => linhaDiaria(i, d)).join("");
}
function adicionarDiaria(d) {
  const linhas = lerDiarias();
  if (d) {
    linhas.push(d);
  } else {
    // Diária nova nasce com o tipo e o valor de referência já preenchidos,
    // e com os dias do campo — é o caso normal, e redigitar isso a cada
    // colaborador é o que fazia a planilha ser lenta.
    const padrao = diariasDoVinculo("Seteg")[0];
    linhas.push({
      colaborador: "", vinculo: "Seteg",
      tipo_diaria: padrao ? padrao.tipo_diaria : "",
      dias: diasDeCampo(),
      valor_texto: padrao ? formatarNumeroBR(padrao.valor) : "",
      dados_bancarios: "",
    });
  }
  remontarDiarias(linhas);
  atualizarTotais();
}
function removerDiaria(idx) {
  remontarDiarias(lerDiarias().filter((_, i) => i !== idx));
  atualizarTotais();
}
// Trocar o vínculo troca a lista de diárias possíveis (a planilha tem
// tabelas de valor diferentes para Seteg e temporário).
function trocarVinculoDiaria(idx, vinculo) {
  const linhas = lerDiarias();
  if (!linhas[idx]) return;
  const padrao = diariasDoVinculo(vinculo)[0];
  linhas[idx].vinculo = vinculo;
  linhas[idx].tipo_diaria = padrao ? padrao.tipo_diaria : "";
  if (padrao) linhas[idx].valor_texto = formatarNumeroBR(padrao.valor);
  remontarDiarias(linhas);
  atualizarTotais();
}

// Subtotais por grupo, total das despesas, total das diárias e total
// geral — os mesmos somatórios que a planilha faz por fórmula.
function atualizarTotais() {
  let totalDespesas = 0;
  GRUPOS_DESPESA.forEach(g => {
    const soma = lerDespesas(g.nome).reduce((t, d) => t + parseMoeda(d.valor_texto), 0);
    totalDespesas += soma;
    const alvo = document.getElementById(g.preview);
    if (alvo) alvo.textContent = formatarMoeda(soma);
  });
  const totalDiarias = lerDiarias().reduce((t, d) => t + d.dias * parseMoeda(d.valor_texto), 0);
  document.getElementById("previewTotalDespesas").textContent = formatarMoeda(totalDespesas);
  document.getElementById("previewTotalDiarias").textContent  = formatarMoeda(totalDiarias);
  document.getElementById("previewTotalGeral").textContent    = formatarMoeda(totalDespesas + totalDiarias);
  atualizarSugestaoPrevisto();
}

// ══════════════════════════════════════════════════════
//  FORMULÁRIO — EQUIPE, EPIs, SST E PREVISTO × REAL
//
//  Os quatro blocos que o formulário em papel não tinha. Seguem o mesmo
//  padrão dos outros: o estado mora no DOM, e estas funções leem e
//  remontam sem perder o que já foi digitado.
// ══════════════════════════════════════════════════════

// ─── Equipe ─────────────────────────────────────────
function linhaEquipe(idx, d) {
  return `<div class="sol-equipe" data-idx="${idx}">
    <input class="form-control eq-nome" placeholder="Nome e sobrenome" value="${esc(d.colaborador || "")}" list="listaNomesTecnicos" oninput="aplicarClockifyDaEquipe(this)" />
    <input class="form-control eq-funcao" placeholder="Função em campo" value="${esc(d.funcao || "")}" />
    <select class="form-control eq-vinculo">
      <option ${(d.vinculo || "Seteg") === "Seteg" ? "selected" : ""}>Seteg</option>
      <option ${d.vinculo === "Temporário" ? "selected" : ""}>Temporário</option>
    </select>
    <input class="form-control eq-clockify" placeholder="Clockify" value="${esc(d.codigo_clockify || "")}" />
    <input class="form-control eq-telefone" placeholder="Telefone" value="${esc(d.telefone || "")}" />
    <label class="conf-check" title="O líder informa o previsto e assina como prestador">
      <input type="radio" name="eqLider" class="eq-lider" ${d.lider ? "checked" : ""} onclick="marcarLider(${idx})" /> Líder
    </label>
    <button class="btn-icon btn-icon-danger" title="Remover" onclick="removerEquipe(${idx})">${svgIcon("trash")}</button>
  </div>`;
}
function lerEquipe() {
  return Array.from(document.querySelectorAll("#sEquipe .sol-equipe")).map(el => ({
    colaborador: el.querySelector(".eq-nome").value,
    funcao: el.querySelector(".eq-funcao").value,
    vinculo: el.querySelector(".eq-vinculo").value,
    codigo_clockify: el.querySelector(".eq-clockify").value,
    telefone: el.querySelector(".eq-telefone").value,
    lider: el.querySelector(".eq-lider").checked,
  }));
}
function remontarEquipe(linhas) {
  document.getElementById("sEquipe").innerHTML = linhas.map((d, i) => linhaEquipe(i, d)).join("");
  atualizarListaEquipeAtual();
}
function adicionarEquipe(d) {
  const linhas = lerEquipe();
  // A primeira pessoa da equipe é o líder por padrão: pedido de uma
  // pessoa só não tem por que exigir a marcação.
  linhas.push(d || { colaborador: "", funcao: "", vinculo: "Seteg", codigo_clockify: "", telefone: "", lider: linhas.length === 0 });
  remontarEquipe(linhas);
  atualizarSugestaoPrevisto();
}
function removerEquipe(idx) {
  const restantes = lerEquipe().filter((_, i) => i !== idx);
  // Tirar o líder deixaria a equipe sem quem assina — o primeiro assume.
  if (restantes.length && !restantes.some(e => e.lider)) restantes[0].lider = true;
  remontarEquipe(restantes);
  atualizarSugestaoPrevisto();
}
function marcarLider(idx) {
  const linhas = lerEquipe().map((e, i) => ({ ...e, lider: i === idx }));
  remontarEquipe(linhas);
}
// Nome conhecido da aba TECNICOS traz o código Clockify.
function aplicarClockifyDaEquipe(el) {
  const nome = el.value.trim().toUpperCase();
  const tecnico = TECNICOS.find(t => t.nome === nome);
  if (!tecnico) return;
  const linha = el.closest(".sol-equipe");
  const campo = linha.querySelector(".eq-clockify");
  if (!campo.value.trim()) campo.value = tecnico.codigo;
}
// As diárias sugerem os nomes de quem está na equipe: são as mesmas
// pessoas, e digitar duas vezes é onde o nome sai diferente.
function atualizarListaEquipeAtual() {
  const nomes = lerEquipe().map(e => e.colaborador.trim()).filter(Boolean);
  const lista = document.getElementById("listaEquipeAtual");
  if (lista) lista.innerHTML = nomes.map(n => `<option value="${esc(n)}"></option>`).join("");
}

// ─── EPIs ───────────────────────────────────────────
function linhaEpi(idx, d) {
  return `<div class="sol-epi" data-idx="${idx}">
    <input class="form-control epi-nome" placeholder="EPI" value="${esc(d.epi || "")}" list="listaEpis" />
    <input class="form-control epi-qtd" type="number" min="1" value="${d.quantidade || 1}" title="Quantidade" />
    <input class="form-control epi-ca" placeholder="CA" value="${esc(d.ca || "")}" title="Certificado de Aprovação" />
    <label class="conf-check"><input type="checkbox" class="epi-conf" ${d.conferido ? "checked" : ""} /> Conferido</label>
    <button class="btn-icon btn-icon-danger" title="Remover" onclick="removerEpi(${idx})">${svgIcon("trash")}</button>
  </div>`;
}
function lerEpis() {
  return Array.from(document.querySelectorAll("#sEpis .sol-epi")).map(el => ({
    epi: el.querySelector(".epi-nome").value,
    quantidade: Number(el.querySelector(".epi-qtd").value) || 1,
    ca: el.querySelector(".epi-ca").value,
    conferido: el.querySelector(".epi-conf").checked,
  }));
}
function remontarEpis(linhas) {
  document.getElementById("sEpis").innerHTML = linhas.map((d, i) => linhaEpi(i, d)).join("");
}
function adicionarEpi(d) {
  const linhas = lerEpis();
  linhas.push(d || { epi: "", quantidade: 1, ca: "", conferido: false });
  remontarEpis(linhas);
}
function removerEpi(idx) {
  remontarEpis(lerEpis().filter((_, i) => i !== idx));
}

// ─── SST ────────────────────────────────────────────
const SST_CHECKS = ["sSstApr", "sSstPt", "sSstDds", "sSstTreinamento", "sSstAso", "sSstEpi"];

function sstAplicavel() { return grupoAtivo("sSst"); }

// A mesma conta do banco: só é "Conforme" com a conferência inteira
// fechada. A prévia existe para quem preenche ver o resultado antes de
// salvar, como o Valor Total do estoque.
function atualizarSst() {
  const aplicavel = sstAplicavel();
  document.getElementById("grpSst").classList.toggle("hidden", !aplicavel);
  const todos = SST_CHECKS.every(id => document.getElementById(id).checked);
  const identificacao = !aplicavel ? "Não aplicável" : todos ? "Conforme" : "Pendente";
  const campo = document.getElementById("sSstIdentificacao");
  campo.value = identificacao;
  campo.className = "form-control sst-" + (identificacao === "Conforme" ? "ok" : identificacao === "Pendente" ? "pendente" : "na");
}

// ─── Previsto × Real ────────────────────────────────
const PXR_LINHAS = [
  { chave: "Veiculo",     previsto: "sPrevistoVeiculo",     real: "sRealVeiculo",     desvio: "sDesvioVeiculo" },
  { chave: "Hospedagem",  previsto: "sPrevistoHospedagem",  real: "sRealHospedagem",  desvio: "sDesvioHospedagem" },
  { chave: "Alimentacao", previsto: "sPrevistoAlimentacao", real: "sRealAlimentacao", desvio: "sDesvioAlimentacao" },
  { chave: "Outros",      previsto: "sPrevistoOutros",      real: "sRealOutros",      desvio: "sDesvioOutros" },
];

// Prévia do status de curso. A faixa de 5% é a mesma do banco — se uma
// mudar, a outra tem de mudar junto, e é por isso que TOLERANCIA_CURSO
// existe com nome.
function atualizarCurso() {
  let previsto = 0, real = 0;
  PXR_LINHAS.forEach(l => {
    const p = parseMoeda(document.getElementById(l.previsto).value);
    const r = parseMoeda(document.getElementById(l.real).value);
    previsto += p; real += r;
    const alvo = document.getElementById(l.desvio);
    if (!p && !r) { alvo.textContent = "—"; alvo.className = ""; return; }
    const d = r - p;
    alvo.textContent = `${d > 0 ? "+" : d < 0 ? "−" : ""}${formatarMoeda(Math.abs(d))}`;
    alvo.className = d > 0 ? "pxr-acima" : d < 0 ? "pxr-abaixo" : "";
  });

  document.getElementById("sPrevistoTotal").textContent = formatarMoeda(previsto);
  document.getElementById("sRealTotal").textContent     = formatarMoeda(real);

  const desvio = real - previsto;
  const alvoTotal = document.getElementById("sDesvioTotal");
  alvoTotal.textContent = previsto || real
    ? `${desvio > 0 ? "+" : desvio < 0 ? "−" : ""}${formatarMoeda(Math.abs(desvio))}`
      + (previsto ? ` (${desvio > 0 ? "+" : ""}${(desvio / previsto * 100).toFixed(1)}%)` : "")
    : "—";
  alvoTotal.className = desvio > 0 ? "pxr-acima" : desvio < 0 ? "pxr-abaixo" : "";

  const curso =
    !previsto && !real ? "Sem realizado" :
    !previsto ? "Sem previsto" :
    !real ? "Sem realizado" :
    real < previsto * (1 - TOLERANCIA_CURSO) ? "Abaixo do previsto" :
    real <= previsto * (1 + TOLERANCIA_CURSO) ? "Dentro do previsto" : "Acima do previsto";
  const alvoCurso = document.getElementById("sStatusCurso");
  alvoCurso.textContent = curso;
  alvoCurso.className = "status-badge " + cursoClass(curso);
}

// O que o cadastro do projeto sugere para este campo: veículo/dia e
// hotel/dia vezes os dias, e alimentação por pessoa/dia vezes a equipe.
// Sugestão, não imposição — quem confirma é o líder, com o botão.
function sugestaoPrevisto() {
  const dias = diasDeCampo();
  if (!dias) return null;
  const projeto = DB.projetos.find(p => p.id === document.getElementById("sProjeto").value);
  const equipe = lerEquipe().filter(e => e.colaborador.trim()).length || 1;

  const veiculoDia = projeto ? Number(projeto.previsto_veiculo_dia) || 0 : 0;

  // Hospedagem: soma o que as linhas de hospedagem já dizem (hotel
  // escolhido tem diária combinada); sem linha, cai no previsto do
  // projeto. O que está na tela ganha do cadastro — é mais específico.
  const hospedagens = lerHospedagens().filter(h => h.cidade.trim());
  const hospedagemDasLinhas = hospedagens.reduce(
    (t, h) => t + (Number(h.dias) || 0) * parseMoeda(h.diaria_texto), 0);
  const hospedagem = hospedagemDasLinhas > 0
    ? hospedagemDasLinhas
    : (projeto ? (Number(projeto.previsto_hotel_dia) || 0) * dias : 0);

  // Alimentação: o previsto do projeto, e na falta dele o valor de
  // referência da diária — com pernoite se o campo tem hospedagem, sem
  // pernoite se não tem. É essa a diferença entre R$ 55,00 e R$ 35,00.
  const temPernoite = hospedagens.length > 0 || grupoAtivo("sHospedagem");
  const alimentacaoDia = projeto && Number(projeto.previsto_alimentacao_dia) > 0
    ? Number(projeto.previsto_alimentacao_dia)
    : referenciaDiaria(temPernoite);

  return {
    veiculo: veiculoDia * dias,
    hospedagem,
    alimentacao: alimentacaoDia * dias * equipe,
    dias, equipe, temPernoite,
  };
}

// R$ 55,00 com pernoite, R$ 35,00 sem — lido da tabela do banco, com a
// constante como rede.
function referenciaDiaria(comPernoite) {
  const linha = (DB.diarias && DB.diarias.length ? DB.diarias : DIARIAS_PADRAO)
    .find(d => d.vinculo === "Seteg" && !!d.pernoite === !!comPernoite && d.ativo !== false);
  return linha ? Number(linha.valor) : (comPernoite ? DIARIA_COM_PERNOITE : DIARIA_SEM_PERNOITE);
}

function atualizarSugestaoPrevisto() {
  const alvo = document.getElementById("sSugestaoPrevisto");
  if (!alvo) return;
  const s = sugestaoPrevisto();
  if (!s) { alvo.textContent = "Informe o período"; return; }
  const total = s.veiculo + s.hospedagem + s.alimentacao;
  alvo.textContent = `${formatarMoeda(total)} · ${s.dias} dia(s) × ${s.equipe} pessoa(s)`
    + ` · diária ${formatarMoeda(referenciaDiaria(s.temPernoite))} ${s.temPernoite ? "com" : "sem"} pernoite`;
  atualizarCurso();
}

function aplicarSugestaoPrevisto() {
  const s = sugestaoPrevisto();
  if (!s) { mostrarToast("Informe o período do campo antes de aplicar a sugestão.", "err"); return; }
  document.getElementById("sPrevistoVeiculo").value     = formatarNumeroBR(s.veiculo);
  document.getElementById("sPrevistoHospedagem").value  = formatarNumeroBR(s.hospedagem);
  document.getElementById("sPrevistoAlimentacao").value = formatarNumeroBR(s.alimentacao);
  atualizarCurso();
  mostrarToast(`Previsto aplicado: ${s.dias} dia(s), ${s.equipe} pessoa(s).`, "ok");
}

// Escolher o projeto preenche o que já se sabe dele — e diz QUEM VAI
// APROVAR. Essa frase é a razão de o campo ser obrigatório: quem pede
// precisa saber de quem depende.
function aplicarProjetoNoForm() {
  const projeto = DB.projetos.find(p => p.id === document.getElementById("sProjeto").value);
  const aviso = document.getElementById("sProjetoLider");

  if (!projeto) {
    if (aviso) {
      aviso.textContent = DB.projetos.length
        ? "Escolha o projeto: é o líder dele que aprova esta solicitação."
        : "Nenhum projeto cadastrado. A Direção precisa cadastrar projeto e líder antes de abrir solicitação.";
      aviso.className = "form-hint form-hint-alerta";
    }
    atualizarSugestaoPrevisto();
    return;
  }

  document.getElementById("sClienteProjeto").value = `${projeto.cliente} | ${projeto.nome}`.toUpperCase();
  if (projeto.codigo_clockify) document.getElementById("sCodigoClockify").value = projeto.codigo_clockify;

  if (aviso) {
    const euAprovo = SESSAO && projeto.lider_id === SESSAO.id;
    if (!projeto.lider_id) {
      aviso.textContent = "Este projeto está sem líder — a Direção precisa completar o cadastro antes de alguém pedir campo nele.";
      aviso.className = "form-hint form-hint-alerta";
    } else if (euAprovo || ehDirecao()) {
      aviso.textContent = euAprovo
        ? "Você lidera este projeto: a solicitação já nasce aprovada."
        : `Líder: ${projeto.lider}. Como Direção, sua solicitação já nasce aprovada.`;
      aviso.className = "form-hint form-hint-ok";
    } else {
      aviso.textContent = `Quem aprova é ${projeto.lider}${projeto.programas ? ` · programas: ${projeto.programas}` : ""}.`;
      aviso.className = "form-hint";
    }
  }
  atualizarSugestaoPrevisto();
}

// ══════════════════════════════════════════════════════
//  FORMULÁRIO — abrir, validar, salvar
// ══════════════════════════════════════════════════════
// Campos de texto que o formulário limpa ao abrir. Ficam em lista para
// campo novo no HTML entrar aqui de uma linha só.
const CAMPOS_TEXTO_FORM = [
  "sId", "sCodigo", "sDataRecurso", "sClienteProjeto", "sCodigoClockify", "sDestino",
  "sPeriodoInicio", "sPeriodoFim", "sDiasCampo",
  "sCondutor", "sCondutorCpf", "sVeiculoDesc",
  "sLocalRetirada", "sDataRetirada", "sHoraRetirada", "sLocalEntrega", "sDataEntrega",
  "sHoraEntrega",
  "sTransporteLocadoraOutra", "sTransporteContrato", "sTransportePlaca",
  "sPrevistoVeiculo", "sPrevistoHospedagem", "sPrevistoAlimentacao", "sPrevistoOutros",
  "sRealVeiculo", "sRealHospedagem", "sRealAlimentacao", "sRealOutros",
  "sSstResponsavel", "sSstObservacao",
  "sDadosTransferencia", "sObservacao",
];

// Preenche o <select> de projetos. Só os ativos aparecem para escolha,
// mas o projeto já vinculado a um pedido antigo continua na lista mesmo
// inativo — senão editar aquele pedido perderia o vínculo em silêncio.
//
// O nome do líder vai na própria opção: quem escolhe o projeto está
// escolhendo de quem vai depender, e isso não pode ficar escondido.
function preencherSelectProjetos(idSelecionado) {
  const lista = DB.projetos.filter(p => p.ativo !== false || p.id === idSelecionado);
  document.getElementById("sProjeto").innerHTML =
    `<option value="">Selecione o projeto</option>` +
    lista.map(p => {
      const lider = p.lider ? ` · líder: ${p.lider}` : " · SEM LÍDER";
      return `<option value="${p.id}" ${p.id === idSelecionado ? "selected" : ""}>${esc(p.cliente)} | ${esc(p.nome)}${esc(lider)}${p.ativo === false ? " (inativo)" : ""}</option>`;
    }).join("");
}

function limparFormSolicitacao() {
  CAMPOS_TEXTO_FORM.forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  document.getElementById("sSolicitante").value = SESSAO ? SESSAO.nome : "";
  document.getElementById("sDataSolicitacao").value = new Date().toLocaleDateString("pt-BR");
  document.getElementById("sSetor").value = "";
  document.getElementById("sTransporteModalidade").value = "";
  document.getElementById("sTransporteLocadora").value = "";
  document.getElementById("grpLocadoraOutra").classList.add("hidden");
  document.querySelector('input[name="sTipo"][value="Administrativo"]').checked = true;
  document.querySelector('input[name="sVeiculo"][value="Não"]').checked = true;
  document.querySelector('input[name="sHospedagem"][value="Não"]').checked = true;
  document.querySelector('input[name="sSst"][value="Sim"]').checked = true;
  SST_CHECKS.forEach(id => document.getElementById(id).checked = false);
  DB.disponibilidade = { inicio: null, fim: null, itens: [] };
  aplicarTipoNoForm();
  alternarGrupo("sVeiculo", "grpVeiculo");
  alternarGrupo("sHospedagem", "grpHospedagem");
  atualizarSst();
}

function abrirFormNovaSolicitacao() {
  if (!ESTRUTURA_OK) {
    mostrarToast("O banco ainda não tem as tabelas de solicitação — rode supabase/01_solicitacoes.sql.", "err");
    return;
  }
  STATE.edicaoId = null;
  document.getElementById("formSolicitacaoTitulo").textContent = "Nova Solicitação";
  document.getElementById("btnSalvarSolicitacao").textContent = "Enviar solicitação";
  limparFormSolicitacao();
  preencherSelectProjetos(null);

  // A equipe abre com uma linha: pedido de campo sem ninguém indo a
  // campo não existe, e a primeira pessoa já nasce líder.
  remontarEquipe([{ colaborador: "", funcao: "", vinculo: "Seteg", codigo_clockify: "", telefone: "", lider: true }]);
  remontarEpis([]);
  remontarEquipamentos([{ item_id: "", quantidade: 1 }]);
  remontarHospedagens([]);
  GRUPOS_DESPESA.forEach(g => remontarDespesas(g.nome, [{ descricao: "", valor_texto: "" }]));
  remontarDiarias([]);
  atualizarTotais();
  atualizarCurso();
  document.getElementById("sAvisoDisponibilidade").textContent =
    "Informe o período do campo para o sistema calcular o que está disponível nessas datas.";
  abrirModal("formSolicitacao");
}

// ─── EDIÇÃO ─────────────────────────────────────────
//
// Editar é o mesmo formulário, carregado. Não se edita o que terminou:
// pedido Finalizado ou Cancelado é registro, e reescrever registro apaga
// a história em vez de corrigi-la.
//
// Equipamento já ENTREGUE não é apagado pela edição: ele está fisicamente
// com a equipe, e a linha é a obrigação de devolver. Por isso a edição
// reescreve só as linhas que ainda não saíram.
async function editarSolicitacao(id) {
  const s = DB.solicitacoes.find(x => x.id === id);
  if (!s) return;
  if (["Finalizada", "Cancelada"].includes(s.status)) {
    mostrarToast(`Solicitação ${s.status.toLowerCase()} não é editada — abra uma nova.`, "err");
    return;
  }

  STATE.edicaoId = id;
  fecharModal("modalDetalhe");
  limparFormSolicitacao();
  document.getElementById("formSolicitacaoTitulo").textContent = `Editar ${s.codigo || "solicitação"}`;
  document.getElementById("btnSalvarSolicitacao").textContent = "Salvar alterações";

  const set = (campoId, valor) => { const el = document.getElementById(campoId); if (el) el.value = valor ?? ""; };
  set("sId", s.id);
  set("sCodigo", s.codigo);
  set("sSolicitante", s.solicitante_nome);
  set("sDataSolicitacao", formatarData(s.criado_em));
  set("sSetor", s.setor);
  set("sDataRecurso", dataISOparaBR(s.data_recurso));
  set("sClienteProjeto", s.cliente_projeto);
  set("sCodigoClockify", s.codigo_clockify);
  set("sDestino", s.destino);
  set("sPeriodoInicio", dataISOparaBR(s.periodo_inicio));
  set("sPeriodoFim", dataISOparaBR(s.periodo_fim));
  set("sObservacao", s.observacao);
  set("sDadosTransferencia", s.dados_transferencia);
  preencherSelectProjetos(s.projeto_id);

  document.querySelector(`input[name="sTipo"][value="${s.tipo}"]`).checked = true;
  aplicarTipoNoForm();

  document.querySelector(`input[name="sVeiculo"][value="${s.veiculo_necessario ? "Sim" : "Não"}"]`).checked = true;
  alternarGrupo("sVeiculo", "grpVeiculo");
  set("sCondutor", s.veiculo_condutor);
  set("sCondutorCpf", s.veiculo_cpf);
  set("sVeiculoDesc", s.veiculo_descricao);
  set("sLocalRetirada", s.veiculo_local_retirada);
  set("sDataRetirada", dataISOparaBR(s.veiculo_data_retirada));
  set("sHoraRetirada", s.veiculo_hora_retirada);
  set("sLocalEntrega", s.veiculo_local_entrega);
  set("sDataEntrega", dataISOparaBR(s.veiculo_data_entrega));
  set("sHoraEntrega", s.veiculo_hora_entrega);
  set("sTransporteModalidade", s.transporte_modalidade);
  set("sTransporteLocadora", s.transporte_locadora);
  set("sTransporteLocadoraOutra", s.transporte_locadora_outra);
  set("sTransporteContrato", s.transporte_contrato);
  set("sTransportePlaca", s.transporte_placa);
  alternarLocadoraOutra();

  ["veiculo", "hospedagem", "alimentacao", "outros"].forEach(linha => {
    const nome = linha.charAt(0).toUpperCase() + linha.slice(1);
    set("sPrevisto" + nome, formatarNumeroBR(s["previsto_" + linha]));
    set("sReal" + nome, formatarNumeroBR(s["real_" + linha]));
  });

  document.querySelector(`input[name="sSst"][value="${s.sst_aplicavel === false ? "Não" : "Sim"}"]`).checked = true;
  document.getElementById("sSstApr").checked          = !!s.sst_apr_emitida;
  document.getElementById("sSstPt").checked           = !!s.sst_pt_emitida;
  document.getElementById("sSstDds").checked          = !!s.sst_dds_realizado;
  document.getElementById("sSstTreinamento").checked  = !!s.sst_treinamento_conferido;
  document.getElementById("sSstAso").checked          = !!s.sst_aso_conferido;
  document.getElementById("sSstEpi").checked          = !!s.sst_epi_conferido;
  set("sSstResponsavel", s.sst_responsavel);
  set("sSstObservacao", s.sst_observacao);
  atualizarSst();

  remontarEquipe((s.equipe || []).length
    ? s.equipe.map(e => ({ ...e }))
    : [{ colaborador: "", funcao: "", vinculo: "Seteg", codigo_clockify: "", telefone: "", lider: true }]);
  remontarEpis((s.epis || []).map(e => ({ ...e })));

  // Só o que ainda não saiu entra no formulário — o resto é mostrado
  // como aviso, porque a edição não pode fazê-lo desaparecer.
  const emCampo = (s.equipamentos || []).filter(e => e.entregue);
  const editaveis = (s.equipamentos || []).filter(e => !e.entregue);
  remontarEquipamentos(editaveis.length
    ? editaveis.map(e => ({ item_id: e.item_id, quantidade: e.quantidade }))
    : [{ item_id: "", quantidade: 1 }]);

  document.querySelector(`input[name="sHospedagem"][value="${(s.hospedagens || []).length ? "Sim" : "Não"}"]`).checked = true;
  alternarGrupo("sHospedagem", "grpHospedagem");
  remontarHospedagens((s.hospedagens || []).map(h => ({
    cidade: h.cidade, hotel_id: h.hotel_id,
    entrada_texto: dataISOparaBR(h.entrada), saida_texto: dataISOparaBR(h.saida),
    dias: h.dias, diaria_texto: formatarNumeroBR(h.diaria_prevista), salvo: true,
  })));

  GRUPOS_DESPESA.forEach(g => remontarDespesas(g.nome,
    (s.despesas || []).filter(d => d.grupo === g.nome)
      .map(d => ({ descricao: d.descricao, valor_texto: formatarNumeroBR(d.valor) }))));
  remontarDiarias((s.diarias || []).map(d => ({
    colaborador: d.colaborador, vinculo: d.vinculo, tipo_diaria: d.tipo_diaria,
    dias: d.dias, valor_texto: formatarNumeroBR(d.valor_unitario), dados_bancarios: d.dados_bancarios,
  })));

  atualizarTotais();
  atualizarCurso();
  abrirModal("formSolicitacao");
  await carregarDisponibilidade();

  if (emCampo.length) {
    mostrarToast(`${emCampo.length} equipamento(s) já em campo continuam no pedido e não aparecem para edição.`, "ok");
  }
}

// Locadora "Outros" exige dizer qual — sem isso o gasto por locadora não
// soma nada.
function alternarLocadoraOutra() {
  const v = document.getElementById("sTransporteLocadora").value;
  document.getElementById("grpLocadoraOutra").classList.toggle("hidden", v !== "Outros");
}

function camposObrigatoriosVazios() {
  const faltando = [];
  const exigir = (id, rotulo) => {
    const el = document.getElementById(id);
    if (el && !el.value.trim()) faltando.push(rotulo);
  };

  exigir("sSetor", "Setor");
  // O projeto é o que diz quem aprova. Sem ele o banco recusa o pedido,
  // e é melhor dizer aqui do que deixar o erro vir de lá.
  exigir("sProjeto", "Projeto");
  const projetoEscolhido = DB.projetos.find(p => p.id === document.getElementById("sProjeto").value);
  if (projetoEscolhido && !projetoEscolhido.lider_id) {
    faltando.push("Líder do projeto (a Direção precisa cadastrar)");
  }
  exigir("sDataRecurso", "Data para receber o recurso");
  exigir("sClienteProjeto", "Cliente | Projeto");
  exigir("sCodigoClockify", "Código Clockify");
  exigir("sDestino", "Destino");
  exigir("sPeriodoInicio", "Período — início");
  exigir("sPeriodoFim", "Período — fim");

  // Equipe: é o que o calendário mostra e de onde sai o previsto de
  // alimentação. Pedido de campo sem ninguém indo a campo não existe.
  const equipe = lerEquipe().filter(e => e.colaborador.trim());
  if (!equipe.length) faltando.push("Ao menos uma pessoa na equipe");
  else if (!equipe.some(e => e.lider)) faltando.push("Marcar quem é o líder da equipe");

  // Nome repetido na equipe travaria o insert na chave única, e o erro do
  // banco não diria qual nome. Melhor dizer aqui.
  const nomes = equipe.map(e => e.colaborador.trim().toUpperCase());
  const repetido = nomes.find((n, i) => nomes.indexOf(n) !== i);
  if (repetido) faltando.push(`Nome repetido na equipe (${repetido})`);

  if (sstAplicavel()) exigir("sSstResponsavel", "Responsável pela conferência de SST");

  if (tipoSelecionado() === "Administrativo") {
    if (grupoAtivo("sVeiculo")) {
      exigir("sTransporteModalidade", "Modalidade do transporte");
      if (document.getElementById("sTransporteLocadora").value === "Outros") {
        exigir("sTransporteLocadoraOutra", "Nome da locadora");
      }
      exigir("sCondutor", "Nome do condutor");
      exigir("sCondutorCpf", "CPF do condutor");
      exigir("sVeiculoDesc", "Veículo");
      exigir("sLocalRetirada", "Local de recebimento do veículo");
      exigir("sDataRetirada", "Data de retirada");
      exigir("sHoraRetirada", "Horário de retirada");
      exigir("sLocalEntrega", "Local de entrega do veículo");
      exigir("sDataEntrega", "Data de entrega");
      exigir("sHoraEntrega", "Horário de entrega");
    }
    if (grupoAtivo("sHospedagem")) {
      const hospedagens = lerHospedagens().filter(h => h.cidade.trim() || h.entrada_texto || h.saida_texto);
      if (!hospedagens.length) faltando.push("Cidade da hospedagem");
      // Linha preenchida mas não salva quase sempre é linha pela metade —
      // o botão de salvar é que confere cidade e datas.
      else if (hospedagens.some(h => !h.salvo)) faltando.push("Salvar cada cidade da hospedagem (✓)");
    }
    const equipamentos = lerEquipamentos().filter(e => e.item_id);
    // Um pedido administrativo sem nada em nenhum dos três blocos não é
    // pedido de nada.
    if (!equipamentos.length && !grupoAtivo("sVeiculo") && !grupoAtivo("sHospedagem"))
      faltando.push("Veículo, hospedagem ou equipamento");

    // Mesmo item em duas linhas soma no banco, mas confunde na tela — e o
    // "disponível" da linha passaria a mentir sobre o total pedido.
    const itens = equipamentos.map(e => e.item_id);
    const itemRepetido = itens.find((i, pos) => itens.indexOf(i) !== pos);
    if (itemRepetido) {
      const cat = DB.catalogo.find(c => c.id === itemRepetido);
      faltando.push(`Equipamento repetido (${cat ? cat.produto : "item"}) — some a quantidade numa linha só`);
    }

    // A conferência de saldo definitiva é do banco, na reserva. Aqui é só
    // para a pessoa não descobrir no Enviar o que a tela já sabia.
    const excedidos = equipamentos.filter(e => {
      const d = disponibilidadeDoItem(e.item_id);
      return d && e.quantidade > d.disponivel;
    }).map(e => {
      const d = disponibilidadeDoItem(e.item_id);
      return `${d.produto} (pedido ${e.quantidade}, disponível ${d.disponivel})`;
    });
    if (excedidos.length) faltando.push(`Material indisponível nas datas: ${excedidos.join(", ")}`);
  } else {
    const despesas = GRUPOS_DESPESA.flatMap(g => lerDespesas(g.nome)).filter(d => d.descricao.trim() || parseMoeda(d.valor_texto));
    const diarias  = lerDiarias().filter(d => d.colaborador.trim());
    if (!despesas.length && !diarias.length) faltando.push("Ao menos uma despesa ou diária");
    if (despesas.length) exigir("sDadosTransferencia", "Dados da transferência");
    if (diarias.some(d => !d.dias || !parseMoeda(d.valor_texto))) faltando.push("Dias e valor de cada diária");
  }
  return faltando;
}

async function salvarSolicitacao() {
  const faltando = camposObrigatoriosVazios();
  if (faltando.length) {
    mostrarToast(`Preencha: ${faltando.join(", ")}.`, "err");
    return;
  }

  const editando = !!STATE.edicaoId;
  const tipo = tipoSelecionado();
  const admin = tipo === "Administrativo";
  const temVeiculo = admin && grupoAtivo("sVeiculo");
  const temHospedagem = admin && grupoAtivo("sHospedagem");
  const comSst = sstAplicavel();
  const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
  const dinheiro = id => parseMoeda(val(id));
  const locadora = temVeiculo ? (val("sTransporteLocadora") || null) : null;

  const cabecalho = {
    tipo,
    setor:            val("sSetor"),
    projeto_id:       val("sProjeto") || null,
    data_recurso:     dataBRparaISO(val("sDataRecurso")) || null,
    cliente_projeto:  maiusc(val("sClienteProjeto")),
    codigo_clockify:  val("sCodigoClockify"),
    destino:          maiusc(val("sDestino")),
    periodo_inicio:   dataBRparaISO(val("sPeriodoInicio")) || null,
    periodo_fim:      dataBRparaISO(val("sPeriodoFim")) || null,
    observacao:       val("sObservacao"),

    veiculo_necessario:    temVeiculo,
    veiculo_condutor:      temVeiculo ? maiusc(val("sCondutor")) : null,
    veiculo_cpf:           temVeiculo ? val("sCondutorCpf") : null,
    veiculo_descricao:     temVeiculo ? maiusc(val("sVeiculoDesc")) : null,
    veiculo_local_retirada: temVeiculo ? maiusc(val("sLocalRetirada")) : null,
    veiculo_data_retirada:  temVeiculo ? dataBRparaISO(val("sDataRetirada")) || null : null,
    veiculo_hora_retirada:  temVeiculo ? val("sHoraRetirada") || null : null,
    veiculo_local_entrega:  temVeiculo ? maiusc(val("sLocalEntrega")) : null,
    veiculo_data_entrega:   temVeiculo ? dataBRparaISO(val("sDataEntrega")) || null : null,
    veiculo_hora_entrega:   temVeiculo ? val("sHoraEntrega") || null : null,

    transporte_modalidade:     temVeiculo ? val("sTransporteModalidade") || null : null,
    transporte_locadora:       locadora,
    transporte_locadora_outra: locadora === "Outros" ? maiusc(val("sTransporteLocadoraOutra")) : null,
    transporte_contrato:       temVeiculo ? val("sTransporteContrato") || null : null,
    transporte_placa:          temVeiculo ? maiusc(val("sTransportePlaca")) || null : null,

    hospedagem_necessaria: temHospedagem,
    dados_transferencia:   admin ? null : val("sDadosTransferencia") || null,

    previsto_veiculo:     dinheiro("sPrevistoVeiculo"),
    previsto_hospedagem:  dinheiro("sPrevistoHospedagem"),
    previsto_alimentacao: dinheiro("sPrevistoAlimentacao"),
    previsto_outros:      dinheiro("sPrevistoOutros"),
    real_veiculo:         dinheiro("sRealVeiculo"),
    real_hospedagem:      dinheiro("sRealHospedagem"),
    real_alimentacao:     dinheiro("sRealAlimentacao"),
    real_outros:          dinheiro("sRealOutros"),

    sst_aplicavel:             comSst,
    sst_apr_emitida:           comSst && document.getElementById("sSstApr").checked,
    sst_pt_emitida:            comSst && document.getElementById("sSstPt").checked,
    sst_dds_realizado:         comSst && document.getElementById("sSstDds").checked,
    sst_treinamento_conferido: comSst && document.getElementById("sSstTreinamento").checked,
    sst_aso_conferido:         comSst && document.getElementById("sSstAso").checked,
    sst_epi_conferido:         comSst && document.getElementById("sSstEpi").checked,
    sst_responsavel:           comSst ? maiusc(val("sSstResponsavel")) : null,
    sst_observacao:            comSst ? val("sSstObservacao") || null : null,
  };
  // No insert o solicitante vem do trigger; o status também. Mandar
  // status daqui seria mentira: o banco decide e ignora.
  if (!editando) {
    cabecalho.solicitante_id = SESSAO.id;
    cabecalho.solicitante_nome = SESSAO.nome;
  }

  const equipamentos = admin ? lerEquipamentos().filter(e => e.item_id) : [];
  // Guardado agora, e não lido do formulário depois: o aviso do fim é
  // montado quando o modal já fechou, e ler o <select> ali dependeria de
  // ele não ter sido remontado no meio.
  const projetoDoPedido = DB.projetos.find(p => p.id === cabecalho.projeto_id);
  const liderDoPedido = projetoDoPedido ? (projetoDoPedido.lider || "o líder do projeto") : "o líder do projeto";
  const botao = document.getElementById("btnSalvarSolicitacao");
  botao.disabled = true;
  let id = STATE.edicaoId;

  try {
    if (editando) {
      const r = await sb.from("solicitacoes").update(cabecalho).eq("id", id);
      if (r.error) throw r.error;
      // Só as linhas ainda não entregues saem: equipamento em campo é
      // obrigação de devolver, não item de formulário.
      await limparFilhas(id);
    } else {
      // O código (SC-0001) é gerado por trigger no banco, como o EST-0001
      // do estoque — dois pedidos simultâneos não recebem o mesmo número.
      const { data, error } = await sb.from("solicitacoes").insert(cabecalho).select("id").single();
      if (error) throw error;
      id = data.id;
    }

    await gravarFilhas(id, { admin, temHospedagem, equipamentos });

    // ── A RESERVA ──
    // Aqui é onde campo encosta no estoque: o material pedido fica
    // indisponível NAS DATAS deste campo. Quem confere saldo e datas é a
    // função no banco, e não esta tela — duas pessoas salvando ao mesmo
    // tempo não podem furar o estoque.
    let reservados = 0;
    if (equipamentos.length) {
      const reserva = await sb.rpc("reservar_equipamentos_solicitacao", { p_solicitacao: id });
      if (reserva.error) {
        if (!editando) await desfazerSolicitacaoNova(id, reserva.error);
        throw reserva.error;
      }
      reservados = reserva.data || 0;
    }

    fecharModal("formSolicitacao");
    STATE.edicaoId = null;
    const reserva = reservados ? ` · ${reservados} item(ns) reservado(s) no período` : "";
    if (editando) {
      mostrarToast(`Alterações salvas${reserva}.`, "ok");
    } else {
      // Quem pediu precisa saber se ainda depende de alguém. O status real
      // vem do banco (o trigger decide), não da nossa suposição.
      const nova = await sb.from("solicitacoes").select("codigo,status").eq("id", id).maybeSingle();
      const st = nova.data ? nova.data.status : null;
      const codigo = nova.data ? nova.data.codigo : "Solicitação";
      mostrarToast(
        st === "Aprovada"
          ? `${codigo} registrada e já aprovada (você lidera este projeto)${reserva}.`
          : `${codigo} registrada · aguardando aprovação de ${liderDoPedido}${reserva}.`,
        "ok");
    }
    await recarregarTudo();
  } catch (e) {
    avisarErro(e, editando ? "salvar as alterações" : "registrar a solicitação");
  } finally {
    botao.disabled = false;
  }
}

// Pedido novo cuja reserva não passou não pode ficar pela metade: ele
// aparece na lista como se estivesse combinado, sem material nenhum
// garantido.
//
// Excluir é o certo, mas só a Gestão exclui (é a política do banco, e é
// ela que impede alguém apagar pedido alheio). Quando quem está salvando
// não é da Gestão, o caminho é cancelar com o motivo — o pedido sai do
// fluxo ativo e fica dizendo por quê, em vez de virar rascunho órfão.
async function desfazerSolicitacaoNova(id, erroOriginal) {
  const excluiu = await sb.from("solicitacoes").delete().eq("id", id);
  if (!excluiu.error) return;
  const motivo = `Cancelada automaticamente: o material pedido não estava disponível nas datas do campo. ${mensagemErro(erroOriginal, "reservar o material")}`;
  const cancelou = await sb.from("solicitacoes")
    .update({ status: "Cancelada", motivo_cancelamento: motivo.slice(0, 500) }).eq("id", id);
  if (cancelou.error) console.error("não foi possível desfazer a solicitação", id, cancelou.error);
}

// Apaga as linhas-filhas que a edição reescreve. Equipamento entregue
// fica: ele está com a equipe, e a linha é a obrigação de devolver.
async function limparFilhas(id) {
  const alvos = ["solicitacao_equipe", "solicitacao_sst_epis",
                 "solicitacao_hospedagens", "solicitacao_despesas", "solicitacao_diarias"];
  for (const tabela of alvos) {
    const r = await sb.from(tabela).delete().eq("solicitacao_id", id);
    // Tabela da v2 que ainda não existe não é erro fatal aqui.
    if (r.error && !tabelaNaoExiste(r.error)) throw r.error;
  }
  const r = await sb.from("solicitacao_equipamentos").delete()
    .eq("solicitacao_id", id).eq("entregue", false);
  if (r.error) throw r.error;
}

// Grava tudo que pende do cabeçalho. Cada bloco é um insert em lote — e
// tabela da v2 ausente vira aviso, não queda.
async function gravarFilhas(id, ctx) {
  const inserir = async (tabela, linhas) => {
    if (!linhas.length) return;
    const r = await sb.from(tabela).insert(linhas);
    if (r.error) {
      if (tabelaNaoExiste(r.error)) { ESTRUTURA_V2_OK = false; return; }
      throw r.error;
    }
  };

  await inserir("solicitacao_equipe", lerEquipe()
    .filter(e => e.colaborador.trim())
    .map(e => ({
      solicitacao_id: id,
      colaborador: maiusc(e.colaborador.trim()),
      funcao: maiusc(e.funcao.trim()) || null,
      vinculo: e.vinculo,
      codigo_clockify: e.codigo_clockify.trim() || null,
      telefone: e.telefone.trim() || null,
      lider: !!e.lider,
    })));

  if (sstAplicavel()) {
    await inserir("solicitacao_sst_epis", lerEpis()
      .filter(e => e.epi.trim())
      .map(e => ({
        solicitacao_id: id, epi: maiusc(e.epi.trim()),
        quantidade: e.quantidade, ca: e.ca.trim() || null, conferido: e.conferido,
      })));
  }

  if (ctx.admin) {
    await inserir("solicitacao_equipamentos", ctx.equipamentos.map(e => ({
      solicitacao_id: id, item_id: e.item_id, quantidade: e.quantidade,
    })));

    await inserir("solicitacao_hospedagens", ctx.temHospedagem
      ? lerHospedagens().filter(h => h.salvo && h.cidade.trim()).map(h => ({
          solicitacao_id: id,
          cidade: maiusc(h.cidade.trim()),
          hotel_id: h.hotel_id || null,
          entrada: dataBRparaISO(h.entrada_texto) || null,
          saida: dataBRparaISO(h.saida_texto) || null,
          dias: Number(h.dias) || null,
          diaria_prevista: parseMoeda(h.diaria_texto),
        }))
      : []);
  } else {
    await inserir("solicitacao_despesas", GRUPOS_DESPESA.flatMap(g =>
      lerDespesas(g.nome)
        .filter(d => d.descricao.trim() || parseMoeda(d.valor_texto))
        .map(d => ({
          solicitacao_id: id, grupo: g.nome,
          descricao: maiusc(d.descricao.trim()), valor: parseMoeda(d.valor_texto),
        }))));

    await inserir("solicitacao_diarias", lerDiarias()
      .filter(d => d.colaborador.trim())
      .map(d => ({
        solicitacao_id: id,
        colaborador: maiusc(d.colaborador.trim()),
        vinculo: d.vinculo,
        tipo_diaria: d.tipo_diaria,
        dias: d.dias,
        valor_unitario: parseMoeda(d.valor_texto),
        dados_bancarios: d.dados_bancarios.trim(),
      })));
  }
}

// ══════════════════════════════════════════════════════
//  DETALHE, APROVAÇÃO E RECUSA
// ══════════════════════════════════════════════════════
function nomeEquipamento(e) {
  const cat = DB.catalogo.find(c => c.id === e.item_id);
  if (cat) return `${cat.produto} · ${cat.codigo}`;
  return e.descricao || "—";
}

function abrirDetalhe(id) {
  const s = DB.solicitacoes.find(x => x.id === id);
  if (!s) return;
  STATE.detalheId = id;
  document.getElementById("modalDetalheTitulo").textContent = `${s.codigo || "Solicitação"} · ${s.cliente_projeto || ""}`;

  const bloco = (titulo, conteudo) => conteudo
    ? `<div class="modal-subtitle">${titulo}</div>${conteudo}` : "";

  const locadoraTexto = s.transporte_locadora === "Outros"
    ? s.transporte_locadora_outra || "Outros"
    : s.transporte_locadora;

  const veiculo = s.veiculo_necessario ? `<div class="info-grid">
      <div><span>Condutor</span><strong>${esc(s.veiculo_condutor || "—")}</strong></div>
      <div><span>CPF</span><strong>${esc(s.veiculo_cpf || "—")}</strong></div>
      <div><span>Veículo</span><strong>${esc(s.veiculo_descricao || "—")}</strong></div>
      <div><span>Modalidade</span><strong>${esc(s.transporte_modalidade || "—")}</strong></div>
      <div><span>Locadora</span><strong>${esc(locadoraTexto || "—")}</strong></div>
      <div><span>Contrato / reserva</span><strong>${esc(s.transporte_contrato || "—")}</strong></div>
      <div><span>Placa</span><strong>${esc(s.transporte_placa || "—")}</strong></div>
      <div><span>Valor previsto</span><strong>${esc(formatarMoeda(s.previsto_veiculo))}</strong></div>
      <div><span>Valor REAL</span><strong>${esc(formatarMoeda(s.real_veiculo))}</strong></div>
      <div class="full"><span>Recebimento</span><strong>${esc(s.veiculo_local_retirada || "—")} · ${esc(dataISOparaBR(s.veiculo_data_retirada) || "—")} ${esc(s.veiculo_hora_retirada || "")}</strong></div>
      <div class="full"><span>Entrega</span><strong>${esc(s.veiculo_local_entrega || "—")} · ${esc(dataISOparaBR(s.veiculo_data_entrega) || "—")} ${esc(s.veiculo_hora_entrega || "")}</strong></div>
    </div>` : "";

  const equipe = (s.equipe || []).length ? `
    <div class="table-wrapper" style="box-shadow:none">
      <div class="table-scroll">
        <table class="art-table tabela-centralizada">
          <thead><tr><th>Colaborador</th><th>Função</th><th>Vínculo</th><th>Clockify</th><th>Telefone</th><th>Líder</th></tr></thead>
          <tbody>${s.equipe.map(e => `<tr>
            <td>${esc(e.colaborador)}</td>
            <td>${esc(e.funcao || "—")}</td>
            <td>${esc(e.vinculo || "—")}</td>
            <td>${esc(e.codigo_clockify || "—")}</td>
            <td>${esc(e.telefone || "—")}</td>
            <td>${e.lider ? '<span class="status-badge st-ok">Líder</span>' : marca(false)}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
    </div>` : "";

  const nomeHotel = h => {
    const hotel = DB.hoteis.find(x => x.id === h.hotel_id);
    return hotel ? `${hotel.nome} (${hotel.tipo})` : "A definir";
  };
  const hospedagem = (s.hospedagens || []).length ? `
    <div class="table-wrapper" style="box-shadow:none">
      <div class="table-scroll">
        <table class="art-table tabela-centralizada">
          <thead><tr><th>Cidade</th><th>Hotel / pousada</th><th>Entrada</th><th>Saída</th><th>Dia(s)</th><th>Diária prevista</th><th>Diária real</th><th>Total</th></tr></thead>
          <tbody>${s.hospedagens.map(h => {
            const diaria = Number(h.diaria_real ?? h.diaria_prevista) || 0;
            return `<tr>
            <td>${esc(h.cidade || "—")}</td>
            <td>${esc(nomeHotel(h))}</td>
            <td>${esc(dataISOparaBR(h.entrada) || "—")}</td>
            <td>${esc(dataISOparaBR(h.saida) || "—")}</td>
            <td>${h.dias ?? "—"}</td>
            <td>${esc(formatarMoeda(h.diaria_prevista))}</td>
            <td>${h.diaria_real == null ? "—" : esc(formatarMoeda(h.diaria_real))}</td>
            <td>${esc(formatarMoeda((Number(h.dias) || 0) * diaria))}</td>
          </tr>`; }).join("")}</tbody>
        </table>
      </div>
    </div>` : "";

  // A tabela de equipamentos mostra o quadro de conferência do papel:
  // ENT. / TESTE / DEV. / TESTE / AVARIA.
  const equipamentos = (s.equipamentos || []).length ? `
    <div class="table-wrapper" style="box-shadow:none">
      <div class="table-scroll">
        <table class="art-table tabela-centralizada">
          <thead><tr><th>Equipamento</th><th>Qtd.</th><th>Ent.</th><th>Teste</th><th>Dev.</th><th>Teste</th><th>Avaria</th></tr></thead>
          <tbody>${s.equipamentos.map(e => `<tr>
            <td>${esc(nomeEquipamento(e))}</td>
            <td>${e.quantidade || 1}</td>
            <td>${marca(e.entregue)}</td>
            <td>${marca(e.teste_entrega)}</td>
            <td>${marca(e.devolvido)}</td>
            <td>${marca(e.teste_devolucao)}</td>
            <td>${e.avaria ? '<span class="status-badge st-ruim">Sim</span>' : marca(false)}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
    </div>` : "";

  const despesas = (s.despesas || []).length ? `
    <div class="table-wrapper" style="box-shadow:none">
      <div class="table-scroll">
        <table class="art-table tabela-centralizada">
          <thead><tr><th>Grupo</th><th>Descrição</th><th>Valor</th></tr></thead>
          <tbody>${s.despesas.map(d => `<tr>
            <td>${esc(d.grupo)}</td><td>${esc(d.descricao || "—")}</td><td>${esc(formatarMoeda(d.valor))}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
    </div>` : "";

  const diarias = (s.diarias || []).length ? `
    <div class="table-wrapper" style="box-shadow:none">
      <div class="table-scroll">
        <table class="art-table tabela-centralizada">
          <thead><tr><th>Colaborador</th><th>Vínculo</th><th>Diária</th><th>Dias</th><th>Valor</th><th>Total</th><th>Dados bancários</th></tr></thead>
          <tbody>${s.diarias.map(d => `<tr>
            <td>${esc(d.colaborador)}</td>
            <td>${esc(d.vinculo)}</td>
            <td>${esc(d.tipo_diaria)}</td>
            <td>${d.dias}</td>
            <td>${esc(formatarMoeda(d.valor_unitario))}</td>
            <td>${esc(formatarMoeda((Number(d.dias) || 0) * (Number(d.valor_unitario) || 0)))}</td>
            <td>${esc(d.dados_bancarios || "—")}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
    </div>` : "";

  const conferencia = (s.entrega_data || s.devolucao_data) ? `<div class="info-grid">
      <div><span>Data da entrega</span><strong>${esc(dataISOparaBR(s.entrega_data) || "—")}</strong></div>
      <div><span>Assinaturas</span><strong>${esc(s.entrega_adm || "—")} / ${esc(s.entrega_prestador || "—")}</strong></div>
      <div><span>Data da devolução</span><strong>${esc(dataISOparaBR(s.devolucao_data) || "—")}</strong></div>
      <div><span>Assinaturas</span><strong>${esc(s.devolucao_adm || "—")} / ${esc(s.devolucao_prestador || "—")}</strong></div>
    </div>${assinaturasHtml(s)}` : "";

  // ── Reserva de material ──
  // O que este pedido tem comprometido no estoque, e em que situação. É a
  // resposta para "o medidor está reservado ou já saiu?".
  const reservas = (s.reservas || []).filter(r => r.situacao !== "Cancelada");
  const reservaHtml = reservas.length ? `
    <div class="table-wrapper" style="box-shadow:none">
      <div class="table-scroll">
        <table class="art-table tabela-centralizada">
          <thead><tr><th>Item</th><th>Qtd.</th><th>Reservado de</th><th>até</th><th>Situação</th></tr></thead>
          <tbody>${reservas.map(r => {
            const cat = DB.catalogo.find(c => c.id === r.item_id);
            return `<tr>
              <td>${esc(cat ? `${cat.produto} · ${cat.codigo}` : "Item fora do catálogo")}</td>
              <td>${r.quantidade}</td>
              <td>${esc(dataISOparaBR(r.inicio))}</td>
              <td>${esc(dataISOparaBR(r.fim))}</td>
              <td><span class="status-badge ${r.situacao === "Em campo" ? "st-info" : r.situacao === "Devolvido" ? "st-ok" : "st-perto"}">${esc(r.situacao)}</span></td>
            </tr>`; }).join("")}</tbody>
        </table>
      </div>
    </div>` : "";

  // ── SST ──
  const sstMarca = (rotulo, valor) => `<div><span>${rotulo}</span><strong>${marca(valor)}</strong></div>`;
  const sst = s.sst_aplicavel === false
    ? `<div class="info-grid"><div class="full"><span>SST</span><strong>Não aplicável a este campo</strong></div></div>`
    : `<div class="info-grid">
        ${sstMarca("APR emitida", s.sst_apr_emitida)}
        ${sstMarca("PT emitida", s.sst_pt_emitida)}
        ${sstMarca("DDS realizado", s.sst_dds_realizado)}
        ${sstMarca("Treinamentos", s.sst_treinamento_conferido)}
        ${sstMarca("ASO", s.sst_aso_conferido)}
        ${sstMarca("EPIs", s.sst_epi_conferido)}
        <div><span>Responsável</span><strong>${esc(s.sst_responsavel || "—")}</strong></div>
        <div><span>Identificação</span><strong><span class="status-badge ${SST_CLASSE[s.sst_identificacao] || "st-neutro"}">${esc(s.sst_identificacao || "—")}</span></strong></div>
        ${s.sst_observacao ? `<div class="full"><span>Observação de SST</span><strong>${esc(s.sst_observacao)}</strong></div>` : ""}
      </div>
      ${(s.epis || []).length ? `<div class="table-wrapper" style="box-shadow:none"><div class="table-scroll">
        <table class="art-table tabela-centralizada">
          <thead><tr><th>EPI</th><th>Qtd.</th><th>CA</th><th>Conferido</th></tr></thead>
          <tbody>${s.epis.map(e => `<tr>
            <td>${esc(e.epi)}</td><td>${e.quantidade}</td><td>${esc(e.ca || "—")}</td><td>${marca(e.conferido)}</td>
          </tr>`).join("")}</tbody>
        </table></div></div>` : ""}`;

  // ── Previsto × Real ──
  const linhaPxr = (rotulo, previsto, real) => {
    const p = Number(previsto) || 0, r = Number(real) || 0, d = r - p;
    return `<tr>
      <td>${rotulo}</td>
      <td>${esc(formatarMoeda(p))}</td>
      <td>${esc(formatarMoeda(r))}</td>
      <td class="${d > 0 ? "pxr-acima" : d < 0 ? "pxr-abaixo" : ""}">${p || r ? `${d > 0 ? "+" : d < 0 ? "−" : ""}${formatarMoeda(Math.abs(d))}` : "—"}</td>
    </tr>`;
  };
  const previstoReal = `
    <div class="table-wrapper" style="box-shadow:none">
      <div class="table-scroll">
        <table class="art-table tabela-centralizada">
          <thead><tr><th>Linha</th><th>Previsto</th><th>Real</th><th>Desvio</th></tr></thead>
          <tbody>
            ${linhaPxr("Veículo / transporte", s.previsto_veiculo, s.real_veiculo)}
            ${linhaPxr("Hospedagem", s.previsto_hospedagem, s.real_hospedagem)}
            ${linhaPxr("Alimentação", s.previsto_alimentacao, s.real_alimentacao)}
            ${linhaPxr("Outros", s.previsto_outros, s.real_outros)}
            <tr class="pxr-total-linha">
              <td><strong>Total</strong></td>
              <td><strong>${esc(formatarMoeda(s.previsto_total))}</strong></td>
              <td><strong>${esc(formatarMoeda(s.real_total))}</strong></td>
              <td><strong>${esc(desvioTexto(s))}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="form-preview-row">
      <div class="form-preview-item"><span>Status de curso</span><strong><span class="status-badge ${cursoClass(s.status_curso)}">${esc(s.status_curso || "—")}</span></strong></div>
      <div class="form-preview-item"><span>Faixa de tolerância</span><strong>± 5% do previsto</strong></div>
    </div>`;

  // ── Avarias com custo ──
  const avarias = (s.avarias || []).length ? `
    <div class="table-wrapper" style="box-shadow:none">
      <div class="table-scroll">
        <table class="art-table tabela-centralizada">
          <thead><tr><th>Equipamento</th><th>Gravidade</th><th>Descrição</th><th>Providência</th><th>Estimado</th><th>Real</th><th>Situação</th><th class="col-acoes">Ações</th></tr></thead>
          <tbody>${s.avarias.map(a => {
            const cat = DB.catalogo.find(c => c.id === a.item_id);
            return `<tr>
              <td>${esc(cat ? cat.produto : "—")}</td>
              <td>${esc(a.gravidade)}</td>
              <td>${esc(a.descricao)}</td>
              <td>${esc(a.providencia)}</td>
              <td>${esc(formatarMoeda(a.custo_estimado))}</td>
              <td>${a.custo_real == null ? "—" : esc(formatarMoeda(a.custo_real))}</td>
              <td><span class="status-badge ${AVARIA_CLASSE[a.situacao] || "st-neutro"}">${esc(a.situacao)}</span></td>
              <td class="table-actions"><button class="btn-icon" title="Editar avaria" onclick="abrirModalAvaria('${a.id}')">${svgIcon("edit")}</button></td>
            </tr>`; }).join("")}</tbody>
        </table>
      </div>
    </div>` : "";

  // ── Histórico ──
  const historico = (s.alteracoes || []).length ? `
    <div class="hist-lista">
      ${s.alteracoes.slice(0, 40).map(a => `<div class="hist-linha">
        <span class="hist-tipo hist-${semAcento(a.tipo)}">${esc(a.tipo)}</span>
        <strong>${esc(a.campo)}</strong>
        <span>${esc(a.de || "—")} → ${esc(a.para || "—")}</span>
        <em>${esc(formatarDataHora(a.data))} · ${esc(a.usuario_nome || "—")}</em>
      </div>`).join("")}
    </div>` : "";

  document.getElementById("modalDetalheBody").innerHTML = `
    <div class="info-grid">
      <div><span>Tipo</span><strong>${esc(s.tipo)}</strong></div>
      <div><span>Solicitante</span><strong>${esc(s.solicitante_nome || "—")}</strong></div>
      <div><span>Setor</span><strong>${esc(s.setor || "—")}</strong></div>
      <div><span>Data da solicitação</span><strong>${esc(formatarData(s.criado_em))}</strong></div>
      <div><span>Recurso até</span><strong>${esc(dataISOparaBR(s.data_recurso) || "—")}</strong></div>
      <div><span>Código Clockify</span><strong>${esc(s.codigo_clockify || "—")}</strong></div>
      <div><span>Destino</span><strong>${esc(s.destino || "—")}</strong></div>
      <div><span>Período</span><strong>${esc(periodoTexto(s))}</strong></div>
      <div><span>Status</span><strong><span class="status-badge ${statusClass(s.status)}">${esc(s.status || "—")}</span></strong></div>
      <div><span>Status de curso</span><strong><span class="status-badge ${cursoClass(s.status_curso)}">${esc(s.status_curso || "—")}</span></strong></div>
      <div><span>Previsto × Real</span><strong>${esc(formatarMoeda(s.previsto_total))} × ${esc(formatarMoeda(s.real_total))}</strong></div>
      ${s.tipo === "Financeiro" ? `<div><span>Solicitado no financeiro</span><strong>${esc(formatarMoeda(totalSolicitacao(s)))}</strong></div>` : ""}
      <div><span>Projeto cadastrado</span><strong>${esc(nomeProjeto(s))}</strong></div>
      <div><span>Quem aprova</span><strong>${esc(liderDaSolicitacao(s))}</strong></div>
      ${s.aprovado_em ? `<div><span>Aprovada em</span><strong>${esc(formatarDataHora(s.aprovado_em))}${esc(nomePorId(s.aprovado_por) ? ` · ${nomePorId(s.aprovado_por)}` : "")}</strong></div>` : ""}
      ${s.logistica_em ? `<div><span>Logística confirmada em</span><strong>${esc(formatarDataHora(s.logistica_em))}</strong></div>` : ""}
      ${s.motivo_recusa ? `<div class="full"><span>Motivo da recusa (líder)</span><strong>${esc(s.motivo_recusa)}</strong></div>` : ""}
      ${s.dados_transferencia ? `<div class="full"><span>Dados da transferência</span><strong>${esc(s.dados_transferencia)}</strong></div>` : ""}
      ${s.observacao ? `<div class="full"><span>Observação</span><strong>${esc(s.observacao)}</strong></div>` : ""}
      ${s.logistica_obs ? `<div class="full"><span>Observação da logística</span><strong>${esc(s.logistica_obs)}</strong></div>` : ""}
      ${s.motivo_cancelamento ? `<div class="full"><span>Motivo do cancelamento</span><strong>${esc(s.motivo_cancelamento)}</strong></div>` : ""}
    </div>
    ${bloco("Equipe de campo", equipe)}
    ${bloco("1 · Veículo e transporte", veiculo)}
    ${bloco("2 · Hospedagem", hospedagem)}
    ${bloco("3 · Equipamento para campo", equipamentos)}
    ${bloco("Material reservado no estoque", reservaHtml)}
    ${bloco("SST · conferência de segurança", sst)}
    ${bloco("Previsto × Real", previstoReal)}
    ${bloco("Despesas com prestação de contas", despesas)}
    ${bloco("Alimentação (mediante recibo)", diarias)}
    ${bloco("Conferência", conferencia)}
    ${bloco("Avarias", avarias)}
    ${bloco("Histórico de alterações", historico)}`;

  // Editar e acrescentar valem enquanto o pedido está andando. Pedido
  // finalizado, cancelado ou recusado é registro: não se reescreve.
  const emAndamento = !["Finalizada", "Cancelada", "Recusada"].includes(s.status);
  document.getElementById("btnEditarPedido").classList.toggle("hidden", !emAndamento);
  document.getElementById("btnAcrescentar").classList.toggle("hidden", !emAndamento);
  document.getElementById("btnCancelarPedido").classList.toggle("hidden", !emAndamento);

  // Aprovar/recusar aparece só para o líder DESTE projeto (ou Direção), e
  // só enquanto há decisão pendente.
  const decidir = podeAprovar(s);
  document.getElementById("btnAprovarPedido").classList.toggle("hidden", !decidir);
  document.getElementById("btnRecusarPedido").classList.toggle("hidden", !decidir);
  abrirModal("modalDetalhe");
}

// Nome do projeto cadastrado, que pode diferir do texto livre em
// cliente_projeto se alguém editou um à mão.
function nomeProjeto(s) {
  const p = DB.projetos.find(x => x.id === s.projeto_id);
  return p ? `${p.cliente} | ${p.nome}${p.programas ? ` · ${p.programas}` : ""}` : "— sem projeto cadastrado —";
}

// Nome de quem tem aquele id, quando dá para saber. `perfis` só traz os
// ativos: acesso desativado volta vazio, e a tela mostra só a data.
function nomePorId(id) {
  if (!id) return "";
  const p = DB.perfis.find(x => x.id === id);
  return p ? p.nome : "";
}

// As assinaturas desenhadas, quando existem. Ficam abaixo do quadro de
// conferência, junto das datas a que se referem.
function assinaturasHtml(s) {
  const lista = s.assinaturas || [];
  if (!lista.length) return "";
  const bloco = (momento, papel) => {
    const a = lista.find(x => x.momento === momento && x.papel === papel);
    if (!a) return `<div class="assin-vista assin-vazia"><span>${momento} · ${papel}</span><em>Sem assinatura registrada</em></div>`;
    return `<div class="assin-vista">
      <span>${momento} · ${papel}</span>
      <img src="${esc(a.imagem)}" alt="Assinatura de ${esc(a.nome)}" />
      <em>${esc(a.nome)} · ${esc(formatarDataHora(a.assinado_em))}</em>
    </div>`;
  };
  return `<div class="assin-vistas">
    ${bloco("Retirada", "Administrativo")}${bloco("Retirada", "Prestador")}
    ${bloco("Devolução", "Administrativo")}${bloco("Devolução", "Prestador")}
  </div>`;
}
function marca(v) { return v ? '<span class="status-badge st-ok">✓</span>' : '<span class="mov-autor">( )</span>'; }

// ══════════════════════════════════════════════════════
//  APROVAÇÃO DO LÍDER
//
//  Quem decide é o líder do projeto escolhido na solicitação (ou a
//  Direção). Quem confere isso é a função no banco — esta tela só
//  esconde os botões de quem não pode, e a diferença importa: esconder
//  botão não é permissão.
// ══════════════════════════════════════════════════════
async function aprovarPedido(id) {
  const s = DB.solicitacoes.find(x => x.id === id);
  if (!s) return;
  if (!podeAprovar(s)) {
    mostrarToast("Só o líder do projeto (ou a Direção) aprova esta solicitação.", "err");
    return;
  }
  try {
    const { data, error } = await sb.rpc("aprovar_solicitacao_lider", {
      p_solicitacao: id, p_aprovar: true, p_motivo: null,
    });
    if (error) throw error;
    fecharModal("modalDetalhe");
    mostrarToast(`${(data && data.codigo) || "Solicitação"} aprovada. Segue para a logística.`, "ok");
    await recarregarTudo();
  } catch (e) {
    avisarErro(e, "aprovar a solicitação");
  }
}

function abrirModalRecusa(id) {
  const s = DB.solicitacoes.find(x => x.id === id);
  if (!s) return;
  if (!podeAprovar(s)) {
    mostrarToast("Só o líder do projeto (ou a Direção) recusa esta solicitação.", "err");
    return;
  }
  STATE.recusaAlvo = id;
  document.getElementById("recMotivo").value = "";
  document.getElementById("recusaContexto").innerHTML = `
    <div><span>Solicitação</span><strong>${esc(s.codigo || "—")}</strong></div>
    <div><span>Solicitante</span><strong>${esc(s.solicitante_nome || "—")}</strong></div>
    <div><span>Projeto</span><strong>${esc(s.cliente_projeto || "—")}</strong></div>
    <div><span>Período</span><strong>${esc(periodoTexto(s))}</strong></div>
    <div><span>Equipe</span><strong>${esc(equipeResumo(s))}</strong></div>
    <div><span>Previsto</span><strong>${esc(formatarMoeda(s.previsto_total))}</strong></div>`;
  abrirModal("modalRecusa");
}

async function confirmarRecusa() {
  const motivo = document.getElementById("recMotivo").value.trim();
  if (!motivo) { mostrarToast("Escreva o motivo da recusa.", "err"); return; }
  const botao = document.getElementById("btnConfirmarRecusa");
  botao.disabled = true;
  try {
    const { data, error } = await sb.rpc("aprovar_solicitacao_lider", {
      p_solicitacao: STATE.recusaAlvo, p_aprovar: false, p_motivo: motivo,
    });
    if (error) throw error;
    fecharModal("modalRecusa");
    fecharModal("modalDetalhe");
    const soltas = (data && data.liberadas) || 0;
    mostrarToast(`${(data && data.codigo) || "Solicitação"} recusada${soltas ? ` · ${soltas} reserva(s) liberada(s)` : ""}.`, "ok");
    await recarregarTudo();
  } catch (e) {
    avisarErro(e, "recusar a solicitação");
  } finally {
    botao.disabled = false;
  }
}

// ─── CANCELAMENTO ───────────────────────────────────
//
// Substituiu a recusa. A diferença não é só de nome: recusar era negar um
// pedido antes de ele valer; cancelar é desfazer um pedido que já valia.
// Por isso cancelar SOLTA A RESERVA — o material volta a ficar disponível
// naquelas datas, e outro campo pode usá-lo.
function abrirModalCancelamento(id) {
  const s = DB.solicitacoes.find(x => x.id === id);
  if (!s) return;
  if (["Finalizada", "Cancelada"].includes(s.status)) {
    mostrarToast(`Solicitação já está ${s.status.toLowerCase()}.`, "err");
    return;
  }
  STATE.cancelamentoAlvo = id;
  document.getElementById("cancMotivo").value = "";
  abrirModal("modalCancelamento");
}

async function confirmarCancelamento() {
  const motivo = document.getElementById("cancMotivo").value.trim();
  if (!motivo) { mostrarToast("Escreva o motivo do cancelamento.", "err"); return; }
  const id = STATE.cancelamentoAlvo;

  const botao = document.getElementById("btnConfirmarCancelamento");
  botao.disabled = true;
  try {
    // A reserva sai primeiro. Se o cancelamento falhasse depois, o pior
    // caso é material livre num pedido cancelado — e não material preso
    // num pedido que não existe mais.
    const liberou = await sb.rpc("liberar_reservas_solicitacao", { p_solicitacao: id });
    if (liberou.error && !tabelaNaoExiste(liberou.error)) throw liberou.error;

    const { error } = await sb.from("solicitacoes")
      .update({ status: "Cancelada", motivo_cancelamento: motivo }).eq("id", id);
    if (error) throw error;

    fecharModal("modalCancelamento");
    fecharModal("modalDetalhe");
    const soltas = liberou.data || 0;
    mostrarToast(`Solicitação cancelada${soltas ? ` · ${soltas} reserva(s) liberada(s)` : ""}.`, "ok");
    await recarregarTudo();
  } catch (e) {
    avisarErro(e, "cancelar a solicitação");
  } finally {
    botao.disabled = false;
  }
}

// ─── ACRÉSCIMO DE EQUIPAMENTO ───────────────────────
//
// Acrescentar material a um pedido aberto não é editar: é pedir material
// novo, e material novo disputa as datas como qualquer outro. Quem
// confere é a função no banco, na mesma transação — se não couber, nada
// é gravado.
function abrirModalAcrescimo(id) {
  const s = DB.solicitacoes.find(x => x.id === id);
  if (!s) return;
  STATE.acrescimoAlvo = id;

  const inicio = s.periodo_inicio, fim = s.periodo_fim;
  document.getElementById("acrQtd").value = 1;
  document.getElementById("acrItem").innerHTML =
    `<option value="">Selecione no estoque</option>` +
    DB.catalogo.map(c => `<option value="${c.id}">${esc(c.produto)} · ${esc(c.codigo)} (saldo ${c.estoque_atual})</option>`).join("");
  document.getElementById("acrAviso").textContent = inicio && fim
    ? `O acréscimo é reservado de ${dataISOparaBR(inicio)} a ${dataISOparaBR(fim)}. Se não couber, o sistema diz o que falta e nada é gravado.`
    : "Esta solicitação não tem período definido — o acréscimo não pode ser reservado sem datas.";
  abrirModal("modalAcrescimo");
}

async function confirmarAcrescimo() {
  const item = document.getElementById("acrItem").value;
  const qtd  = Number(document.getElementById("acrQtd").value) || 0;
  if (!item) { mostrarToast("Escolha o equipamento.", "err"); return; }
  if (qtd <= 0) { mostrarToast("A quantidade precisa ser maior que zero.", "err"); return; }

  const botao = document.getElementById("btnConfirmarAcrescimo");
  botao.disabled = true;
  try {
    const { error } = await sb.rpc("acrescentar_equipamento_solicitacao", {
      p_solicitacao: STATE.acrescimoAlvo, p_item: item, p_quantidade: qtd, p_descricao: null,
    });
    if (error) throw error;
    fecharModal("modalAcrescimo");
    fecharModal("modalDetalhe");
    mostrarToast("Equipamento acrescentado e reservado no período.", "ok");
    await recarregarTudo();
  } catch (e) {
    avisarErro(e, "acrescentar o equipamento");
  } finally {
    botao.disabled = false;
  }
}

// ══════════════════════════════════════════════════════
//  CONFERÊNCIA — entrega e devolução dos equipamentos
//
//  ⚠ PONTO DA INTEGRAÇÃO COM O CONTROLE DE ESTOQUE
//
//  O formulário em papel deixa claro o formato: equipamento de campo é
//  EMPRÉSTIMO, não consumo. Sai na entrega (ENT.) e volta na devolução
//  (DEV.), com teste dos dois lados e marcação de avaria. Ou seja, a
//  integração não é uma baixa só — são duas movimentações no estoque:
//
//    entrega   → Saída  vinculada a esta solicitação
//    devolução → Entrada vinculada à mesma solicitação
//    avaria    → abre manutenção do item no Controle de Estoque
//
//  Nada disso pode ser um `update itens set estoque_atual = ...` daqui:
//  lá a movimentação nasce de trigger, e a operação precisa ser atômica
//  (dois pedidos simultâneos não podem furar o saldo) e idempotente
//  (retry de rede não pode baixar duas vezes). O desenho combinado é uma
//  função no banco, que ainda não existe.
//
//  ESTA INTEGRAÇÃO AGORA EXISTE. Quem faz é o banco, em uma transação
//  só: registrar_entrega_solicitacao() e registrar_devolucao_solicitacao()
//  (ver supabase/02_campo_v2.sql). Antes eram N chamadas daqui — marcar
//  cada item, atualizar o cabeçalho e, na intenção, baixar o estoque; cair
//  a conexão no meio deixava metade registrado.
//
//  As funções são idempotentes: reenviar a mesma conferência não baixa
//  duas vezes, porque a reserva já está 'Em campo'.
// ══════════════════════════════════════════════════════
function abrirConferenciaAuto(id) {
  const s = DB.solicitacoes.find(x => x.id === id);
  if (!s) return;
  abrirConferencia(id, s.entrega_data ? "devolucao" : "entrega");
}

function abrirConferencia(id, modo) {
  const s = DB.solicitacoes.find(x => x.id === id);
  if (!s) return;
  if (["Finalizada", "Cancelada"].includes(s.status)) {
    mostrarToast(`Solicitação ${s.status.toLowerCase()} — não há conferência a registrar.`, "err");
    return;
  }
  STATE.conferencia = { id, modo };

  const entrega = modo === "entrega";
  const momento = entrega ? "Retirada" : "Devolução";
  document.getElementById("modalConferenciaTitulo").textContent =
    `${entrega ? "Entrega" : "Devolução"} · ${s.codigo || ""}`;
  document.getElementById("lblDataConferencia").textContent = entrega ? "Data da entrega" : "Data da devolução";
  document.getElementById("cData").value = new Date().toLocaleDateString("pt-BR");
  document.getElementById("cAssinaturaAdm").value = SESSAO ? SESSAO.nome : "";
  // O prestador que assina é o líder da equipe — é ele quem responde
  // pelo material em campo.
  const lider = (s.equipe || []).find(e => e.lider);
  document.getElementById("cAssinaturaPrestador").value = lider ? lider.colaborador : "";

  document.getElementById("assinAdmRotulo").textContent = `Administrativo · ${momento}`;
  document.getElementById("assinPrestadorRotulo").textContent = `Prestador · ${momento}`;

  document.getElementById("cEquipamentos").innerHTML = (s.equipamentos || []).map(e => {
    const avariaAberta = (s.avarias || []).find(a => a.solicitacao_equipamento_id === e.id);
    return `
    <div class="conf-linha" data-id="${e.id}">
      <span class="conf-nome">${esc(nomeEquipamento(e))} <span class="mov-autor">· ${e.quantidade || 1}</span></span>
      <label class="conf-check"><input type="checkbox" class="c-marca" ${(entrega ? e.entregue : e.devolvido) ? "checked" : ""} /> ${entrega ? "Entregue" : "Devolvido"}</label>
      <label class="conf-check"><input type="checkbox" class="c-teste" ${(entrega ? e.teste_entrega : e.teste_devolucao) ? "checked" : ""} /> Teste</label>
      ${entrega ? "" : `
      <label class="conf-check"><input type="checkbox" class="c-avaria" ${e.avaria ? "checked" : ""} onchange="alternarAvariaNaLinha(this)" /> Avaria</label>
      <input class="form-control c-avaria-obs" placeholder="O que houve com o item" value="${esc(e.avaria_obs || "")}" />
      <div class="conf-avaria ${e.avaria ? "" : "hidden"}">
        <select class="form-control c-avaria-grav" title="Gravidade">
          ${["Leve", "Média", "Grave", "Perda total"].map(g =>
            `<option ${avariaAberta && avariaAberta.gravidade === g ? "selected" : ""}>${g}</option>`).join("")}
        </select>
        <input class="form-control c-avaria-custo" placeholder="Custo estimado" value="${avariaAberta ? esc(formatarNumeroBR(avariaAberta.custo_estimado)) : ""}" oninput="mascaraMoedaEl(this)" />
        <select class="form-control c-avaria-prov" title="Providência">
          ${["Em análise", "Manutenção", "Substituição", "Descarte", "Sem reparo", "Cobrança do prestador"].map(p =>
            `<option ${avariaAberta && avariaAberta.providencia === p ? "selected" : ""}>${p}</option>`).join("")}
        </select>
        <input class="form-control c-avaria-forn" placeholder="Fornecedor do reparo (abre manutenção)" value="${avariaAberta ? esc(avariaAberta.fornecedor || "") : ""}" />
      </div>`}
    </div>`; }).join("");

  document.getElementById("cAvisoEstoque").textContent = entrega
    ? "Registrar a entrega dá SAÍDA dos itens no Controle de Estoque, vinculada a esta solicitação."
    : "Registrar a devolução dá ENTRADA dos itens no Controle de Estoque. Informar o fornecedor do reparo numa avaria abre a manutenção do bem lá.";

  limparAssinatura("assinAdm");
  limparAssinatura("assinPrestador");
  abrirModal("modalConferencia");
}

// Marcar avaria abre os campos de custo: sem eles a avaria entraria no
// relatório sem a coluna pela qual o relatório existe.
function alternarAvariaNaLinha(el) {
  const linha = el.closest(".conf-linha");
  const bloco = linha.querySelector(".conf-avaria");
  if (bloco) bloco.classList.toggle("hidden", !el.checked);
}

async function salvarConferencia() {
  const { id, modo } = STATE.conferencia;
  const entrega = modo === "entrega";
  const momento = entrega ? "Retirada" : "Devolução";
  const data = dataBRparaISO(document.getElementById("cData").value);
  const adm = document.getElementById("cAssinaturaAdm").value.trim();
  const prestador = document.getElementById("cAssinaturaPrestador").value.trim();
  if (!data || !adm || !prestador) {
    mostrarToast("Preencha a data e os dois nomes.", "err");
    return;
  }

  // Assinatura desenhada é obrigatória: é ela que faz o checklist valer
  // como documento. Nome digitado sozinho prova pouco.
  const assinaturaAdm = capturarAssinatura("assinAdm");
  const assinaturaPrestador = capturarAssinatura("assinPrestador");
  if (!assinaturaAdm || !assinaturaPrestador) {
    mostrarToast("As duas assinaturas precisam ser desenhadas no quadro.", "err");
    return;
  }

  const linhas = Array.from(document.querySelectorAll("#cEquipamentos .conf-linha")).map(el => {
    const marcado = el.querySelector(".c-avaria");
    return {
      id: el.dataset.id,
      nome: el.querySelector(".conf-nome").textContent.trim(),
      marca: el.querySelector(".c-marca").checked,
      teste: el.querySelector(".c-teste").checked,
      avaria: marcado ? marcado.checked : false,
      avaria_obs: el.querySelector(".c-avaria-obs") ? el.querySelector(".c-avaria-obs").value.trim() : "",
      avaria_gravidade: el.querySelector(".c-avaria-grav") ? el.querySelector(".c-avaria-grav").value : null,
      avaria_custo: el.querySelector(".c-avaria-custo") ? parseMoeda(el.querySelector(".c-avaria-custo").value) : 0,
      avaria_providencia: el.querySelector(".c-avaria-prov") ? el.querySelector(".c-avaria-prov").value : null,
      avaria_fornecedor: el.querySelector(".c-avaria-forn") ? el.querySelector(".c-avaria-forn").value.trim() : "",
    };
  });

  // Avaria sem descrição não ajuda ninguém a cobrar conserto nem a abrir
  // manutenção depois.
  if (linhas.some(l => l.avaria && !l.avaria_obs)) {
    mostrarToast("Descreva a avaria de cada item marcado.", "err");
    return;
  }
  // Item marcado como avariado que não foi devolvido é contradição: ele
  // não voltou, então ninguém viu a avaria na conferência.
  if (linhas.some(l => l.avaria && !l.marca)) {
    mostrarToast("Item marcado com avaria precisa estar marcado como devolvido.", "err");
    return;
  }

  const botao = document.getElementById("btnSalvarConferencia");
  botao.disabled = true;
  try {
    const rpc = entrega ? "registrar_entrega_solicitacao" : "registrar_devolucao_solicitacao";
    const itens = linhas.map(l => entrega
      ? { id: l.id, entregue: l.marca, teste: l.teste }
      : {
          id: l.id, devolvido: l.marca, teste: l.teste, avaria: l.avaria,
          avaria_obs: l.avaria_obs, avaria_custo: l.avaria_custo,
          avaria_gravidade: l.avaria_gravidade, avaria_providencia: l.avaria_providencia,
          avaria_fornecedor: l.avaria_fornecedor,
        });

    const { data: resultado, error } = await sb.rpc(rpc, {
      p_solicitacao: id, p_data: data, p_adm: adm, p_prestador: prestador, p_itens: itens,
    });
    if (error) throw error;

    // A assinatura vai depois da conferência de propósito: se a
    // conferência falhar, não fica assinatura de um ato que não
    // aconteceu. Ela entra e não sai — reenvio bate na chave única, e
    // isso é o comportamento desejado.
    await gravarAssinaturas(id, momento, [
      { papel: "Administrativo", nome: adm, imagem: assinaturaAdm },
      { papel: "Prestador", nome: prestador, imagem: assinaturaPrestador },
    ]);

    fecharModal("modalConferencia");
    const pendentes = (resultado && resultado.pendentes) || [];
    if (!entrega && pendentes.length) {
      mostrarToast(`Faltou voltar: ${pendentes.join(", ")}. A solicitação segue em campo.`, "err");
    } else if (entrega) {
      mostrarToast(`Entrega registrada · ${(resultado && resultado.baixados) || 0} item(ns) com saída no estoque.`, "ok");
    } else {
      const av = (resultado && resultado.avarias) || 0;
      mostrarToast(`Devolução registrada · ${(resultado && resultado.devolvidos) || 0} item(ns) de volta no estoque${av ? ` · ${av} avaria(s) aberta(s)` : ""}.`, "ok");
    }
    await recarregarTudo();
  } catch (e) {
    avisarErro(e, "registrar a conferência");
  } finally {
    botao.disabled = false;
  }
}

// Uma assinatura por momento e papel. Conflito de chave única significa
// "já assinado" — e isso não é erro que valha interromper a conferência,
// que já foi registrada.
async function gravarAssinaturas(id, momento, assinaturas) {
  for (const a of assinaturas) {
    const r = await sb.from("solicitacao_assinaturas").insert({
      solicitacao_id: id, momento, papel: a.papel,
      nome: maiusc(a.nome), imagem: a.imagem,
    });
    if (r.error && !tabelaNaoExiste(r.error) && !/duplicate key|already exists/i.test(String(r.error.message || ""))) {
      console.warn("assinatura", a.papel, r.error);
    }
  }
}

// ══════════════════════════════════════════════════════
//  ASSINATURA DIGITAL — um <canvas> e eventos de ponteiro
//
//  Sem biblioteca: a CSP do site não abre para CDN por causa de um
//  rabisco, e o que isto faz cabe em trinta linhas. Pointer events em vez
//  de mouse+touch separados: o mesmo código serve para dedo, caneta e
//  mouse, que é o ponto — a assinatura acontece no celular, em campo.
// ══════════════════════════════════════════════════════
const _assinaturas = {};

function prepararAssinatura(idCanvas) {
  const canvas = document.getElementById(idCanvas);
  if (!canvas || canvas._pronto) return;
  const ctx = canvas.getContext("2d");
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#111";
  canvas._pronto = true;
  _assinaturas[idCanvas] = { desenhou: false };

  let desenhando = false;
  // O canvas tem tamanho fixo em pixels e é esticado por CSS; sem esta
  // conversão o traço sai deslocado do dedo.
  const ponto = e => {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height),
    };
  };

  canvas.addEventListener("pointerdown", e => {
    desenhando = true;
    canvas.setPointerCapture(e.pointerId);
    const p = ponto(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    // Um toque sem arrastar também é traço — assinatura com pingo existe.
    ctx.lineTo(p.x + 0.1, p.y);
    ctx.stroke();
    _assinaturas[idCanvas].desenhou = true;
  });
  canvas.addEventListener("pointermove", e => {
    if (!desenhando) return;
    // preventDefault mantém o gesto no quadro em vez de rolar a página —
    // é o que faz assinar no celular funcionar.
    e.preventDefault();
    const p = ponto(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  const soltar = () => { desenhando = false; };
  canvas.addEventListener("pointerup", soltar);
  canvas.addEventListener("pointercancel", soltar);
  canvas.addEventListener("pointerleave", soltar);
}

function limparAssinatura(idCanvas) {
  prepararAssinatura(idCanvas);
  const canvas = document.getElementById(idCanvas);
  if (!canvas) return;
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  _assinaturas[idCanvas] = { desenhou: false };
}

// Devolve o PNG em data URL, ou null se o quadro está em branco. O fundo
// é pintado de branco antes: PNG transparente fica invisível impresso.
function capturarAssinatura(idCanvas) {
  const canvas = document.getElementById(idCanvas);
  if (!canvas || !_assinaturas[idCanvas] || !_assinaturas[idCanvas].desenhou) return null;

  const plano = document.createElement("canvas");
  plano.width = canvas.width;
  plano.height = canvas.height;
  const ctx = plano.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, plano.width, plano.height);
  ctx.drawImage(canvas, 0, 0);
  return plano.toDataURL("image/png");
}

// ══════════════════════════════════════════════════════
//  CHECKLIST DE CAMPO
//
//  O papel que acompanha o equipamento. Sai da solicitação e é validado
//  duas vezes: na RETIRADA, conferindo o que está saindo, e na
//  DEVOLUÇÃO, depois do campo, conferindo se tudo voltou e em que
//  estado. As duas colunas ficam na mesma folha de propósito — é a
//  mesma folha que sai e volta, como no formulário em papel.
//
//  O que já foi marcado na aba Conferência vem impresso; o que ainda
//  não foi sai como quadradinho vazio para marcar à caneta.
// ══════════════════════════════════════════════════════
function caixa(marcado) {
  return marcado ? '<span class="chk-box chk-box-on">X</span>' : '<span class="chk-box"></span>';
}

function abrirChecklist(id) {
  const s = DB.solicitacoes.find(x => x.id === id);
  if (!s) return;
  if (!(s.equipamentos || []).length) {
    mostrarToast("Esta solicitação não tem equipamento para conferir.", "err");
    return;
  }

  document.getElementById("modalChecklistTitulo").textContent = `Checklist · ${s.codigo || ""}`;

  const linhas = s.equipamentos.map((e, i) => `<tr>
      <td class="chk-num">${String(i + 1).padStart(2, "0")}</td>
      <td class="chk-item">${esc(nomeEquipamento(e))}</td>
      <td>${e.quantidade || 1}</td>
      <td>${caixa(e.entregue)}</td>
      <td>${caixa(e.teste_entrega)}</td>
      <td>${caixa(e.devolvido)}</td>
      <td>${caixa(e.teste_devolucao)}</td>
      <td>${caixa(e.avaria)}</td>
      <td class="chk-obs">${esc(e.avaria_obs || "")}</td>
    </tr>`).join("");

  const hospedagens = (s.hospedagens || []).length
    ? s.hospedagens.map(h => `${h.cidade} (${dataISOparaBR(h.entrada) || "?"} a ${dataISOparaBR(h.saida) || "?"}, ${h.dias || 0}d)`).join(" · ")
    : "";

  const locadoraFolha = s.transporte_locadora === "Outros"
    ? s.transporte_locadora_outra || "Outros" : s.transporte_locadora;
  const veiculo = s.veiculo_necessario
    ? `${s.veiculo_descricao || "—"}${locadoraFolha ? ` · ${locadoraFolha}` : ""}${s.transporte_placa ? ` · placa ${s.transporte_placa}` : ""}`
      + ` · condutor ${s.veiculo_condutor || "—"} · retirada ${dataISOparaBR(s.veiculo_data_retirada) || "—"} ${s.veiculo_hora_retirada || ""} em ${s.veiculo_local_retirada || "—"}`
    : "";

  // A equipe entra na folha: é ela que confere o material na retirada e
  // responde por ele em campo.
  const equipeTexto = (s.equipe || []).length
    ? s.equipe.map(e => `${e.colaborador}${e.lider ? " (líder)" : ""}${e.funcao ? ` — ${e.funcao}` : ""}`).join(" · ")
    : "";

  // ── SST na folha ──
  // O bloco impresso é a razão de o SST estar no pedido de campo: sai
  // junto do equipamento, é conferido antes de sair e volta assinado.
  const caixaSst = (rotulo, marcado) => `<span class="chk-sst-item">${caixa(marcado)} ${rotulo}</span>`;
  const sstFolha = s.sst_aplicavel === false
    ? `<div class="chk-sst"><strong>SST</strong><p>Campo sem exigência de SST.</p></div>`
    : `<div class="chk-sst">
        <strong>SST · conferir antes de sair</strong>
        <div class="chk-sst-linha">
          ${caixaSst("APR emitida", s.sst_apr_emitida)}
          ${caixaSst("PT emitida", s.sst_pt_emitida)}
          ${caixaSst("DDS realizado", s.sst_dds_realizado)}
          ${caixaSst("Treinamentos (NR)", s.sst_treinamento_conferido)}
          ${caixaSst("ASO válido", s.sst_aso_conferido)}
          ${caixaSst("EPIs", s.sst_epi_conferido)}
        </div>
        ${(s.epis || []).length ? `<div class="chk-sst-linha">${s.epis.map(e =>
          `<span class="chk-sst-item">${caixa(e.conferido)} ${esc(e.epi)} (${e.quantidade}${e.ca ? ` · CA ${esc(e.ca)}` : ""})</span>`).join("")}</div>` : ""}
        <p>Responsável: ${esc(s.sst_responsavel || "____________________")} · Identificação: ${esc(s.sst_identificacao || "—")}
        ${s.sst_observacao ? ` · ${esc(s.sst_observacao)}` : ""}</p>
      </div>`;

  document.getElementById("checklistFolha").innerHTML = `
    <div class="chk-cabecalho">
      <img class="chk-logo" src="images/logo-seteg.svg" alt="Seteg" onerror="this.style.display='none'" />
      <div>
        <h1>Checklist de equipamento de campo</h1>
        <p>${esc(s.codigo || "")} · ${esc(s.cliente_projeto || "")}</p>
      </div>
    </div>

    <table class="chk-dados">
      <tr><th>Solicitante</th><td>${esc(s.solicitante_nome || "—")}</td><th>Setor</th><td>${esc(s.setor || "—")}</td></tr>
      <tr><th>Destino</th><td>${esc(s.destino || "—")}</td><th>Período</th><td>${esc(periodoTexto(s))}</td></tr>
      <tr><th>Código Clockify</th><td>${esc(s.codigo_clockify || "—")}</td><th>Recurso até</th><td>${esc(dataISOparaBR(s.data_recurso) || "—")}</td></tr>
      ${equipeTexto ? `<tr><th>Equipe</th><td colspan="3">${esc(equipeTexto)}</td></tr>` : ""}
      ${veiculo ? `<tr><th>Veículo</th><td colspan="3">${esc(veiculo)}</td></tr>` : ""}
      ${hospedagens ? `<tr><th>Hospedagem</th><td colspan="3">${esc(hospedagens)}</td></tr>` : ""}
    </table>

    ${sstFolha}

    <table class="chk-itens">
      <thead>
        <tr>
          <th rowspan="2">#</th><th rowspan="2">Equipamento</th><th rowspan="2">Qtd.</th>
          <th colspan="2">Retirada</th>
          <th colspan="3">Devolução</th>
          <th rowspan="2">Observação</th>
        </tr>
        <tr><th>Conf.</th><th>Teste</th><th>Conf.</th><th>Teste</th><th>Avaria</th></tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>

    <p class="chk-instrucao">
      Na retirada, marque cada item conferido e testado. Na devolução, confira de novo item
      por item: o que não voltar fica em branco e a solicitação continua aberta; avaria deve
      ser descrita na observação.
    </p>

    <div class="chk-assinaturas">
      <div>
        <strong>Retirada</strong>
        <p>Data: ${esc(dataISOparaBR(s.entrega_data) || "____/____/______")}</p>
        ${assinaturaImpressa(s, "Retirada", "Administrativo", s.entrega_adm)}
        ${assinaturaImpressa(s, "Retirada", "Prestador", s.entrega_prestador)}
      </div>
      <div>
        <strong>Devolução</strong>
        <p>Data: ${esc(dataISOparaBR(s.devolucao_data) || "____/____/______")}</p>
        ${assinaturaImpressa(s, "Devolução", "Administrativo", s.devolucao_adm)}
        ${assinaturaImpressa(s, "Devolução", "Prestador", s.devolucao_prestador)}
      </div>
    </div>`;

  abrirModal("modalChecklist");
}

// A assinatura digital, quando existe, ocupa a linha que antes era para
// caneta. Quando não existe, a linha continua vazia — a folha tem de
// servir para assinar à mão também: campo sem sinal existe.
function assinaturaImpressa(s, momento, papel, nomeDigitado) {
  const rotulo = papel === "Administrativo" ? "Assinatura do administrativo" : "Assinatura do prestador";
  const a = (s.assinaturas || []).find(x => x.momento === momento && x.papel === papel);
  if (a) {
    return `<div class="chk-assin"><img src="${esc(a.imagem)}" alt="Assinatura" /></div>
            <p class="chk-linha chk-linha-assinada">${esc(a.nome)}</p><span>${rotulo} · ${esc(formatarData(a.assinado_em))}</span>`;
  }
  return `<p class="chk-linha">${esc(nomeDigitado || "")}</p><span>${rotulo}</span>`;
}

// ══════════════════════════════════════════════════════
//  CALENDÁRIO — equipe × projeto × data
//
//  Um campo não é um ponto no tempo, é um intervalo: ele aparece em todos
//  os dias entre o início e o fim. Por isso o cálculo é por dia do mês, e
//  não por "data da solicitação" — a pergunta que a coordenação faz é
//  "quem está fora na quinta?", e não "quem pediu na quinta?".
//
//  Mesmo desenho do calendário de manutenção do Controle de Estoque: um
//  pontinho por STATUS no dia (não por evento), dia clicado lista ao
//  lado, sem dia escolhido a lista é do mês inteiro.
// ══════════════════════════════════════════════════════
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
               "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function soData(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  // Data local, e não `new Date("2026-08-25")`: a segunda é interpretada
  // como UTC e volta um dia atrás em fuso negativo — o campo apareceria
  // no dia errado no calendário.
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function mesmoDia(a, b) {
  return a && b && a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Solicitações que tocam um dia, já com os filtros da aba aplicados.
function camposNoDia(dia) {
  const { projeto, colaborador } = STATE.calendario;
  return DB.solicitacoes.filter(s => {
    // Campo cancelado ou recusado pelo líder não está no calendário:
    // ninguém vai a ele.
    if (s.status === "Cancelada" || s.status === "Recusada") return false;
    const inicio = soData(s.periodo_inicio), fim = soData(s.periodo_fim);
    if (!inicio || !fim) return false;
    if (dia < inicio || dia > fim) return false;
    if (projeto && (s.projeto_id || "") !== projeto) return false;
    if (colaborador && !(s.equipe || []).some(e => e.colaborador === colaborador)) return false;
    return true;
  });
}

function camposNoMes() {
  const { ano, mes } = STATE.calendario;
  const primeiro = new Date(ano, mes, 1);
  const ultimo = new Date(ano, mes + 1, 0);
  const { projeto, colaborador } = STATE.calendario;
  return DB.solicitacoes.filter(s => {
    // Campo cancelado ou recusado pelo líder não está no calendário:
    // ninguém vai a ele.
    if (s.status === "Cancelada" || s.status === "Recusada") return false;
    const inicio = soData(s.periodo_inicio), fim = soData(s.periodo_fim);
    if (!inicio || !fim) return false;
    // Sobreposição com o mês: campo que começa em julho e termina em
    // agosto aparece nos dois.
    if (fim < primeiro || inicio > ultimo) return false;
    if (projeto && (s.projeto_id || "") !== projeto) return false;
    if (colaborador && !(s.equipe || []).some(e => e.colaborador === colaborador)) return false;
    return true;
  });
}

function renderCalendario() {
  const { ano, mes, dia } = STATE.calendario;
  document.getElementById("calTitulo").textContent = `${MESES[mes]} de ${ano}`;

  // Filtros: projetos que aparecem em campo e pessoas que já foram.
  const selProjeto = document.getElementById("calProjeto");
  if (selProjeto.dataset.preenchido !== String(DB.projetos.length)) {
    selProjeto.innerHTML = `<option value="">Todos os projetos</option>` +
      DB.projetos.map(p => `<option value="${p.id}">${esc(p.cliente)} | ${esc(p.nome)}</option>`).join("");
    selProjeto.value = STATE.calendario.projeto;
    selProjeto.dataset.preenchido = String(DB.projetos.length);
  }
  const pessoas = Array.from(new Set(DB.solicitacoes.flatMap(s => (s.equipe || []).map(e => e.colaborador)))).sort();
  const selPessoa = document.getElementById("calColaborador");
  if (selPessoa.dataset.preenchido !== String(pessoas.length)) {
    selPessoa.innerHTML = `<option value="">Toda a equipe</option>` +
      pessoas.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
    selPessoa.value = STATE.calendario.colaborador;
    selPessoa.dataset.preenchido = String(pessoas.length);
  }

  const primeiro = new Date(ano, mes, 1);
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const vazios = primeiro.getDay();
  const agora = new Date();

  const celulas = [];
  for (let i = 0; i < vazios; i++) celulas.push(`<button class="cal-dia cal-fora" disabled></button>`);
  for (let d = 1; d <= diasNoMes; d++) {
    const data = new Date(ano, mes, d);
    const campos = camposNoDia(data);
    // Um pontinho por STATUS presente no dia, não por campo: cinco
    // pedidos em campo no mesmo dia viram um ponto, não cinco.
    const status = Array.from(new Set(campos.map(c => c.status)));
    const pontos = status.map(st => `<i class="cal-ponto cal-ponto-${classeStatusPonto(st)}"></i>`).join("");
    const classes = ["cal-dia"];
    if (mesmoDia(data, agora)) classes.push("cal-hoje");
    if (dia && mesmoDia(data, dia)) classes.push("cal-ativo");
    celulas.push(`<button class="${classes.join(" ")}" onclick="escolherDiaCalendario(${d})" title="${campos.length} campo(s)">
      <span>${d}</span><span class="cal-dia-pontos">${pontos}</span>
    </button>`);
  }
  document.getElementById("calGrade").innerHTML = celulas.join("");

  const lista = dia ? camposNoDia(dia) : camposNoMes();
  document.getElementById("calDetalheTitulo").textContent = dia
    ? `${dia.toLocaleDateString("pt-BR")} · ${lista.length} campo(s)`
    : `${MESES[mes]} inteiro · ${lista.length} campo(s)`;

  document.getElementById("calDetalheLista").innerHTML = lista.length
    ? lista.map(s => `<div class="cal-evento ev-${classeStatusPonto(s.status)}" onclick="abrirDetalhe('${s.id}')">
        <strong>${esc(s.cliente_projeto || "—")}</strong>
        <small>${esc(periodoTexto(s))} · ${esc(s.destino || "—")}</small>
        <small>${esc((s.equipe || []).map(e => e.colaborador).join(", ") || "Equipe não informada")}</small>
        <small class="cal-evento-id">${esc(s.codigo || "")} · ${esc(s.status)}${(s.equipamentos || []).length ? ` · ${s.equipamentos.length} equipamento(s)` : ""}</small>
      </div>`).join("")
    : `<p class="cal-detalhe-vazio">${ESTRUTURA_V2_OK ? "Nenhum campo neste período." : "Rode supabase/02_campo_v2.sql para o calendário mostrar a equipe."}</p>`;
}

function classeStatusPonto(status) {
  return status === "Aguardando aprovação" ? "aguardando"
       : status === "Aprovada" ? "aprovada"
       : status === "Logística confirmada" ? "logistica"
       : status === "Em campo" ? "campo"
       : status === "Finalizada" ? "finalizada" : "aguardando";
}

function escolherDiaCalendario(d) {
  const { ano, mes, dia } = STATE.calendario;
  const novo = new Date(ano, mes, d);
  // Clicar de novo no mesmo dia volta para o mês inteiro.
  STATE.calendario.dia = dia && mesmoDia(dia, novo) ? null : novo;
  renderCalendario();
}
function andarMes(passo) {
  const c = STATE.calendario;
  const d = new Date(c.ano, c.mes + passo, 1);
  c.ano = d.getFullYear(); c.mes = d.getMonth(); c.dia = null;
  renderCalendario();
}
function irParaHojeCalendario() {
  const agora = new Date();
  STATE.calendario.ano = agora.getFullYear();
  STATE.calendario.mes = agora.getMonth();
  STATE.calendario.dia = agora;
  renderCalendario();
}


// ══════════════════════════════════════════════════════
//  LOGÍSTICA — o que substituiu a aprovação
//
//  Aqui não se autoriza gasto: registra-se o que foi CONTRATADO. Locadora
//  e valor real do transporte, hotel de cada cidade com a diária real, e
//  a conferência de que o material está reservado nas datas.
// ══════════════════════════════════════════════════════
function abrirModalLogistica(id) {
  const s = DB.solicitacoes.find(x => x.id === id);
  if (!s) return;
  STATE.logisticaAlvo = id;

  document.getElementById("modalLogisticaTitulo").textContent = `Logística · ${s.codigo || ""} · ${s.cliente_projeto || ""}`;
  document.getElementById("logModalidade").value    = s.transporte_modalidade || "";
  document.getElementById("logLocadora").value      = s.transporte_locadora || "";
  document.getElementById("logLocadoraOutra").value = s.transporte_locadora_outra || "";
  document.getElementById("logContrato").value      = s.transporte_contrato || "";
  document.getElementById("logPlaca").value         = s.transporte_placa || "";
  document.getElementById("logValorTransporte").value = formatarNumeroBR(s.real_veiculo);
  document.getElementById("logObs").value           = s.logistica_obs || "";
  alternarLogLocadoraOutra();

  // Hospedagem: uma linha por cidade, com os hotéis daquele município.
  document.getElementById("logHospedagens").innerHTML = (s.hospedagens || []).length
    ? s.hospedagens.map(h => {
        const doMunicipio = DB.hoteis.filter(x =>
          x.ativo !== false && (x.municipio || "").toUpperCase() === (h.cidade || "").toUpperCase());
        return `<div class="log-hosp" data-id="${h.id}">
          <span class="log-hosp-cidade">${esc(h.cidade)} <em>${h.dias || 0} dia(s)</em></span>
          <select class="form-control log-hotel">
            <option value="">Hotel a definir</option>
            ${doMunicipio.map(x => `<option value="${x.id}" ${x.id === h.hotel_id ? "selected" : ""}>${esc(x.nome)} · ${esc(formatarMoeda(x.valor_diaria))}</option>`).join("")}
          </select>
          <input class="form-control log-diaria" placeholder="Diária real" value="${esc(formatarNumeroBR(h.diaria_real ?? h.diaria_prevista))}" oninput="mascaraMoedaEl(this)" />
          <input class="form-control log-reserva" placeholder="Nº da reserva" value="${esc(h.reserva_codigo || "")}" />
        </div>`;
      }).join("")
    : `<p class="modal-hint">Esta solicitação não pede hospedagem.${DB.hoteis.length ? "" : " O cadastro de hotéis está vazio — a aba Cadastros é onde ele nasce."}</p>`;

  // Reserva: o que está comprometido e o que falta reservar.
  const equipamentos = s.equipamentos || [];
  const reservados = (s.reservas || []).filter(r => r.situacao === "Reservado" || r.situacao === "Em campo");
  document.getElementById("logReservas").innerHTML = equipamentos.length
    ? `<div class="table-wrapper" style="box-shadow:none"><div class="table-scroll">
        <table class="art-table tabela-centralizada">
          <thead><tr><th>Equipamento</th><th>Qtd.</th><th>Reserva</th></tr></thead>
          <tbody>${equipamentos.map(e => {
            const r = reservados.find(x => x.solicitacao_equipamento_id === e.id);
            return `<tr>
              <td>${esc(nomeEquipamento(e))}</td>
              <td>${e.quantidade || 1}</td>
              <td>${r
                ? `<span class="status-badge ${r.situacao === "Em campo" ? "st-info" : "st-ok"}">${esc(r.situacao)}</span>`
                : `<span class="status-badge st-ruim">Sem reserva</span>`}</td>
            </tr>`; }).join("")}</tbody>
        </table></div></div>
        ${reservados.length < equipamentos.length
          ? `<p class="modal-hint">Confirmar a logística tenta reservar o que falta nas datas do campo. Se não couber, o sistema diz o que falta e nada muda.</p>`
          : `<p class="modal-hint">Todo o material está comprometido nas datas do campo.</p>`}`
    : `<p class="modal-hint">Esta solicitação não pede equipamento do estoque.</p>`;

  abrirModal("modalLogistica");
}

function alternarLogLocadoraOutra() {
  const v = document.getElementById("logLocadora").value;
  document.getElementById("grpLogLocadoraOutra").classList.toggle("hidden", v !== "Outros");
}

// Salvar sem confirmar guarda o que já se sabe; confirmar move o status.
// São duas ações porque a logística raramente fecha de uma vez: o carro
// sai hoje, o hotel na quinta.
async function salvarLogistica(confirmar) {
  const id = STATE.logisticaAlvo;
  const s = DB.solicitacoes.find(x => x.id === id);
  if (!s) return;

  const val = campoId => document.getElementById(campoId).value.trim();
  const locadora = val("logLocadora") || null;
  if (locadora === "Outros" && !val("logLocadoraOutra")) {
    mostrarToast("Diga qual é a locadora.", "err");
    return;
  }

  const cabecalho = {
    transporte_modalidade:     val("logModalidade") || null,
    transporte_locadora:       locadora,
    transporte_locadora_outra: locadora === "Outros" ? maiusc(val("logLocadoraOutra")) : null,
    transporte_contrato:       val("logContrato") || null,
    transporte_placa:          maiusc(val("logPlaca")) || null,
    real_veiculo:              parseMoeda(val("logValorTransporte")),
    logistica_obs:             val("logObs") || null,
  };

  const hospedagens = Array.from(document.querySelectorAll("#logHospedagens .log-hosp")).map(el => ({
    id: el.dataset.id,
    hotel_id: el.querySelector(".log-hotel").value || null,
    diaria_real: parseMoeda(el.querySelector(".log-diaria").value),
    reserva_codigo: el.querySelector(".log-reserva").value.trim() || null,
  }));

  // O real de hospedagem sai das linhas: dias × diária real. Somar aqui e
  // não pedir digitado evita o total divergir do detalhe. Zerar as
  // diárias zera o real — se só gravasse valor positivo, apagar uma
  // diária lançada por engano não teria efeito.
  if (hospedagens.length) {
    cabecalho.real_hospedagem = hospedagens.reduce((t, h) => {
      const linha = (s.hospedagens || []).find(x => x.id === h.id);
      return t + (Number(linha && linha.dias) || 0) * h.diaria_real;
    }, 0);
  }

  const botao = document.getElementById(confirmar ? "btnConfirmarLogistica" : "btnSalvarLogistica");
  botao.disabled = true;
  try {
    for (const h of hospedagens) {
      const r = await sb.from("solicitacao_hospedagens").update({
        hotel_id: h.hotel_id, diaria_real: h.diaria_real || null, reserva_codigo: h.reserva_codigo,
      }).eq("id", h.id);
      if (r.error) throw r.error;
    }

    // Confirmar tenta garantir a reserva antes de mudar o status: dizer
    // "logística confirmada" com material não reservado seria confirmar
    // o que não está fechado.
    if (confirmar && (s.equipamentos || []).length) {
      const reserva = await sb.rpc("reservar_equipamentos_solicitacao", { p_solicitacao: id });
      if (reserva.error && !tabelaNaoExiste(reserva.error)) throw reserva.error;
    }
    if (confirmar && s.status === "Aprovada") cabecalho.status = "Logística confirmada";

    const r = await sb.from("solicitacoes").update(cabecalho).eq("id", id);
    if (r.error) throw r.error;

    fecharModal("modalLogistica");
    mostrarToast(confirmar ? "Logística confirmada." : "Logística salva.", "ok");
    await recarregarTudo();
  } catch (e) {
    avisarErro(e, confirmar ? "confirmar a logística" : "salvar a logística");
  } finally {
    botao.disabled = false;
  }
}


// ══════════════════════════════════════════════════════
//  CADASTROS — hotéis, projetos e valor da diária
// ══════════════════════════════════════════════════════
function trocarAbaCadastro(aba) {
  STATE.cadastroAba = aba;
  document.querySelectorAll(".cad-aba").forEach(b => b.classList.toggle("active", b.dataset.cad === aba));
  document.getElementById("cadHoteis").classList.toggle("hidden", aba !== "hoteis");
  document.getElementById("cadDiarias").classList.toggle("hidden", aba !== "diarias");
}

// Projetos saiu daqui: virou a aba Direção, e é renderProjetos quem
// desenha, chamado direto de renderTudo.
function renderCadastros() {
  renderHoteis();
  renderDiarias();
}

// ─── Hotéis ─────────────────────────────────────────
function hoteisFiltrados() {
  const f = STATE.hoteisFiltros;
  const busca = f.busca.trim().toLowerCase();
  return DB.hoteis.filter(h => {
    if (f.uf && h.uf !== f.uf) return false;
    if (f.municipio && h.municipio !== f.municipio) return false;
    if (busca) {
      const alvo = `${h.nome} ${h.municipio} ${h.contato_nome || ""} ${h.bairro || ""}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

function renderHoteis() {
  // Os filtros só oferecem o que existe: UF e município saem do cadastro,
  // e não de uma lista fixa de 27 estados em que 25 estariam vazios.
  const ufs = Array.from(new Set(DB.hoteis.map(h => h.uf))).sort();
  const selUf = document.getElementById("filtroHotelUf");
  if (selUf.dataset.preenchido !== ufs.join()) {
    selUf.innerHTML = `<option value="">Todos os estados</option>` + ufs.map(u => `<option>${u}</option>`).join("");
    selUf.value = STATE.hoteisFiltros.uf;
    selUf.dataset.preenchido = ufs.join();
  }
  const municipios = Array.from(new Set(DB.hoteis
    .filter(h => !STATE.hoteisFiltros.uf || h.uf === STATE.hoteisFiltros.uf)
    .map(h => h.municipio))).sort();
  const selMun = document.getElementById("filtroHotelMunicipio");
  if (selMun.dataset.preenchido !== municipios.join()) {
    selMun.innerHTML = `<option value="">Todos os municípios</option>` + municipios.map(m => `<option>${esc(m)}</option>`).join("");
    selMun.value = STATE.hoteisFiltros.municipio;
    selMun.dataset.preenchido = municipios.join();
  }

  const lista = hoteisFiltrados();
  document.getElementById("tabelaHoteis").innerHTML = lista.map(h => `<tr>
    <td>${esc(h.nome)}</td>
    <td>${esc(h.tipo)}</td>
    <td>${esc(h.municipio)}</td>
    <td>${esc(h.uf)}</td>
    <td>${esc(h.telefone || h.whatsapp || "—")}</td>
    <td>${esc(h.contato_nome || "—")}</td>
    <td>${esc(formatarMoeda(h.valor_diaria))}</td>
    <td>${marca(h.cafe_incluso)}</td>
    <td>${marca(h.aceita_faturamento)}</td>
    <td><span class="status-badge ${h.ativo === false ? "st-neutro" : "st-ok"}">${h.ativo === false ? "Inativo" : "Ativo"}</span></td>
    <td class="table-actions">
      <button class="btn-icon" title="Editar" onclick="abrirModalHotel('${h.id}')">${svgIcon("edit")}</button>
      ${ehAdmin() ? `<button class="btn-icon btn-icon-danger" title="Excluir" onclick="excluirHotel('${h.id}')">${svgIcon("trash")}</button>` : ""}
    </td>
  </tr>`).join("");
  document.getElementById("emptyHoteis").classList.toggle("visible", lista.length === 0);

  const municipiosTotal = new Set(DB.hoteis.map(h => `${h.municipio}/${h.uf}`)).size;
  document.getElementById("resumoHoteis").textContent = ESTRUTURA_V2_OK
    ? `${lista.length} de ${DB.hoteis.length} · ${municipiosTotal} município(s) atendido(s)`
    : "Rode supabase/02_campo_v2.sql para o cadastro de hotéis existir.";
}

function abrirModalHotel(id) {
  const h = id ? DB.hoteis.find(x => x.id === id) : null;
  document.getElementById("modalHotelTitulo").textContent = h ? `Editar ${h.nome}` : "Novo hotel";
  const set = (campo, valor) => document.getElementById(campo).value = valor ?? "";
  set("hId", h ? h.id : "");
  set("hNome", h ? h.nome : "");
  set("hTipo", h ? h.tipo : "Hotel");
  set("hMunicipio", h ? h.municipio : "");
  set("hUf", h ? h.uf : "CE");
  set("hEndereco", h ? h.endereco : "");
  set("hBairro", h ? h.bairro : "");
  set("hTelefone", h ? h.telefone : "");
  set("hWhatsapp", h ? h.whatsapp : "");
  set("hEmail", h ? h.email : "");
  set("hContato", h ? h.contato_nome : "");
  set("hDiaria", h ? formatarNumeroBR(h.valor_diaria) : "");
  set("hObservacao", h ? h.observacao : "");
  set("hAtivo", h && h.ativo === false ? "0" : "1");
  document.getElementById("hCafe").checked = !!(h && h.cafe_incluso);
  document.getElementById("hEstacionamento").checked = !!(h && h.estacionamento);
  document.getElementById("hFaturamento").checked = !!(h && h.aceita_faturamento);
  abrirModal("modalHotel");
}

async function salvarHotel() {
  const val = campo => document.getElementById(campo).value.trim();
  const faltando = [];
  if (!val("hNome")) faltando.push("Nome");
  if (!val("hMunicipio")) faltando.push("Município");
  if (!val("hUf")) faltando.push("UF");
  if (faltando.length) { mostrarToast(`Preencha: ${faltando.join(", ")}.`, "err"); return; }

  const registro = {
    nome: maiusc(val("hNome")),
    tipo: val("hTipo"),
    municipio: maiusc(val("hMunicipio")),
    uf: val("hUf").toUpperCase(),
    endereco: maiusc(val("hEndereco")) || null,
    bairro: maiusc(val("hBairro")) || null,
    telefone: val("hTelefone") || null,
    whatsapp: val("hWhatsapp") || null,
    // E-mail não vai para caixa alta: endereço é literal.
    email: val("hEmail") || null,
    contato_nome: maiusc(val("hContato")) || null,
    valor_diaria: parseMoeda(val("hDiaria")),
    cafe_incluso: document.getElementById("hCafe").checked,
    estacionamento: document.getElementById("hEstacionamento").checked,
    aceita_faturamento: document.getElementById("hFaturamento").checked,
    observacao: val("hObservacao") || null,
    ativo: val("hAtivo") === "1",
  };

  const id = val("hId");
  const botao = document.getElementById("btnSalvarHotel");
  botao.disabled = true;
  try {
    const r = id
      ? await sb.from("hoteis").update(registro).eq("id", id)
      : await sb.from("hoteis").insert(registro);
    if (r.error) throw r.error;
    fecharModal("modalHotel");
    mostrarToast(id ? "Hotel atualizado." : "Hotel cadastrado.", "ok");
    await recarregarTudo();
  } catch (e) {
    avisarErro(e, "salvar o hotel");
  } finally {
    botao.disabled = false;
  }
}

async function excluirHotel(id) {
  const h = DB.hoteis.find(x => x.id === id);
  if (!h) return;
  // Hotel usado em pedido antigo não deve ser apagado: a hospedagem
  // perderia o vínculo e o histórico do gasto ficaria sem a casa.
  const usos = DB.solicitacoes.filter(s => (s.hospedagens || []).some(x => x.hotel_id === id)).length;
  const aviso = usos
    ? `${h.nome} está em ${usos} solicitação(ões). Excluir desfaz esse vínculo — o melhor é marcar como inativo. Excluir mesmo assim?`
    : `Excluir ${h.nome}?`;
  if (!confirm(aviso)) return;
  try {
    const { error } = await sb.from("hoteis").delete().eq("id", id);
    if (error) throw error;
    mostrarToast("Hotel excluído.", "ok");
    await recarregarTudo();
  } catch (e) {
    avisarErro(e, "excluir o hotel");
  }
}

// ─── Projetos (aba Direção) ─────────────────────────
//
// É o cadastro mais consequente do sistema: sem projeto ninguém abre
// solicitação, e é o líder daqui que aprova cada campo. Por isso é
// exclusivo da Direção — a política do banco é que garante, esta tela só
// esconde os botões.
function renderProjetos() {
  const f = STATE.projetosFiltros;
  const busca = f.busca.trim().toLowerCase();
  const lista = DB.projetos.filter(p => {
    if (f.lider && p.lider_id !== f.lider) return false;
    if (busca) {
      const alvo = `${p.cliente} ${p.nome} ${p.lider || ""} ${p.programas || ""}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });

  // O filtro de líder oferece só quem lidera algo.
  const lideres = Array.from(new Map(DB.projetos
    .filter(p => p.lider_id)
    .map(p => [p.lider_id, p.lider || p.lider_id])).entries())
    .sort((a, b) => String(a[1]).localeCompare(String(b[1]), "pt-BR"));
  const selLider = document.getElementById("filtroDirLider");
  if (selLider && selLider.dataset.preenchido !== String(lideres.length)) {
    selLider.innerHTML = `<option value="">Todos os líderes</option>` +
      lideres.map(([id, nome]) => `<option value="${id}">${esc(nome)}</option>`).join("");
    selLider.value = f.lider;
    selLider.dataset.preenchido = String(lideres.length);
  }

  const podeMexer = ehDirecao();
  document.getElementById("tabelaProjetos").innerHTML = lista.map(p => {
    const doProjeto = DB.solicitacoes.filter(s => s.projeto_id === p.id);
    const aAprovar = doProjeto.filter(s => s.status === "Aguardando aprovação").length;
    return `<tr>
      <td>${esc(p.cliente)}</td>
      <td>${esc(p.nome)}</td>
      <td>${esc(p.lider || "— sem líder —")}</td>
      <td class="dir-programas">${esc(p.programas || "—")}</td>
      <td>${esc(p.codigo_clockify || "—")}</td>
      <td>${esc(formatarMoeda(p.previsto_veiculo_dia))}</td>
      <td>${esc(formatarMoeda(p.previsto_hotel_dia))}</td>
      <td>${Number(p.previsto_alimentacao_dia) > 0 ? esc(formatarMoeda(p.previsto_alimentacao_dia)) : "referência"}</td>
      <td>${doProjeto.length}</td>
      <td>${aAprovar ? `<span class="status-badge st-perto">${aAprovar}</span>` : marca(false)}</td>
      <td><span class="status-badge ${p.ativo === false ? "st-neutro" : "st-ok"}">${p.ativo === false ? "Inativo" : "Ativo"}</span></td>
      <td class="table-actions">
        ${podeMexer
          ? `<button class="btn-icon" title="Editar" onclick="abrirModalProjeto('${p.id}')">${svgIcon("edit")}</button>
             <button class="btn-icon btn-icon-danger" title="Excluir" onclick="excluirProjeto('${p.id}')">${svgIcon("trash")}</button>`
          : `<span class="mov-autor">só a Direção</span>`}
      </td>
    </tr>`;
  }).join("");
  document.getElementById("emptyProjetos").classList.toggle("visible", lista.length === 0);

  const botaoNovo = document.getElementById("btnNovoProjeto");
  if (botaoNovo) botaoNovo.classList.toggle("hidden", !podeMexer);

  const semLider = DB.projetos.filter(p => !p.lider_id).length;
  document.getElementById("resumoProjetos").textContent = !ESTRUTURA_V2_OK
    ? "Rode supabase/02_campo_v2.sql para o cadastro de projetos existir."
    : `${lista.length} de ${DB.projetos.length} projeto(s) · ${lideres.length} líder(es)`
      + (semLider ? ` · ${semLider} SEM LÍDER: ninguém aprova campo deles` : "");
}

// A lista de quem pode ser líder. Colaborador pode liderar projeto — o
// que faz alguém líder é este cadastro, não o papel dele.
function preencherSelectLideres(idSelecionado) {
  const sel = document.getElementById("pLiderId");
  if (!sel) return;
  const ordem = { direcao: 0, gestor: 1, tecnico: 2 };
  const lista = DB.perfis.slice().sort((a, b) =>
    (ordem[a.papel] ?? 9) - (ordem[b.papel] ?? 9) || a.nome.localeCompare(b.nome, "pt-BR"));
  sel.innerHTML = `<option value="">Selecione quem aprova este projeto</option>` +
    lista.map(p => `<option value="${p.id}" ${p.id === idSelecionado ? "selected" : ""}>${esc(p.nome)}${p.cargo ? ` · ${esc(p.cargo)}` : ""}</option>`).join("");
}

// ─── Programas desenvolvidos (uma linha por programa) ───
//
// Na tela é uma lista de campos com "+"; no banco continua sendo a
// coluna de texto `programas`, com os nomes separados por vírgula. Foi
// assim que os projetos já cadastrados ficaram gravados, e é isso que a
// busca da aba Direção e a exportação leem.
function linhaPrograma(idx, valor) {
  return `<div class="sol-linha sol-linha-programa" data-idx="${idx}">
    <input class="form-control prog-nome" placeholder="Ex.: Fauna" value="${esc(valor || "")}"
           onkeydown="if(event.key==='Enter'){event.preventDefault();confirmarPrograma(${idx})}" />
    <button class="btn-icon btn-icon-ok" title="Confirmar programa" onclick="confirmarPrograma(${idx})">${svgIcon("seta")}</button>
    <button class="btn-icon btn-icon-danger" title="Remover" onclick="removerPrograma(${idx})">${svgIcon("trash")}</button>
  </div>`;
}
function lerProgramas() {
  return Array.from(document.querySelectorAll("#pProgramasLista .sol-linha-programa"))
    .map(el => el.querySelector(".prog-nome").value);
}
function remontarProgramas(lista) {
  // Sem nenhuma linha o campo obrigatório vira um vazio sem explicação:
  // sempre fica pelo menos uma para preencher.
  const linhas = lista.length ? lista : [""];
  document.getElementById("pProgramasLista").innerHTML =
    linhas.map((v, i) => linhaPrograma(i, v)).join("");
}
function adicionarPrograma() {
  remontarProgramas(lerProgramas().concat(""));
  // Foco na linha recém-criada: quem clicou no "+" já quer digitar.
  const campos = document.querySelectorAll("#pProgramasLista .prog-nome");
  if (campos.length) campos[campos.length - 1].focus();
}
function confirmarPrograma(idx) {
  const lista = lerProgramas();
  if (!String(lista[idx] || "").trim()) {
    mostrarToast("Escreva o nome do programa antes de confirmar.", "err");
    const campo = document.querySelectorAll("#pProgramasLista .prog-nome")[idx];
    if (campo) campo.focus();
    return;
  }
  // Confirmar na última linha abre a próxima; no meio da lista, só pula
  // para a linha seguinte — ninguém quer uma linha vazia no meio.
  if (idx === lista.length - 1) { adicionarPrograma(); return; }
  const campos = document.querySelectorAll("#pProgramasLista .prog-nome");
  if (campos[idx + 1]) campos[idx + 1].focus();
}
function removerPrograma(idx) {
  remontarProgramas(lerProgramas().filter((_, i) => i !== idx));
}
// Texto gravado ("FAUNA, FLORA") volta a ser uma linha por programa.
// Vírgula, ponto-e-vírgula e quebra de linha valem como separador — o
// campo era livre, e cada um separou de um jeito.
function separarProgramas(texto) {
  return String(texto || "").split(/[;,\n]/).map(s => s.trim()).filter(Boolean);
}

// ─── Projetos do Clockify ───────────────────────────
//
// A chamada sai daqui mesmo, do navegador, como no sgc-seteg — que
// consome este mesmo workspace. A chave vem do env.js, que está no
// .gitignore.
//
// ATENÇÃO: isso tira a chave do REPOSITÓRIO, não do NAVEGADOR. Ela vai
// no cabeçalho X-Api-Key de cada requisição e aparece para quem abrir o
// DevTools. Tirá-la do navegador exigiria uma função no servidor
// repassando a chamada.
//
// A lista é buscada uma vez por sessão, quando o cadastro de projeto
// abre. Se o Clockify falhar, o campo segue aceitando o código digitado:
// cadastro de projeto não pode travar por causa de integração fora do ar.
const CLOCKIFY_URL = "https://api.clockify.me/api/v1";
let CLOCKIFY = { projetos: [], carregado: false, carregando: null, erro: null };

function chaveClockify() { return (window.CLOCKIFY_API_KEY || "").trim(); }

async function pedirAoClockify(caminho) {
  const r = await fetch(CLOCKIFY_URL + caminho, { headers: { "X-Api-Key": chaveClockify() } });
  if (!r.ok) {
    const motivo = r.status === 401 || r.status === 403
      ? "a chave do Clockify foi recusada (vencida ou sem permissão)"
      : `o Clockify respondeu ${r.status}`;
    throw new Error(motivo);
  }
  return r.json();
}

async function carregarProjetosClockify(forcar) {
  if (CLOCKIFY.carregado && !forcar) return CLOCKIFY;
  if (CLOCKIFY.carregando) return CLOCKIFY.carregando;
  CLOCKIFY.carregando = (async () => {
    try {
      if (!chaveClockify()) {
        throw new Error("Sem a chave do Clockify (env.js) — o campo aceita o código digitado. Veja env.example.js.");
      }
      let workspaceId = (window.CLOCKIFY_WORKSPACE_ID || "").trim();
      if (!workspaceId) {
        const workspaces = await pedirAoClockify("/workspaces");
        if (!Array.isArray(workspaces) || !workspaces.length) {
          throw new Error("A chave do Clockify não tem nenhum workspace.");
        }
        workspaceId = workspaces[0].id;
      }

      // O Clockify pagina. Projeto arquivado fica de fora: não se abre
      // campo novo em projeto encerrado. O teto de 10 páginas (2.000
      // projetos) é só para um erro de paginação não virar laço infinito.
      const brutos = [];
      for (let pagina = 1; pagina <= 10; pagina++) {
        const lote = await pedirAoClockify(
          `/workspaces/${workspaceId}/projects?archived=false&page-size=200&page=${pagina}`);
        if (!Array.isArray(lote) || !lote.length) break;
        brutos.push(...lote);
        if (lote.length < 200) break;
      }

      CLOCKIFY.projetos = lerProjetosClockify(brutos);
      CLOCKIFY.erro = null;
    } catch (e) {
      CLOCKIFY.projetos = [];
      CLOCKIFY.erro = String(e.message || e);
    } finally {
      CLOCKIFY.carregado = true;
      CLOCKIFY.carregando = null;
      preencherDatalistClockify();
    }
    return CLOCKIFY;
  })();
  return CLOCKIFY.carregando;
}

// Mesma leitura do sgc-seteg, que consome este mesmo workspace:
//
//  · Projeto cujo nome COMEÇA com CANCELADO ou FINALIZADO fica de fora.
//    Só no começo — projeto com "finalizado" no meio da descrição vale.
//  · O nome segue o padrão "#CODIGO (Nome do empreendimento)". O código é
//    o que vai para o campo "Código Clockify"; o nome é a dica na lista.
//    Nome fora do padrão vira código dele mesmo — melhor do que sumir.
//
// O "#" sai: o código é gravado aqui sem ele ("0189-3-2025").
function lerProjetosClockify(brutos) {
  const ignorar = /^(CANCELADO|FINALIZADO)/i;
  return brutos
    .filter(p => (p.name || "").trim() && !ignorar.test((p.name || "").trim()))
    .map(p => {
      const casa = (p.name || "").match(/^(#[^\s(]+)\s*(?:\((.+)\))?$/);
      const codigo = (casa ? casa[1] : p.name).replace(/^#/, "").trim();
      const nome = (casa && casa[2] ? casa[2].trim() : "") || (p.clientName || "").trim() || p.name.trim();
      return { id: p.id, codigo, nome, cliente: (p.clientName || "").trim() };
    })
    .filter(p => p.codigo)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// No datalist o valor é o que ENTRA no campo — o código do projeto
// ("0189-3-2025") — e o texto da opção é a dica: o nome do
// empreendimento, com o cliente quando ele acrescenta alguma coisa.
function preencherDatalistClockify() {
  const lista = document.getElementById("listaProjetosClockify");
  if (!lista) return;
  lista.innerHTML = CLOCKIFY.projetos.map(p => {
    const dica = p.cliente && p.cliente !== p.nome ? `${p.nome} · ${p.cliente}` : p.nome;
    return `<option value="${esc(p.codigo)}">${esc(dica)}</option>`;
  }).join("");
}

// Aviso embaixo do campo: sem a integração a pessoa precisa saber que o
// que ela está vendo é digitação livre, e não a lista do Clockify.
function avisarClockify() {
  const campo = document.getElementById("pClockify");
  if (!campo) return;
  const grupo = campo.closest(".form-group");
  if (!grupo) return;
  let aviso = grupo.querySelector(".clockify-aviso");
  if (!aviso) {
    aviso = document.createElement("small");
    aviso.className = "clockify-aviso";
    grupo.appendChild(aviso);
  }
  if (!CLOCKIFY.carregado) { aviso.textContent = "Buscando os projetos no Clockify…"; aviso.classList.remove("erro"); return; }
  if (CLOCKIFY.erro) { aviso.textContent = CLOCKIFY.erro; aviso.classList.add("erro"); return; }
  aviso.textContent = `${CLOCKIFY.projetos.length} projeto(s) do Clockify na lista.`;
  aviso.classList.remove("erro");
}

function abrirModalProjeto(id) {
  if (!ehDirecao()) {
    mostrarToast("Só a Direção cadastra projeto e líder.", "err");
    return;
  }
  const p = id ? DB.projetos.find(x => x.id === id) : null;
  document.getElementById("modalProjetoTitulo").textContent = p ? `Editar ${p.cliente} | ${p.nome}` : "Novo projeto";
  const set = (campo, valor) => document.getElementById(campo).value = valor ?? "";
  set("pId", p ? p.id : "");
  set("pCliente", p ? p.cliente : "");
  set("pNome", p ? p.nome : "");
  set("pClockify", p ? p.codigo_clockify : "");
  remontarProgramas(separarProgramas(p ? p.programas : ""));
  set("pVeiculoDia", p ? formatarNumeroBR(p.previsto_veiculo_dia) : "");
  set("pHotelDia", p ? formatarNumeroBR(p.previsto_hotel_dia) : "");
  set("pAlimentacaoDia", p && Number(p.previsto_alimentacao_dia) > 0 ? formatarNumeroBR(p.previsto_alimentacao_dia) : "");
  set("pObservacao", p ? p.observacao : "");
  set("pAtivo", p && p.ativo === false ? "0" : "1");
  preencherSelectLideres(p ? p.lider_id : null);
  avisarClockify();
  carregarProjetosClockify().then(avisarClockify);
  abrirModal("modalProjeto");
}

async function salvarProjeto() {
  const val = campo => document.getElementById(campo).value.trim();
  const faltando = [];
  if (!val("pCliente")) faltando.push("Cliente");
  if (!val("pNome")) faltando.push("Projeto");
  // Projeto sem líder é projeto em que ninguém aprova campo — o pedido
  // ficaria travado para sempre. Por isso é exigido aqui e no banco.
  if (!val("pLiderId")) faltando.push("Líder do projeto");
  const programas = lerProgramas().map(s => s.trim()).filter(Boolean);
  if (!programas.length) faltando.push("Programas desenvolvidos");
  if (faltando.length) { mostrarToast(`Preencha: ${faltando.join(", ")}.`, "err"); return; }

  const registro = {
    cliente: maiusc(val("pCliente")),
    nome: maiusc(val("pNome")),
    lider_id: val("pLiderId"),
    // `lider` (texto) é preenchido por trigger a partir do lider_id — não
    // se manda daqui, senão os dois divergem.
    codigo_clockify: val("pClockify") || null,
    programas: programas.map(maiusc).join(", "),
    previsto_veiculo_dia: parseMoeda(val("pVeiculoDia")),
    previsto_hotel_dia: parseMoeda(val("pHotelDia")),
    previsto_alimentacao_dia: parseMoeda(val("pAlimentacaoDia")),
    observacao: val("pObservacao") || null,
    ativo: val("pAtivo") === "1",
  };

  const id = val("pId");
  const botao = document.getElementById("btnSalvarProjeto");
  botao.disabled = true;
  try {
    const r = id
      ? await sb.from("projetos").update(registro).eq("id", id)
      : await sb.from("projetos").insert(registro);
    if (r.error) throw r.error;
    fecharModal("modalProjeto");
    mostrarToast(id ? "Projeto atualizado." : "Projeto cadastrado.", "ok");
    await recarregarTudo();
  } catch (e) {
    avisarErro(e, "salvar o projeto");
  } finally {
    botao.disabled = false;
  }
}

async function excluirProjeto(id) {
  if (!ehDirecao()) { mostrarToast("Só a Direção exclui projeto.", "err"); return; }
  const p = DB.projetos.find(x => x.id === id);
  if (!p) return;
  const usos = DB.solicitacoes.filter(s => s.projeto_id === id).length;
  // Excluir projeto usado desfaz o vínculo das solicitações antigas — e
  // com ele o registro de quem aprovou o quê. Inativar preserva a
  // história e tira o projeto da lista de quem vai pedir.
  const aviso = usos
    ? `${p.cliente} | ${p.nome} está em ${usos} solicitação(ões). Excluir desfaz esse vínculo e apaga de quem era a aprovação — o melhor é marcar como INATIVO. Excluir mesmo assim?`
    : `Excluir ${p.cliente} | ${p.nome}?`;
  if (!confirm(aviso)) return;
  try {
    const { error } = await sb.from("projetos").delete().eq("id", id);
    if (error) throw error;
    mostrarToast("Projeto excluído.", "ok");
    await recarregarTudo();
  } catch (e) {
    avisarErro(e, "excluir o projeto");
  }
}

// ─── Valor da diária ────────────────────────────────
function renderDiarias() {
  const lista = DB.diarias.length ? DB.diarias : [];
  document.getElementById("tabelaDiarias").innerHTML = lista.map(d => `<tr>
    <td>${esc(d.tipo_diaria)}</td>
    <td>${esc(d.vinculo)}</td>
    <td>${marca(d.pernoite)}</td>
    <td>${esc(formatarMoeda(d.valor))}</td>
    <td class="table-actions">
      ${ehAdmin()
        ? `<button class="btn-icon" title="Ajustar valor" onclick="abrirModalDiaria('${d.id}')">${svgIcon("edit")}</button>`
        : `<span class="mov-autor">só a Gestão ajusta</span>`}
    </td>
  </tr>`).join("");
  document.getElementById("emptyDiarias").classList.toggle("visible", lista.length === 0);
  document.getElementById("resumoDiarias").textContent = lista.length
    ? `Referência: ${formatarMoeda(referenciaDiaria(true))} com pernoite · ${formatarMoeda(referenciaDiaria(false))} sem pernoite`
    : "Rode supabase/02_campo_v2.sql para a tabela de diárias existir. Até então valem R$ 55,00 e R$ 35,00 fixos no código.";
}

function abrirModalDiaria(id) {
  const d = DB.diarias.find(x => x.id === id);
  if (!d) return;
  document.getElementById("dvId").value = d.id;
  document.getElementById("dvTipo").value = d.tipo_diaria;
  document.getElementById("dvValor").value = formatarNumeroBR(d.valor);
  abrirModal("modalDiaria");
}

async function salvarDiaria() {
  const id = document.getElementById("dvId").value;
  const valor = parseMoeda(document.getElementById("dvValor").value);
  if (valor <= 0) { mostrarToast("Informe o valor da diária.", "err"); return; }
  const botao = document.getElementById("btnSalvarDiaria");
  botao.disabled = true;
  try {
    const { error } = await sb.from("diaria_valores")
      .update({ valor, atualizado_em: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    fecharModal("modalDiaria");
    mostrarToast("Valor de referência atualizado.", "ok");
    await recarregarTudo();
  } catch (e) {
    avisarErro(e, "atualizar o valor da diária");
  } finally {
    botao.disabled = false;
  }
}


// ══════════════════════════════════════════════════════
//  AVARIAS COM CUSTO
//
//  A avaria nasce na devolução (a conferência abre a linha, com a
//  descrição e o custo estimado) e fecha aqui, com o custo real. O banco
//  não deixa marcar Resolvida ou Cobrada sem o custo real — é a coluna
//  pela qual este relatório existe.
// ══════════════════════════════════════════════════════
function avariasFiltradas() {
  const f = STATE.avariasFiltros;
  const busca = f.busca.trim().toLowerCase();
  return DB.avarias.filter(a => {
    if (f.situacao && a.situacao !== f.situacao) return false;
    if (f.gravidade && a.gravidade !== f.gravidade) return false;
    if (busca) {
      const alvo = `${a.equipamento} ${a.solicitacao_codigo} ${a.projeto} ${a.descricao} ${a.responsavel || ""}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

function renderAvarias() {
  const lista = avariasFiltradas();
  const estimado = lista.reduce((t, a) => t + (Number(a.custo_estimado) || 0), 0);
  const real     = lista.reduce((t, a) => t + (Number(a.custo_real) || 0), 0);
  // "Em aberto" é o que ainda vai custar: o estimado do que não foi
  // resolvido. Somar o real aqui contaria dinheiro já gasto como
  // pendência.
  const aberto = lista
    .filter(a => a.situacao === "Aberta" || a.situacao === "Em reparo")
    .reduce((t, a) => t + (Number(a.custo_real ?? a.custo_estimado) || 0), 0);

  document.getElementById("avariaQtd").textContent      = lista.length;
  document.getElementById("avariaEstimado").textContent = formatarMoeda(estimado);
  document.getElementById("avariaReal").textContent     = formatarMoeda(real);
  document.getElementById("avariaAberto").textContent   = formatarMoeda(aberto);

  document.getElementById("tabelaAvarias").innerHTML = lista.map(a => `<tr>
    <td>${esc(formatarData(a.aberto_em))}</td>
    <td>${esc(a.solicitacao_codigo)}</td>
    <td>${esc(a.projeto)}</td>
    <td>${esc(a.equipamento)}</td>
    <td><span class="status-badge ${a.gravidade === "Perda total" || a.gravidade === "Grave" ? "st-ruim" : a.gravidade === "Média" ? "st-perto" : "st-neutro"}">${esc(a.gravidade)}</span></td>
    <td class="avaria-desc">${esc(a.descricao)}</td>
    <td>${esc(a.providencia)}</td>
    <td>${esc(formatarMoeda(a.custo_estimado))}</td>
    <td>${a.custo_real == null ? "—" : esc(formatarMoeda(a.custo_real))}</td>
    <td><span class="status-badge ${AVARIA_CLASSE[a.situacao] || "st-neutro"}">${esc(a.situacao)}</span></td>
    <td class="table-actions">
      <button class="btn-icon" title="Editar avaria" onclick="abrirModalAvaria('${a.id}')">${svgIcon("edit")}</button>
      <button class="btn-icon" title="Ver solicitação" onclick="abrirDetalhe('${a.solicitacao_id}')">${svgIcon("eye")}</button>
    </td>
  </tr>`).join("");
  document.getElementById("emptyAvarias").classList.toggle("visible", lista.length === 0);

  document.getElementById("resumoAvarias").textContent = ESTRUTURA_V2_OK
    ? `${lista.length} de ${DB.avarias.length} avaria(s) · ${formatarMoeda(real || estimado)} em ${real ? "custo real" : "custo estimado"}`
    : "Rode supabase/02_campo_v2.sql para o relatório de avarias existir.";
}

function abrirModalAvaria(id) {
  const a = DB.avarias.find(x => x.id === id);
  if (!a) return;
  document.getElementById("avId").value = a.id;
  document.getElementById("modalAvariaTitulo").textContent = `Avaria · ${a.equipamento}`;
  document.getElementById("avContexto").innerHTML = `
    <div><span>Solicitação</span><strong>${esc(a.solicitacao_codigo)}</strong></div>
    <div><span>Projeto</span><strong>${esc(a.projeto)}</strong></div>
    <div><span>Equipamento</span><strong>${esc(a.equipamento)}</strong></div>
    <div><span>Aberta em</span><strong>${esc(formatarDataHora(a.aberto_em))}</strong></div>
    <div><span>Registrada por</span><strong>${esc(a.usuario_nome || "—")}</strong></div>
    ${a.fechado_em ? `<div><span>Fechada em</span><strong>${esc(formatarDataHora(a.fechado_em))}</strong></div>` : ""}`;

  const set = (campo, valor) => document.getElementById(campo).value = valor ?? "";
  set("avDescricao", a.descricao);
  set("avGravidade", a.gravidade);
  set("avProvidencia", a.providencia);
  set("avCausa", a.causa);
  set("avResponsavel", a.responsavel);
  set("avCustoEstimado", formatarNumeroBR(a.custo_estimado));
  set("avCustoReal", a.custo_real == null ? "" : formatarNumeroBR(a.custo_real));
  set("avFornecedor", a.fornecedor);
  set("avNotaFiscal", a.nota_fiscal);
  set("avSituacao", a.situacao);
  abrirModal("modalAvaria");
}

async function salvarAvaria() {
  const val = campo => document.getElementById(campo).value.trim();
  const situacao = val("avSituacao");
  const custoRealTexto = val("avCustoReal");

  if (!val("avDescricao")) { mostrarToast("Descreva a avaria.", "err"); return; }
  // A mesma regra do banco, dita antes: Resolvida e Cobrada sem custo
  // real deixariam o relatório sem a coluna que ele existe para mostrar.
  if (["Resolvida", "Cobrada"].includes(situacao) && !custoRealTexto) {
    mostrarToast(`Avaria ${situacao.toLowerCase()} exige o custo real.`, "err");
    return;
  }

  const registro = {
    descricao: maiusc(val("avDescricao")),
    gravidade: val("avGravidade"),
    providencia: val("avProvidencia"),
    causa: maiusc(val("avCausa")) || null,
    responsavel: maiusc(val("avResponsavel")) || null,
    custo_estimado: parseMoeda(val("avCustoEstimado")),
    custo_real: custoRealTexto ? parseMoeda(custoRealTexto) : null,
    fornecedor: maiusc(val("avFornecedor")) || null,
    nota_fiscal: val("avNotaFiscal") || null,
    situacao,
  };

  const botao = document.getElementById("btnSalvarAvaria");
  botao.disabled = true;
  try {
    const { error } = await sb.from("solicitacao_avarias").update(registro).eq("id", val("avId"));
    if (error) throw error;
    fecharModal("modalAvaria");
    mostrarToast("Avaria atualizada.", "ok");
    await recarregarTudo();
  } catch (e) {
    avisarErro(e, "salvar a avaria");
  } finally {
    botao.disabled = false;
  }
}


// ══════════════════════════════════════════════════════
//  LISTENERS DO QUE É NOVO
//
//  Ficam em função separada, chamada de registrarListeners, para o bloco
//  original continuar legível — e para dar erro claro se um id do HTML
//  novo não existir.
// ══════════════════════════════════════════════════════
function registrarListenersCampoV2() {
  const ao = (id, evento, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(evento, fn);
    else console.warn("elemento não encontrado:", id);
  };

  // ── Formulário ──
  ao("sProjeto", "change", aplicarProjetoNoForm);
  ao("sPeriodoInicio", "change", carregarDisponibilidade);
  ao("sPeriodoFim", "change", carregarDisponibilidade);
  // "change" não chega quando a máscara escreve a última casa sem o campo
  // perder o foco; o input com atraso cobre isso.
  let timerPeriodo = null;
  const aoDigitarPeriodo = () => {
    clearTimeout(timerPeriodo);
    timerPeriodo = setTimeout(carregarDisponibilidade, 600);
  };
  ao("sPeriodoInicio", "input", aoDigitarPeriodo);
  ao("sPeriodoFim", "input", aoDigitarPeriodo);

  ao("btnAddEquipe", "click", () => adicionarEquipe());
  ao("btnAddEpi", "click", () => adicionarEpi());
  ao("btnAplicarPrevisto", "click", aplicarSugestaoPrevisto);
  ao("sTransporteLocadora", "change", alternarLocadoraOutra);
  document.querySelectorAll('input[name="sSst"]').forEach(r => r.addEventListener("change", atualizarSst));
  SST_CHECKS.forEach(id => ao(id, "change", atualizarSst));

  // ── Calendário ──
  ao("btnCalAnterior", "click", () => andarMes(-1));
  ao("btnCalProximo", "click", () => andarMes(1));
  ao("btnCalHoje", "click", irParaHojeCalendario);
  ao("calProjeto", "change", e => { STATE.calendario.projeto = e.target.value; renderCalendario(); });
  ao("calColaborador", "change", e => { STATE.calendario.colaborador = e.target.value; renderCalendario(); });
  ao("btnCalExportar", "click", exportarCalendarioCSV);

  // ── Logística ──
  ao("btnFecharLogistica", "click", () => fecharModal("modalLogistica"));
  ao("btnCancelarLogistica", "click", () => fecharModal("modalLogistica"));
  ao("btnSalvarLogistica", "click", () => salvarLogistica(false));
  ao("btnConfirmarLogistica", "click", () => salvarLogistica(true));
  ao("logLocadora", "change", alternarLogLocadoraOutra);

  // ── Acréscimo ──
  ao("btnFecharAcrescimo", "click", () => fecharModal("modalAcrescimo"));
  ao("btnCancelarAcrescimo", "click", () => fecharModal("modalAcrescimo"));
  ao("btnConfirmarAcrescimo", "click", confirmarAcrescimo);

  // ── Cadastros ──
  document.querySelectorAll(".cad-aba").forEach(b =>
    b.addEventListener("click", () => trocarAbaCadastro(b.dataset.cad)));
  ao("btnNovoHotel", "click", () => abrirModalHotel(null));
  ao("btnFecharHotel", "click", () => fecharModal("modalHotel"));
  ao("btnCancelarHotel", "click", () => fecharModal("modalHotel"));
  ao("btnSalvarHotel", "click", salvarHotel);
  ao("filtroHotelUf", "change", e => { STATE.hoteisFiltros.uf = e.target.value; STATE.hoteisFiltros.municipio = ""; renderHoteis(); });
  ao("filtroHotelMunicipio", "change", e => { STATE.hoteisFiltros.municipio = e.target.value; renderHoteis(); });
  ao("buscaHotel", "input", e => { STATE.hoteisFiltros.busca = e.target.value; renderHoteis(); });
  ao("btnExportarHoteis", "click", exportarHoteisCSV);

  // ── Direção: projetos e líderes ──
  ao("btnNovoProjeto", "click", () => abrirModalProjeto(null));
  ao("btnFecharProjeto", "click", () => fecharModal("modalProjeto"));
  ao("btnCancelarProjeto", "click", () => fecharModal("modalProjeto"));
  ao("btnSalvarProjeto", "click", salvarProjeto);
  ao("btnAddPrograma", "click", () => adicionarPrograma());
  ao("buscaDirProjeto", "input", e => { STATE.projetosFiltros.busca = e.target.value; renderProjetos(); });
  ao("filtroDirLider", "change", e => { STATE.projetosFiltros.lider = e.target.value; renderProjetos(); });
  ao("btnExportarProjetos", "click", exportarProjetosCSV);

  ao("btnFecharDiaria", "click", () => fecharModal("modalDiaria"));
  ao("btnCancelarDiaria", "click", () => fecharModal("modalDiaria"));
  ao("btnSalvarDiaria", "click", salvarDiaria);

  // ── Avarias ──
  ao("filtroAvariaSituacao", "change", e => { STATE.avariasFiltros.situacao = e.target.value; renderAvarias(); });
  ao("filtroAvariaGravidade", "change", e => { STATE.avariasFiltros.gravidade = e.target.value; renderAvarias(); });
  ao("buscaAvaria", "input", e => { STATE.avariasFiltros.busca = e.target.value; renderAvarias(); });
  ao("btnLimparAvarias", "click", () => {
    STATE.avariasFiltros = { situacao: "", gravidade: "", busca: "" };
    ["filtroAvariaSituacao", "filtroAvariaGravidade", "buscaAvaria"].forEach(id => document.getElementById(id).value = "");
    renderAvarias();
  });
  ao("btnExportarAvarias", "click", exportarAvariasCSV);
  ao("btnFecharAvaria", "click", () => fecharModal("modalAvaria"));
  ao("btnCancelarAvaria", "click", () => fecharModal("modalAvaria"));
  ao("btnSalvarAvaria", "click", salvarAvaria);

  // ── Assinaturas ──
  document.querySelectorAll("[data-limpar]").forEach(b =>
    b.addEventListener("click", () => limparAssinatura(b.dataset.limpar)));
  prepararAssinatura("assinAdm");
  prepararAssinatura("assinPrestador");
}


// ══════════════════════════════════════════════════════
//  EXPORTAÇÃO CSV — a lista que está na tela, em arquivo
//  (mesma regra do estoque: o CSV é de todo mundo)
// ══════════════════════════════════════════════════════
function csvEscape(v) { return `"${String(v ?? "").replace(/"/g, '""')}"`; }
// Número no formato que o Excel brasileiro entende como número, e não
// como texto: vírgula decimal, sem separador de milhar.
function csvNumero(v) { return (Number(v) || 0).toFixed(2).replace(".", ","); }

// Um só lugar para montar e baixar o arquivo. O BOM no começo é o que faz
// o Excel abrir acentuação certa.
function baixarCSV(nome, cabecalho, linhas) {
  if (!linhas.length) { mostrarToast("Nada para exportar com esses filtros.", "err"); return; }
  const texto = [cabecalho.map(csvEscape).join(";"),
                 ...linhas.map(l => l.map(csvEscape).join(";"))].join("\r\n");
  const blob = new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nome}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportarCSV() {
  const lista = solicitacoesFiltradas();
  baixarCSV("solicitacoes-campo",
    ["Código", "Tipo", "Status", "Solicitante", "Setor", "Cliente | Projeto", "Código Clockify",
     "Destino", "Período", "Dias", "Equipe", "Líder", "Recurso até",
     "Veículo", "Modalidade", "Locadora", "Contrato", "Placa",
     "Hospedagem", "Equipamentos", "Reservados",
     "Previsto veículo", "Previsto hospedagem", "Previsto alimentação", "Previsto outros", "Previsto total",
     "Real veículo", "Real hospedagem", "Real alimentação", "Real outros", "Real total",
     "Desvio", "Desvio %", "Status de curso", "SST", "Avarias", "Custo de avaria",
     "Solicitado no financeiro"],
    lista.map(s => {
      const lider = (s.equipe || []).find(e => e.lider);
      const locadora = s.transporte_locadora === "Outros" ? s.transporte_locadora_outra : s.transporte_locadora;
      const dias = s.periodo_inicio && s.periodo_fim
        ? Math.round((soData(s.periodo_fim) - soData(s.periodo_inicio)) / 86400000) + 1 : "";
      return [
        s.codigo, s.tipo, s.status, s.solicitante_nome, s.setor, s.cliente_projeto, s.codigo_clockify,
        s.destino, periodoTexto(s), dias,
        (s.equipe || []).map(e => e.colaborador).join(" / "),
        lider ? lider.colaborador : "",
        dataISOparaBR(s.data_recurso),
        s.veiculo_necessario ? "Sim" : "Não",
        s.transporte_modalidade, locadora, s.transporte_contrato, s.transporte_placa,
        (s.hospedagens || []).length ? s.hospedagens.map(h => `${h.cidade} (${h.dias || 0}d)`).join(" / ") : "Não",
        (s.equipamentos || []).length,
        (s.reservas || []).filter(r => r.situacao !== "Cancelada").length,
        csvNumero(s.previsto_veiculo), csvNumero(s.previsto_hospedagem),
        csvNumero(s.previsto_alimentacao), csvNumero(s.previsto_outros), csvNumero(s.previsto_total),
        csvNumero(s.real_veiculo), csvNumero(s.real_hospedagem),
        csvNumero(s.real_alimentacao), csvNumero(s.real_outros), csvNumero(s.real_total),
        csvNumero(s.desvio_valor),
        s.desvio_percentual == null ? "" : csvNumero(s.desvio_percentual),
        s.status_curso, s.sst_identificacao,
        (s.avarias || []).length,
        csvNumero((s.avarias || []).reduce((t, a) => t + (Number(a.custo_real ?? a.custo_estimado) || 0), 0)),
        s.tipo === "Financeiro" ? csvNumero(totalSolicitacao(s)) : "",
      ];
    }));
}

// O calendário exportado é uma linha por PESSOA por campo — é assim que
// se usa: para conferir escala, não para contar pedidos.
function exportarCalendarioCSV() {
  const { dia, ano, mes } = STATE.calendario;
  const lista = dia ? camposNoDia(dia) : camposNoMes();
  const linhas = lista.flatMap(s => {
    const equipe = (s.equipe || []).length ? s.equipe : [{ colaborador: "(equipe não informada)", funcao: "", lider: false }];
    return equipe.map(e => [
      s.codigo, s.cliente_projeto, s.destino,
      dataISOparaBR(s.periodo_inicio), dataISOparaBR(s.periodo_fim),
      e.colaborador, e.funcao || "", e.lider ? "Sim" : "", e.codigo_clockify || "",
      s.status, s.sst_identificacao,
    ]);
  });
  baixarCSV(`calendario-campo-${ano}-${String(mes + 1).padStart(2, "0")}`,
    ["Solicitação", "Cliente | Projeto", "Destino", "Início", "Fim",
     "Colaborador", "Função", "Líder", "Clockify", "Status", "SST"],
    linhas);
}

function exportarHoteisCSV() {
  baixarCSV("hoteis",
    ["Nome", "Tipo", "Município", "UF", "Endereço", "Bairro", "Telefone", "WhatsApp",
     "E-mail", "Contato", "Diária", "Café incluso", "Estacionamento", "Faturamento", "Situação", "Observação"],
    hoteisFiltrados().map(h => [
      h.nome, h.tipo, h.municipio, h.uf, h.endereco, h.bairro, h.telefone, h.whatsapp,
      h.email, h.contato_nome, csvNumero(h.valor_diaria),
      h.cafe_incluso ? "Sim" : "Não", h.estacionamento ? "Sim" : "Não",
      h.aceita_faturamento ? "Sim" : "Não", h.ativo === false ? "Inativo" : "Ativo", h.observacao,
    ]));
}

function exportarProjetosCSV() {
  const f = STATE.projetosFiltros;
  const busca = f.busca.trim().toLowerCase();
  const lista = DB.projetos.filter(p => {
    if (f.lider && p.lider_id !== f.lider) return false;
    if (busca) {
      const alvo = `${p.cliente} ${p.nome} ${p.lider || ""} ${p.programas || ""}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
  baixarCSV("projetos",
    ["Cliente", "Projeto", "Líder", "Programas desenvolvidos", "Clockify",
     "Veículo/dia", "Hotel/dia", "Alimentação/dia",
     "Campos", "Aguardando aprovação", "Previsto acumulado", "Real acumulado", "Situação"],
    lista.map(p => {
      const campos = DB.solicitacoes.filter(s => s.projeto_id === p.id);
      return [
        p.cliente, p.nome, p.lider, p.programas, p.codigo_clockify,
        csvNumero(p.previsto_veiculo_dia), csvNumero(p.previsto_hotel_dia), csvNumero(p.previsto_alimentacao_dia),
        campos.length,
        campos.filter(s => s.status === "Aguardando aprovação").length,
        csvNumero(campos.reduce((t, s) => t + (Number(s.previsto_total) || 0), 0)),
        csvNumero(campos.reduce((t, s) => t + (Number(s.real_total) || 0), 0)),
        p.ativo === false ? "Inativo" : "Ativo",
      ];
    }));
}

function exportarAvariasCSV() {
  baixarCSV("avarias-campo",
    ["Aberta em", "Solicitação", "Projeto", "Equipamento", "Gravidade", "Descrição", "Causa",
     "Responsável", "Providência", "Custo estimado", "Custo real", "Fornecedor", "Nota fiscal",
     "Situação", "Fechada em", "Registrada por"],
    avariasFiltradas().map(a => [
      formatarData(a.aberto_em), a.solicitacao_codigo, a.projeto, a.equipamento,
      a.gravidade, a.descricao, a.causa, a.responsavel, a.providencia,
      csvNumero(a.custo_estimado), a.custo_real == null ? "" : csvNumero(a.custo_real),
      a.fornecedor, a.nota_fiscal, a.situacao,
      a.fechado_em ? formatarData(a.fechado_em) : "", a.usuario_nome,
    ]));
}

// ══════════════════════════════════════════════════════
//  HELPERS (os mesmos do Controle de Estoque)
// ══════════════════════════════════════════════════════
function mostrarToast(msg, tipo) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (tipo === "ok" ? " toast-ok" : tipo === "err" ? " toast-err" : "");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 3400);
}
function abrirModal(id) { document.getElementById(id).classList.add("active"); }
function fecharModal(id) { document.getElementById(id).classList.remove("active"); }
function esc(str) { return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
// "Edição" → "edicao". Serve para virar nome de classe CSS: trocar letra
// por letra deixaria o "ã" de "edição" para trás, e a classe não casaria
// com nada.
function semAcento(texto) {
  return String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function maiusc(texto) { return String(texto || "").toUpperCase(); }
function formatarData(data) { if (!data) return "-"; const d = new Date(data); return isNaN(d) ? "-" : d.toLocaleDateString("pt-BR"); }
function formatarDataHora(data) { if (!data) return "-"; const d = new Date(data); return isNaN(d) ? "-" : d.toLocaleString("pt-BR"); }
function formatarMoeda(valor) { return (Number(valor) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
// Número no formato que a máscara de moeda espera de volta ("1.234,56").
// É o caminho inverso de parseMoeda, e existe para carregar um valor do
// banco num campo mascarado sem ele virar "1234.56".
function formatarNumeroBR(valor) {
  const n = Number(valor);
  if (!isFinite(n) || n === 0) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// "1.234,56" (o que a máscara escreve) → 1234.56
function parseMoeda(texto) {
  return parseFloat(String(texto || "0").replace(/\./g, "").replace(",", ".")) || 0;
}
function dataBRparaISO(v) {
  if (!v) return "";
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}
function dataISOparaBR(v) {
  if (!v) return "";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}
function mascaraDataId(id) {
  const el = document.getElementById(id); if (!el) return;
  let v = el.value.replace(/\D/g, "").slice(0, 8);
  v = v.replace(/(\d{2})(\d)/, "$1/$2").replace(/(\d{2})(\d)/, "$1/$2");
  el.value = v;
}
// Versão da máscara de data que recebe o elemento: as linhas de
// hospedagem são criadas em série e não têm id próprio.
function mascaraDataEl(el) {
  if (!el) return;
  // As barras invertidas destas classes tinham se perdido (`\D` virou `D`,
  // `\d` virou `d`), e a máscara das linhas de hospedagem não formatava
  // nada — aceitava letra e não punha as barras.
  let v = el.value.replace(/\D/g, "").slice(0, 8);
  v = v.replace(/(\d{2})(\d)/, "$1/$2").replace(/(\d{2})(\d)/, "$1/$2");
  el.value = v;
}
function mascaraHoraId(id) {
  const el = document.getElementById(id); if (!el) return;
  let v = el.value.replace(/\D/g, "").slice(0, 4);
  v = v.replace(/(\d{2})(\d)/, "$1:$2");
  el.value = v;
}
function mascaraCpfId(id) {
  const el = document.getElementById(id); if (!el) return;
  let v = el.value.replace(/\D/g, "").slice(0, 11);
  v = v.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1-$2");
  el.value = v;
}
// Versão da máscara de moeda que recebe o elemento: as linhas de despesa
// e diária são criadas em série e não têm id próprio.
function mascaraMoedaEl(el) {
  if (!el) return;
  const v = el.value.replace(/[^\d,]/g, "");
  const partes = v.split(",");
  const inteiro = partes[0].replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const decimal = partes.length > 1 ? "," + partes[1].slice(0, 2) : "";
  el.value = inteiro + decimal;
}

// ══════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {
  applyTheme(localStorage.getItem(THEME_KEY) || "light");
  initLoginEvents();
  SESSAO = await carregarSessao();
  if (SESSAO) await mostrarApp();
  else mostrarLogin();
});
