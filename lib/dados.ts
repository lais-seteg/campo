// ═══════════════════════════════════════════════════════════════════════
//  LEITURA DO BANCO — um lugar só, no servidor.
//
//  É o que era `carregarDB()` no script.js, com duas diferenças que
//  importam: roda no servidor (o navegador não fala mais com o Supabase) e
//  devolve dado tipado em vez de um objeto global mutável.
//
//  ── O SISTEMA CONTINUA DE PÉ COM O BANCO INCOMPLETO ──
//
//  Enquanto 01_solicitacoes.sql não rodar, o app entra, avisa na tela que
//  a estrutura está pendente e continua navegável. Enquanto
//  02_campo_v2.sql não rodar, ele funciona SEM reserva de material,
//  calendário e previsto × real — e diz isso, em vez de fingir. É por isso
//  que as tabelas da v2 são lidas soltas e não como embed: uma faltando
//  não pode invalidar a consulta inteira.
// ═══════════════════════════════════════════════════════════════════════

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { tabelaNaoExiste } from "@/lib/erros";
import type {
  AvariaResolvida,
  Colaborador,
  DadosCampo,
  DiariaValor,
  EstadoEstrutura,
  Hotel,
  Item,
  ItemDisponivel,
  ItemReserva,
  Perfil,
  Projeto,
  ProjetoGastoPrevisto,
  Solicitacao,
  SolicitacaoDeLista,
  SolicitacaoAlteracao,
  SolicitacaoAssinatura,
  SolicitacaoAvaria,
  SolicitacaoDespesa,
  SolicitacaoDiaria,
  SolicitacaoEpi,
  SolicitacaoEquipamento,
  SolicitacaoEquipe,
  SolicitacaoHospedagem,
} from "@/lib/tipos";

/** As colunas do embed de 01_solicitacoes.sql — as quatro tabelas-filhas
 *  que existem desde o começo e podem vir na mesma consulta. */
const SELECT_SOLICITACOES =
  "*, solicitacao_equipamentos(*), solicitacao_hospedagens(*), solicitacao_despesas(*), solicitacao_diarias(*)";

interface LinhaComEmbed {
  id: string;
  solicitacao_equipamentos?: SolicitacaoEquipamento[] | null;
  solicitacao_hospedagens?: SolicitacaoHospedagem[] | null;
  solicitacao_despesas?: SolicitacaoDespesa[] | null;
  solicitacao_diarias?: SolicitacaoDiaria[] | null;
  [coluna: string]: unknown;
}

/** Agrupa uma lista plana pelo id da solicitação. */
function porSolicitacao<T extends { solicitacao_id: string }>(lista: readonly T[]): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const linha of lista) {
    const atual = mapa.get(linha.solicitacao_id);
    if (atual) atual.push(linha);
    else mapa.set(linha.solicitacao_id, [linha]);
  }
  return mapa;
}

interface Ordem {
  campo: string;
  ascendente?: boolean;
}

/**
 * Lê uma tabela da v2 sem derrubar o resto. Enquanto 02_campo_v2.sql não
 * rodar, essas relações não existem — e a tela precisa continuar de pé,
 * com menos recurso e dizendo qual.
 *
 * `estrutura` é mutado de propósito: é o acumulador da leitura inteira, e
 * basta uma tabela faltando para a v2 estar incompleta.
 */
async function lerV2<T>(
  sb: SupabaseClient,
  estrutura: EstadoEstrutura,
  tabela: string,
  ordem?: Ordem,
  daSolicitacao?: string
): Promise<T[]> {
  let consulta = sb.from(tabela).select("*");
  if (daSolicitacao) consulta = consulta.eq("solicitacao_id", daSolicitacao);
  if (ordem) consulta = consulta.order(ordem.campo, { ascending: ordem.ascendente !== false });

  const { data, error } = await consulta;
  if (error) {
    if (tabelaNaoExiste(error)) {
      estrutura.v2 = false;
      return [];
    }
    // Erro que não é "tabela não existe" (permissão, rede) não deve
    // derrubar a tela inteira: registra e segue com a lista vazia. A tela
    // mostra o que conseguiu carregar.
    console.error(`[dados] falha ao carregar ${tabela}`, error);
    return [];
  }
  return (data ?? []) as T[];
}

