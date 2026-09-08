// ═══════════════════════════════════════════════════════════════════════
//  PAINEL
//
//  ── DE QUEM É ESTE PAINEL (v3) ──
//
//  Antes ele abria para qualquer usuário ativo, com o previsto × real da
//  empresa inteira. Agora valor é de quem responde por ele:
//
//    · LÍDER      → vê o painel DOS PROJETOS DELE. As somas partem da
//                   lista dos projetos que ele lidera, não da lista
//                   inteira com um filtro esquecido numa linha;
//    · administrativo, financeiro e Direção → veem o consolidado, porque
//                   olhar o todo é a função deles;
//    · quem não é nenhum dos dois → não tem a aba e não abre a rota.
//
//  A tela sumir não é a barreira: a barreira é a RLS
//  (`pode_ver_valores()`), que não entrega a linha de gasto do projeto a
//  quem não pode ver. Aqui se esconde a pergunta; lá se impede a resposta.
//
//  ── AVARIA É GASTO ──
//
//  `real_avaria` já vem somado no `real_total` pelo trigger do banco. O
//  Painel só o mostra em coluna própria, para o desvio ter explicação: o
//  campo estourou o previsto porque gastou mais, ou porque quebrou um
//  medidor?
//
//  Tudo é contado NO SERVIDOR: são somas sobre a lista que já foi
//  carregada, e não há filtro nem interação a fazer aqui.
// ═══════════════════════════════════════════════════════════════════════

import { redirect } from "next/navigation";
import { exigirSessao } from "@/lib/sessao";
import { carregarDados } from "@/lib/dados";
import { CabecalhoDeSecao, Selo, TabelaVazia } from "@/app/components/Tabela";
import { Icone, type NomeDeIcone } from "@/app/components/Icone";
import { formatarMoeda } from "@/lib/formato";
import { porStatus } from "@/lib/consultas";
import { podeAbrirPainel, projetosVisiveis, veTodosOsProjetos } from "@/lib/papeis";
import type { Projeto, SolicitacaoDeLista, StatusCurso } from "@/lib/tipos";

export const dynamic = "force-dynamic";

/** A janela do indicador de previsto × real. */
const DIAS_DA_JANELA = 90;