/**
 * Carrega tudo que as telas precisam, numa chamada.
 *
 * Sim, é uma leitura ampla — a versão anterior fazia o mesmo e as telas
 * dependem de cruzamento entre as listas (o calendário precisa de equipe +
 * projeto + período; o painel precisa de todas). O volume é o de uma
 * operação de campo de uma empresa, não de um marketplace.
 *
 * `cache()` do React memoiza POR REQUISIÇÃO (não entre requisições, não
 * entre pessoas). Sem ele, o layout — que precisa dos números das abas —
 * e a página dentro dele fariam a mesma dúzia de consultas duas vezes na
 * mesma navegação. A chave é o argumento, e o argumento é o token de quem
 * está pedindo: dois usuários nunca compartilham entrada.
 */
export const carregarDados = cache(async (accessToken: string): Promise<DadosCampo> => {
  const sb = clienteDoUsuario(accessToken);
  const estrutura: EstadoEstrutura = { base: true, v2: true };

  // ── TUDO NUMA RODADA, E NÃO UMA ESPERANDO A OUTRA ──
  //
  // Antes o catálogo, as solicitações e os perfis eram lidos EM SÉRIE, um
  // `await` atrás do outro, e só depois vinha o `Promise.all` do resto.
  // Nenhuma das três depende das outras — a série era acidente, não regra —
  // e cada uma custava uma ida completa ao Supabase. Numa navegação isso
  // eram quatro esperas de rede empilhadas antes de a tela começar a
  // existir; agora são duas (esta rodada e a leitura do perfil na sessão).
  //
  // A ordem de `estrutura` continua correta porque `lerV2` só ESCREVE
  // `false` nela: várias tabelas faltando não competem entre si, todas
  // chegam à mesma conclusão.
  const [
    catalogo,
    respostaSolicitacoes,
    perfis,
    projetos,
    gastosPrevistos,
    hoteis,
    diarias,
    equipe,
    epis,
    avarias,
    reservas,
  ] = await Promise.all([
    // O catálogo vem do Controle de Estoque — mesma tabela, mesmo banco.
    lerCatalogo(sb),
    sb.from("solicitacoes").select(SELECT_SOLICITACOES).order("criado_em", { ascending: false }),
    // A política de `perfis` já libera consulta para usuário ativo (é a
    // mesma que o Controle de Estoque usa), então não é dado novo exposto.
    lerPerfis(sb),
    lerV2<Projeto>(sb, estrutura, "projetos", { campo: "cliente" }),
    // Volta VAZIA para quem a RLS não deixa ver valor — técnico que não
    // lidera projeto. Não é erro nem estrutura faltando: é
    // `pode_ver_valores()` fazendo o trabalho dele.
    lerV2<ProjetoGastoPrevisto>(sb, estrutura, "projeto_gastos_previstos", { campo: "categoria" }),
    lerV2<Hotel>(sb, estrutura, "hoteis", { campo: "municipio" }),
    lerV2<DiariaValor>(sb, estrutura, "diaria_valores", { campo: "tipo_diaria" }),
    lerV2<SolicitacaoEquipe>(sb, estrutura, "solicitacao_equipe"),
    lerV2<SolicitacaoEpi>(sb, estrutura, "solicitacao_sst_epis"),
    lerV2<SolicitacaoAvaria>(sb, estrutura, "solicitacao_avarias", {
      campo: "aberto_em",
      ascendente: false,
    }),
    lerV2<ItemReserva>(sb, estrutura, "item_reservas"),
    // `solicitacao_assinaturas` e `solicitacao_alteracoes` NÃO entram aqui
    // — ver o comentário de `carregarFilhasDaSolicitacao`. Eram as duas
    // tabelas que mais cresciam e as únicas que nenhuma tela de lista usa.
  ]);

  const { data: linhas, error: erroSolicitacoes } = respostaSolicitacoes;

  if (erroSolicitacoes) {
    estrutura.base = !tabelaNaoExiste(erroSolicitacoes);
    if (estrutura.base) console.error("[dados] falha ao carregar solicitações", erroSolicitacoes);
    return vazio(catalogo, { base: estrutura.base, v2: false });
  }

  const deEquipe = porSolicitacao(equipe);
  const deEpis = porSolicitacao(epis);
  const deAvarias = porSolicitacao(avarias);
  const deReservas = porSolicitacao(reservas);

  const solicitacoes: SolicitacaoDeLista[] = ((linhas ?? []) as unknown as LinhaComEmbed[]).map(
    (linha) => ({
      ...(linha as unknown as SolicitacaoDeLista),
      equipamentos: linha.solicitacao_equipamentos ?? [],
      hospedagens: linha.solicitacao_hospedagens ?? [],
      despesas: linha.solicitacao_despesas ?? [],
      diarias: linha.solicitacao_diarias ?? [],
      equipe: deEquipe.get(linha.id) ?? [],
      epis: deEpis.get(linha.id) ?? [],
      avarias: deAvarias.get(linha.id) ?? [],
      reservas: deReservas.get(linha.id) ?? [],
    })
  );

  return {
    solicitacoes,
    catalogo,
    projetos,
    gastosPrevistos,
    hoteis,
    diarias,
    avarias: resolverAvarias(avarias, solicitacoes, catalogo),
    perfis,
    estrutura,
  };
});