export default async function PaginaDePainel() {
  const usuario = await exigirSessao();
  const dados = await carregarDados(usuario.accessToken);

  // Checagem AUTORITATIVA — o menu já não mostra a aba, mas menu escondido
  // não é permissão: a URL continua digitável. Vai para /solicitacoes, e
  // não para o login: o problema não é a sessão.
  if (!podeAbrirPainel(usuario, dados.projetos)) {
    redirect("/solicitacoes");
  }

  const consolidado = veTodosOsProjetos(usuario);
  const projetos = projetosVisiveis(usuario, dados.projetos);
  const idsVisiveis = new Set(projetos.map((p) => p.id));

  // O líder vê o campo DOS PROJETOS DELE. Pedido cujo projeto foi excluído
  // (projeto_id nulo) entra só no consolidado: ele não é de líder nenhum, e
  // esconder do consolidado seria perder dinheiro de vista.
  const solicitacoes = consolidado
    ? dados.solicitacoes
    : dados.solicitacoes.filter((s) => s.projeto_id && idsVisiveis.has(s.projeto_id));

  const idsDasSolicitacoes = new Set(solicitacoes.map((s) => s.id));
  const avarias = consolidado
    ? dados.avarias
    : dados.avarias.filter((a) => idsDasSolicitacoes.has(a.solicitacao_id));

  const gastosPrevistos = consolidado
    ? dados.gastosPrevistos
    : dados.gastosPrevistos.filter((g) => idsVisiveis.has(g.projeto_id));

  const corte = Date.now() - DIAS_DA_JANELA * 24 * 60 * 60 * 1000;
  const recentes = solicitacoes.filter((s) => new Date(s.criado_em).getTime() >= corte);
  const previsto = recentes.reduce((t, s) => t + (Number(s.previsto_total) || 0), 0);
  const real = recentes.reduce((t, s) => t + (Number(s.real_total) || 0), 0);

  const porCurso = (curso: StatusCurso) => solicitacoes.filter((s) => s.status_curso === curso);
  const abaixo = porCurso("Abaixo do previsto");
  const acima = porCurso("Acima do previsto");
  const economia = abaixo.reduce((t, s) => t + Math.abs(Number(s.desvio_valor) || 0), 0);
  const excesso = acima.reduce((t, s) => t + Math.abs(Number(s.desvio_valor) || 0), 0);

  // SST desde a v3 é UMA marca: se aplica ou não se aplica. Então o que se
  // conta não é "quantos estão conformes" (não há mais meia conferência), e
  // sim em quantos campos a segurança está em jogo.
  const comSst = solicitacoes.filter((s) => s.sst_aplicavel).length;

  const custoDeAvaria = solicitacoes.reduce((t, s) => t + (Number(s.real_avaria) || 0), 0);
  const avariasEmAberto = avarias.filter((a) => a.situacao === "Aberta" || a.situacao === "Em reparo").length;

  const hoje = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const linhasPorProjeto = consolidarPorProjeto(projetos, solicitacoes, gastosPrevistos);

  return (
    <section className="secao active">
      <CabecalhoDeSecao
        titulo={consolidado ? "Painel" : "Painel · meus projetos"}
        direita={hoje}
      />

      {!consolidado ? (
        <p className="filter-resumo" style={{ marginBottom: ".6rem" }}>
          Os números abaixo são só dos {projetos.length} projeto(s) que você lidera.
        </p>
      ) : null}

      {/* ── FAIXA DE INDICADORES EM CIMA, TABELA COM A LARGURA INTEIRA ──
          Os dez cartões deitam numa faixa horizontal no topo; a tabela de
          gasto por projeto, que tem oito colunas, fica com a largura da
          tela. Já esteve em duas colunas, com os cartões de pé à direita —
          cabia, mas custava 21rem de largura à tabela, e era ali que doía.

          A faixa é baixa de propósito (cartões no tamanho do conteúdo,
          sublinha em no máximo duas linhas): faixa alta empurraria a tabela
          para fora da primeira tela, que foi o problema original. Ver
          `.painel-corpo` em globals.css.

          Os indicadores vêm ANTES no HTML, que é a ordem de leitura do
          Painel e a que o leitor de tela anuncia — e agora também a ordem
          na tela, sem inversão nenhuma no CSS. */}
      <div className="painel-corpo">
        <aside className="painel-lateral" aria-label="Indicadores">
          <div className="kpi-row">
            <Kpi
              cor="red"
              icone="relogio"
              rotulo="Aguardando líder"
              valor={String(porStatus(solicitacoes, "Aguardando aprovação").length)}
              sub="Esperando aprovação do projeto"
            />
            <Kpi
              cor="orange"
              icone="logistica"
              rotulo="Logística a fechar"
              valor={String(porStatus(solicitacoes, "Aprovada").length)}
              sub="Aprovados: veículo, hotel e material"
            />
            <Kpi
              cor="purple"
              icone="caminhao"
              rotulo="Em campo"
              valor={String(porStatus(solicitacoes, "Em campo").length)}
              sub="Equipamento entregue, não devolvido"
            />
            <Kpi
              cor="blue"
              icone="grafico"
              rotulo="Previsto × Real"
              valor={`${formatarMoeda(real)} / ${formatarMoeda(previsto)}`}
              sub={
                previsto > 0
                  ? `Real sobre previsto nos últimos ${DIAS_DA_JANELA} dias · ${((real / previsto) * 100).toFixed(0)}%`
                  : `Nenhum previsto informado nos últimos ${DIAS_DA_JANELA} dias`
              }
            />
            <Kpi
              cor="green"
              icone="escudo"
              rotulo="Campos com SST"
              valor={String(comSst)}
              sub={`de ${solicitacoes.length} campo(s) · marcados como "se aplica"`}
            />
            <Kpi
              cor="teal"
              icone="avaria"
              rotulo="Custo de avaria"
              valor={formatarMoeda(custoDeAvaria)}
              sub={`${avarias.length} avaria(s) · ${avariasEmAberto} em aberto · já somado no real`}
            />
          </div>

          {/* Status de curso: quantos campos ficaram abaixo, dentro e acima do
              previsto. A faixa de tolerância é de 5% — é o BANCO que calcula,
              aqui só se conta. */}
          <div className="curso-row">
            <div className="curso-card curso-abaixo">
              <span>Abaixo do previsto</span>
              <strong>{abaixo.length}</strong>
              <em>{formatarMoeda(economia)} economizados</em>
            </div>
            <div className="curso-card curso-dentro">
              <span>Dentro do previsto</span>
              <strong>{porCurso("Dentro do previsto").length}</strong>
              <em>Desvio de até 5%</em>
            </div>
            <div className="curso-card curso-acima">
              <span>Acima do previsto</span>
              <strong>{acima.length}</strong>
              <em>{formatarMoeda(excesso)} a mais</em>
            </div>
            <div className="curso-card curso-sem">
              <span>Sem realizado</span>
              <strong>{porCurso("Sem realizado").length}</strong>
              <em>Aguardando o gasto real</em>
            </div>
          </div>
        </aside>

        {/* ══ GASTO DO PROJETO ══
            O previsto vem do CADASTRO da Direção (gasto previsto por
            categoria, valor total do projeto); o real vem da soma dos campos
            — avaria incluída. São as duas pontas que ninguém conseguia ver
            juntas antes: orçamento do projeto e o que ele custou de fato. */}
        <div className="lista-wrapper">
          <div className="table-wrapper">
            <div className="table-scroll">
              <table className="art-table tabela-centralizada">
                <thead>
                  <tr>
                    <th>Projeto</th>
                    <th>Líder</th>
                    <th>Situação</th>
                    <th>Campos</th>
                    <th>Gasto previsto</th>
                    <th>Real dos campos</th>
                    <th>Sendo avaria</th>
                    <th>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasPorProjeto.map((l) => (
                    <tr key={l.projeto.id}>
                      <td>
                        {l.projeto.cliente} | {l.projeto.nome}
                      </td>
                      {/* O líder virou COLUNA (antes era uma sublinha sob o
                          nome do projeto): é por ele que se filtra e se
                          cobra, então merece coluna própria e ordenável a
                          olho, não letra miúda. Projeto sem líder aparece
                          marcado — é o que trava o campo dele para sempre,
                          porque o pedido nasceria esperando decisão de
                          ninguém. */}
                      <td>
                        {l.projeto.lider ?? <Selo texto="Sem líder" classe="st-ruim" />}
                      </td>
                      <td>{l.projeto.situacao}</td>
                      <td>{l.campos}</td>
                      <td>{l.previsto > 0 ? formatarMoeda(l.previsto) : "—"}</td>
                      <td>{formatarMoeda(l.real)}</td>
                      <td>{l.avaria > 0 ? formatarMoeda(l.avaria) : "—"}</td>
                      <td>
                        {/* Sem gasto previsto cadastrado não há saldo a
                            mostrar — mostrar "−R$ 3.000" contra um previsto
                            de zero acusaria estouro onde só falta cadastro. */}
                        {l.previsto > 0 ? (
                          <Selo
                            texto={`${l.saldo < 0 ? "−" : ""}${formatarMoeda(Math.abs(l.saldo))}`}
                            classe={l.saldo < 0 ? "st-ruim" : "st-ok"}
                          />
                        ) : (
                          <Selo texto="Sem previsto" classe="st-perto" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TabelaVazia visivel={linhasPorProjeto.length === 0}>
                <strong>Nenhum projeto para mostrar</strong>
                <p>
                  {consolidado
                    ? "Cadastre projetos na aba Projetos."
                    : "Você não lidera nenhum projeto cadastrado."}
                </p>
              </TabelaVazia>
            </div>
          </div>
        </div>
      </div>

      {/* Havia uma SEGUNDA tabela aqui, com as doze últimas solicitações.
          Ela saiu: repetia a aba Solicitações, que faz isso melhor (com
          filtro, busca, paginação e exportação), e roubava do Painel a
          única tabela que só ele tem — o gasto por projeto. Painel é para
          decidir olhando o todo; lista de pedido tem tela própria. */}
    </section>
  );
}

interface LinhaDeProjeto {
  projeto: Projeto;
  campos: number;
  previsto: number;
  real: number;
  avaria: number;
  saldo: number;
}

/**
 * Junta as duas pontas do dinheiro de cada projeto: o PREVISTO que a
 * Direção cadastrou (soma das categorias de gasto) e o REAL que os campos
 * consumiram (soma do `real_total`, avaria já incluída pelo banco).
 *
 * Os projetos vêm ordenados por real gasto, decrescente: quem abre o
 * Painel quer ver primeiro onde o dinheiro está indo.
 */
function consolidarPorProjeto(
  projetos: readonly Projeto[],
  solicitacoes: readonly SolicitacaoDeLista[],
  gastos: readonly { projeto_id: string; valor: number }[]
): LinhaDeProjeto[] {
  const previstoPorProjeto = new Map<string, number>();
  for (const g of gastos) {
    previstoPorProjeto.set(g.projeto_id, (previstoPorProjeto.get(g.projeto_id) ?? 0) + (Number(g.valor) || 0));
  }

  const realPorProjeto = new Map<string, number>();
  const avariaPorProjeto = new Map<string, number>();
  const camposPorProjeto = new Map<string, number>();
  for (const s of solicitacoes) {
    if (!s.projeto_id) continue;
    camposPorProjeto.set(s.projeto_id, (camposPorProjeto.get(s.projeto_id) ?? 0) + 1);
    realPorProjeto.set(s.projeto_id, (realPorProjeto.get(s.projeto_id) ?? 0) + (Number(s.real_total) || 0));
    avariaPorProjeto.set(s.projeto_id, (avariaPorProjeto.get(s.projeto_id) ?? 0) + (Number(s.real_avaria) || 0));
  }

  return projetos
    .map((projeto) => {
      const previsto = previstoPorProjeto.get(projeto.id) ?? 0;
      const real = realPorProjeto.get(projeto.id) ?? 0;
      return {
        projeto,
        campos: camposPorProjeto.get(projeto.id) ?? 0,
        previsto,
        real,
        avaria: avariaPorProjeto.get(projeto.id) ?? 0,
        saldo: previsto - real,
      };
    })
    .sort((a, b) => b.real - a.real);
}

function Kpi({
  cor,
  icone,
  rotulo,
  valor,
  sub,
}: {
  cor: string;
  icone: NomeDeIcone;
  rotulo: string;
  valor: string;
  sub: string;
}) {
  return (
    <div className={`kpi-card kpi-${cor}`}>
      <div className={`kpi-icon-wrap kpi-bg-${cor}`}>
        <Icone nome={icone} tamanho={20} />
      </div>
      <div>
        <div className="kpi-label">{rotulo}</div>
        <strong className="kpi-value">{valor}</strong>
        <div className="kpi-sub">{sub}</div>
      </div>
    </div>
  );
}