/**
 * As duas listas filhas que o carregamento global NÃO traz: assinatura e
 * histórico de alteração, de UMA solicitação.
 *
 * ── POR QUE ELAS SAÍRAM DE `carregarDados` ──
 *
 * `solicitacao_assinaturas` guarda o PNG desenhado na tela (até 400 mil
 * caracteres por assinatura, quatro por pedido) e `solicitacao_alteracoes` é
 * o log de auditoria, que cresce para sempre. Enquanto estavam na leitura
 * global, abrir o CALENDÁRIO trazia todas as assinaturas e todo o histórico
 * da empresa — duas idas ao banco e um payload que só cresce, para uma tela
 * que não mostra nenhum dos dois.
 *
 * Aqui elas custam duas idas em UMA tela, a que realmente as mostra.
 *
 * `cache()` porque o detalhe e o checklist podem pedir as mesmas na mesma
 * requisição.
 */
export const carregarFilhasDaSolicitacao = cache(
  async (
    accessToken: string,
    id: string
  ): Promise<{ assinaturas: SolicitacaoAssinatura[]; alteracoes: SolicitacaoAlteracao[] }> => {
    const sb = clienteDoUsuario(accessToken);
    // `estrutura` local e descartada: quem avisa que a v2 está pendente é o
    // carregamento global, no layout. Aqui ela só existe porque `lerV2`
    // pede um acumulador.
    const estrutura: EstadoEstrutura = { base: true, v2: true };

    const [assinaturas, alteracoes] = await Promise.all([
      lerV2<SolicitacaoAssinatura>(sb, estrutura, "solicitacao_assinaturas", undefined, id),
      lerV2<SolicitacaoAlteracao>(
        sb,
        estrutura,
        "solicitacao_alteracoes",
        { campo: "data", ascendente: false },
        id
      ),
    ]);

    return { assinaturas, alteracoes };
  }
);

/**
 * A avaria guarda o id do equipamento, não o nome. Resolver aqui, uma vez,
 * deixa o relatório e o painel simples — em vez de cada linha da tela
 * cruzar três listas.
 */
function resolverAvarias(
  avarias: readonly SolicitacaoAvaria[],
  // `Pick` e não a solicitação inteira: esta função só precisa do código e
  // do nome do projeto, e declarar isso é o que a deixa indiferente a
  // quantas listas filhas a solicitação carrega.
  solicitacoes: readonly Pick<Solicitacao, "id" | "codigo" | "cliente_projeto">[],
  catalogo: readonly Item[]
): AvariaResolvida[] {
  const porId = new Map(solicitacoes.map((s) => [s.id, s]));
  const itemPorId = new Map(catalogo.map((i) => [i.id, i]));

  return avarias.map((a) => {
    const solicitacao = porId.get(a.solicitacao_id);
    const item = a.item_id ? itemPorId.get(a.item_id) : undefined;
    return {
      ...a,
      solicitacao_codigo: solicitacao?.codigo ?? "—",
      projeto: solicitacao?.cliente_projeto ?? "—",
      equipamento: item ? `${item.produto} · ${item.codigo}` : "Item fora do catálogo",
    };
  });
}

async function lerCatalogo(sb: SupabaseClient): Promise<Item[]> {
  const { data, error } = await sb
    .from("itens")
    .select("id,codigo,produto,categoria,estoque_atual,em_manutencao")
    .order("produto", { ascending: true });
  if (error) {
    console.error("[dados] falha ao carregar o catálogo de itens", error);
    return [];
  }
  return (data ?? []) as Item[];
}

async function lerPerfis(sb: SupabaseClient): Promise<Perfil[]> {
  // `select` explícito, e não `*`: `perfis` é do Controle de Estoque e
  // pode ganhar coluna que não é da conta deste sistema.
  const { data, error } = await sb
    .from("perfis")
    .select("id,usuario,nome,papel,cargo,ativo")
    .eq("ativo", true)
    .order("nome");
  if (error) {
    console.error("[dados] falha ao carregar perfis", error);
    return [];
  }
  return (data ?? []) as Perfil[];
}

function vazio(catalogo: Item[], estrutura: EstadoEstrutura): DadosCampo {
  return {
    solicitacoes: [],
    catalogo,
    projetos: [],
    gastosPrevistos: [],
    hoteis: [],
    diarias: [],
    avarias: [],
    perfis: [],
    estrutura,
  };
}

/**
 * O ORGANOGRAMA — e por que ele NÃO entra em `carregarDados`.
 *
 * `carregarDados` é chamada por toda tela, porque o layout precisa dos
 * números das abas. Só a Direção lê `colaboradores` (é a RLS que decide
 * isso), então incluí-la lá somaria uma ida ao banco em cada navegação de
 * cada pessoa para uma lista que quase ninguém pode ver — e que voltaria
 * vazia por política, não por não existir.
 *
 * Aqui ela custa uma ida nas duas telas que a usam: o organograma e o
 * cadastro de projetos, que tira dela quem pode ser líder.
 *
 * `existe` distingue as duas maneiras de a lista voltar vazia:
 * 08_organograma.sql não foi rodado (a tela avisa) ou não há colaborador
 * cadastrado (a tela convida a cadastrar). Sem essa distinção, banco
 * incompleto viraria "nenhum colaborador", e alguém cadastraria trinta
 * nomes contra uma tabela que não existe.
 *
 * `cache()` porque o cadastro de projetos e o organograma podem pedir a
 * mesma lista na mesma requisição.
 */
export const carregarColaboradores = cache(
  async (accessToken: string): Promise<{ colaboradores: Colaborador[]; existe: boolean }> => {
    const sb = clienteDoUsuario(accessToken);
    const { data, error } = await sb
      .from("colaboradores")
      .select("*")
      .order("nome", { ascending: true });

    if (error) {
      if (tabelaNaoExiste(error)) return { colaboradores: [], existe: false };
      console.error("[dados] falha ao carregar colaboradores", error);
      return { colaboradores: [], existe: true };
    }
    return { colaboradores: (data ?? []) as Colaborador[], existe: true };
  }
);

/**
 * O catálogo visto PELAS DATAS do campo — e não o saldo do estoque.
 *
 * São coisas diferentes: um medidor que está na prateleira hoje pode já
 * estar comprometido com outro campo na semana que vem. Item em manutenção
 * aparece na lista com disponível zero, em vez de sumir: quem está pedindo
 * precisa saber por que não pode levar.
 *
 * @param ignorar id da solicitação que está sendo editada — o material que
 *   ela já reservou não deve aparecer como indisponível para ela mesma.
 */
export async function carregarDisponibilidade(
  accessToken: string,
  inicio: string,
  fim: string,
  ignorar: string | null
): Promise<ItemDisponivel[]> {
  const sb = clienteDoUsuario(accessToken);
  const { data, error } = await sb.rpc("itens_disponiveis_no_periodo", {
    p_inicio: inicio,
    p_fim: fim,
    p_ignorar_solicitacao: ignorar,
  });
  if (error) throw error;
  return (data ?? []) as ItemDisponivel[];
}

/**
 * Uma solicitação só, com os filhos — para as rotas que precisam conferir o
 * estado antes de gravar (fechar logística, registrar conferência).
 *
 * Também SEM assinatura e SEM histórico: quem chama é rota de escrita, que
 * confere status, equipamento e reserva. Carregá-las aqui significava
 * transferir até 1,6 MB de PNG em cada logística fechada, para não ler
 * nenhum deles. Quem precisa das duas usa `carregarFilhasDaSolicitacao`.
 */
export async function carregarSolicitacao(
  accessToken: string,
  id: string
): Promise<SolicitacaoDeLista | null> {
  const sb = clienteDoUsuario(accessToken);
  const estrutura: EstadoEstrutura = { base: true, v2: true };

  const { data, error } = await sb
    .from("solicitacoes")
    .select(SELECT_SOLICITACOES)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;

  const linha = data as unknown as LinhaComEmbed;

  const [equipe, epis, avarias, reservas] = await Promise.all([
    lerV2<SolicitacaoEquipe>(sb, estrutura, "solicitacao_equipe", undefined, id),
    lerV2<SolicitacaoEpi>(sb, estrutura, "solicitacao_sst_epis", undefined, id),
    lerV2<SolicitacaoAvaria>(sb, estrutura, "solicitacao_avarias", { campo: "aberto_em", ascendente: false }, id),
    lerV2<ItemReserva>(sb, estrutura, "item_reservas", undefined, id),
  ]);

  return {
    ...(linha as unknown as SolicitacaoDeLista),
    equipamentos: linha.solicitacao_equipamentos ?? [],
    hospedagens: linha.solicitacao_hospedagens ?? [],
    despesas: linha.solicitacao_despesas ?? [],
    diarias: linha.solicitacao_diarias ?? [],
    equipe,
    epis,
    avarias,
    reservas,
  };
}
