"use client";

// ═══════════════════════════════════════════════════════════════════════
//  A LISTA DE SOLICITAÇÕES
//
//  Filtro, paginação e exportação acontecem no cliente, sobre os dados que
//  o servidor já mandou — como na versão anterior. Não é preguiça: o
//  volume é o de uma operação de campo de uma empresa, e filtrar no
//  servidor custaria uma ida ao banco a cada tecla digitada na busca.
//
//  O que mudou: a tela não monta mais HTML com template string. Cada
//  `esc()` esquecido ali era um XSS esperando um nome de projeto com
//  `<script>`; aqui o React escapa por construção.
// ═══════════════════════════════════════════════════════════════════════

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Modal } from "@/app/components/Modal";
import { FormularioDeSolicitacao } from "@/app/(sistema)/solicitacoes/formulario/FormularioDeSolicitacao";
import {
  formularioDeSolicitacao,
  formularioVazio,
  type EstadoDoFormulario,
} from "@/app/(sistema)/solicitacoes/formulario/estado";
import { podeEditar } from "@/lib/papeis";
import {
  STATUS_CURSO,
  STATUS_SOLICITACAO,
  TIPOS_SOLICITACAO,
  type EstadoEstrutura,
  type DiariaValor,
  type Hotel,
  type Item,
  type Perfil,
  type Projeto,
  type SolicitacaoDeLista,
} from "@/lib/tipos";
import {
  FILTROS_VAZIOS,
  equipeResumo,
  filtrarSolicitacoes,
  periodoTexto,
  previstoContraReal,
  totalDaSolicitacao,
  type FiltrosDeSolicitacao,
} from "@/lib/consultas";
import { classeDoStatus } from "@/lib/listas";
import { csvNumero, dataISOparaBR, diasDeCampo, formatarMoeda } from "@/lib/formato";
import { BotaoExportarCsv, CabecalhoDeSecao, Paginacao, Selo, TabelaVazia } from "@/app/components/Tabela";
import { Icone } from "@/app/components/Icone";
import { RegistrarConferencia } from "@/app/(sistema)/conferencia/RegistrarConferencia";
import { ChecklistEmPopup } from "@/app/(sistema)/solicitacoes/[id]/checklist/ChecklistEmPopup";
import { DetalheEmPopup } from "@/app/(sistema)/solicitacoes/[id]/DetalheEmPopup";
import { AjusteEmCampo } from "@/app/(sistema)/solicitacoes/[id]/AjusteEmCampo";

/** Onde o atalho de conferência da lista faz sentido — o mesmo intervalo
 *  que `solicitacoesParaConferencia` usa para montar a fila da aba. */
function aceitaConferencia(s: SolicitacaoDeLista): boolean {
  if (!s.equipamentos.length) return false;
  return s.status === "Aprovada" || s.status === "Logística confirmada" || s.status === "Em campo";
}

interface Props {
  solicitacoes: SolicitacaoDeLista[];
  estrutura: EstadoEstrutura;
  aguardandoLider: number;
  comLogisticaAFechar: number;
  emCampo: number;
  catalogo: Item[];
  nomeDoAdministrativo: string;

  // ── O QUE O FORMULÁRIO EM POPUP PRECISA ──
  //
  // Abrir e editar solicitação deixou de ser página e virou popup sobre
  // esta lista. Como o formulário não consulta banco (é ele que recebe
  // tudo pronto), os cadastros que alimentam as listas e a sugestão de
  // previsto passam a chegar por aqui.
  projetos: Projeto[];
  hoteis: Hotel[];
  /** Para o popup de informações resolver o nome de quem aprovou. */
  perfis: Perfil[];
  diariasCadastradas: DiariaValor[];
  usuarioId: string;
  solicitanteNome: string;
  ehDirecao: boolean;
  /**
   * Esta pessoa pode ver dinheiro? Líder de algum projeto, administrativo,
   * financeiro ou Direção. Quando `false`, as colunas de Previsto, Real e
   * Curso saem da tabela, do filtro e do CSV — e o pedido continua todo
   * visível: quem abre campo precisa ver o campo, não o orçamento.
   */
  verValores: boolean;
}

export function ListaDeSolicitacoes({
  solicitacoes,
  estrutura,
  aguardandoLider,
  comLogisticaAFechar,
  emCampo,
  catalogo,
  nomeDoAdministrativo,
  verValores,
  projetos,
  hoteis,
  perfis,
  diariasCadastradas,
  usuarioId,
  solicitanteNome,
  ehDirecao,
}: Props) {
  const roteador = useRouter();

  /**
   * O formulário aberto em popup. `null` = fechado.
   *
   * Guarda o ESTADO INICIAL já montado, e não só o id: montar o inicial na
   * hora de abrir (e não a cada render do popup) é o que impede o
   * formulário de se reiniciar sozinho quando a lista atrás dele recarrega
   * — apagando o que a pessoa está digitando.
   */
  const [formulario, setFormulario] = useState<{
    id: string | null;
    codigo: string | null;
    inicial: EstadoDoFormulario;
    equipamentosEntregues: number;
  } | null>(null);

  function abrirNova() {
    setFormulario({ id: null, codigo: null, inicial: formularioVazio(), equipamentosEntregues: 0 });
  }

  function abrirEdicao(s: SolicitacaoDeLista) {
    setFormulario({
      id: s.id,
      codigo: s.codigo,
      inicial: formularioDeSolicitacao(s),
      // Equipamento já entregue está fisicamente com a equipe: a linha é a
      // obrigação de devolver, e a edição não a toca. A tela diz quantos
      // ficaram de fora, em vez de deixar parecer que sumiram.
      equipamentosEntregues: s.equipamentos.filter((e) => e.entregue).length,
    });
  }

  const [filtros, setFiltros] = useState<FiltrosDeSolicitacao>(FILTROS_VAZIOS);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(20);

  const filtradas = useMemo(() => filtrarSolicitacoes(solicitacoes, filtros), [solicitacoes, filtros]);

  // A página pedida pode não existir mais depois de um filtro que encurtou
  // a lista. Corrigir na leitura (e não num efeito que chama setState)
  // evita uma renderização a mais e o pisca-pisca que vem com ela.
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / porPagina));
  const paginaAtual = Math.min(Math.max(1, pagina), totalPaginas);
  const inicio = (paginaAtual - 1) * porPagina;
  const daPagina = filtradas.slice(inicio, inicio + porPagina);

  function trocarFiltro(mudanca: Partial<FiltrosDeSolicitacao>) {
    setFiltros((atual) => ({ ...atual, ...mudanca }));
    setPagina(1);
  }

  const hoje = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <section className="secao active">
      <CabecalhoDeSecao titulo="Solicitações" direita={hoje} />

      <div className="lista-wrapper">
        <div className="table-controls">
          <div className="filter-row">
            <select
              className="form-control filter-select"
              value={filtros.tipo}
              onChange={(e) => trocarFiltro({ tipo: e.target.value })}
              aria-label="Filtrar por tipo"
            >
              <option value="">Todos os tipos</option>
              {TIPOS_SOLICITACAO.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>

            <select
              className="form-control filter-select"
              value={filtros.status}
              onChange={(e) => trocarFiltro({ status: e.target.value })}
              aria-label="Filtrar por status"
            >
              <option value="">Todos os status</option>
              {STATUS_SOLICITACAO.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>

            {/* O filtro de curso é um filtro DE DINHEIRO: ele separa os
                campos por quanto o real destoou do previsto. Sem as
                colunas na tabela, ele filtraria por um critério invisível. */}
            {verValores ? (
              <select
                className="form-control filter-select"
                value={filtros.curso}
                onChange={(e) => trocarFiltro({ curso: e.target.value })}
                title="Status de curso: como o gasto real está em relação ao previsto"
                aria-label="Filtrar por status de curso"
              >
                <option value="">Todo o curso</option>
                {STATUS_CURSO.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            ) : null}

            <input
              className="form-control search-input"
              placeholder="Buscar por código, cliente, destino, solicitante ou pessoa da equipe"
              value={filtros.busca}
              onChange={(e) => trocarFiltro({ busca: e.target.value })}
              aria-label="Buscar"
            />

            <div className="filter-row-actions">
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => {
                  setFiltros(FILTROS_VAZIOS);
                  setPagina(1);
                }}
              >
                Limpar
              </button>
              <BotaoExportarCsv
                arquivo="solicitacoes-campo"
                cabecalho={cabecalhoCsv(verValores)}
                linhas={() => filtradas.map((s) => linhaCsv(s, verValores))}
              />
              {/* Botão, e não link: o formulário abre SOBRE esta lista, sem
                  sair dela. Quem cancela volta para a lista com os filtros
                  e a página onde estava — antes, voltar significava
                  recarregar a lista do zero. */}
              <button className="btn btn-primary btn-sm" type="button" onClick={abrirNova}>
                + Nova Solicitação
              </button>
            </div>
          </div>

          <div className="filter-resumo">{resumo(estrutura, filtradas.length, aguardandoLider, comLogisticaAFechar, emCampo)}</div>
        </div>

        <div className="table-wrapper">
          <div className="table-scroll">
            <table className="art-table tabela-centralizada">
              {/* ── NOVE COLUNAS, E O RESTO NO OLHO ──
                  Saíram Tipo, Período, Curso e SST. Não por caberem mal: por
                  não serem o que se pergunta a uma LISTA. Aqui a pergunta é
                  "qual pedido é este e como ele está", e para isso bastam
                  código, quem pediu, de que projeto, de que escopo, para
                  onde, com quantos, quanto e em que estado.
                  Tipo, período, curso, SST e todo o resto — equipe nominal,
                  veículo, hospedagem, equipamento, assinaturas, histórico —
                  estão INTEIROS no popup do olho, que é onde se vai quando a
                  pergunta passa a ser sobre um pedido só.

                  Previsto e Real numa coluna só, LADO A LADO: eles se leem
                  sempre juntos ("quanto era × quanto foi"), e em duas colunas
                  gastavam duas larguras de dinheiro para dizer uma
                  comparação. */}
              <thead>
                <tr>
                  <th className="cel-texto">Código</th>
                  <th className="cel-texto">Solicitante</th>
                  <th className="cel-texto">Cliente | Projeto</th>
                  {/* O PROGRAMA do campo — é por ele que se separa o campo de
                      fauna do de ruído dentro do mesmo contrato. */}
                  <th className="cel-texto">Escopo</th>
                  <th className="cel-texto">Destino</th>
                  <th className="cel-texto">Equipe</th>
                  {verValores ? <th className="cel-num">Previsto × Real</th> : null}
                  <th>Status</th>
                  <th className="col-acoes">Ações</th>
                </tr>
              </thead>
              <tbody>
                {daPagina.map((s) => (
                  <tr key={s.id}>
                    <td className="cel-texto cel-inteiro">{s.codigo}</td>
                    <td className="cel-texto">{s.solicitante_nome || "—"}</td>
                    <td className="cel-texto">{s.cliente_projeto || "—"}</td>
                    <td className="cel-texto">{s.escopo || "—"}</td>
                    <td className="cel-texto">{s.destino || "—"}</td>
                    <td className="cel-texto">{equipeResumo(s)}</td>
                    {verValores ? <td className="cel-num">{previstoContraReal(s)}</td> : null}
                    <td>
                      <Selo texto={s.status} classe={classeDoStatus(s.status)} />
                    </td>
                    <td className="table-actions">
                      {/* As informações abrem em POPUP sobre a lista, como no
                          "Informações do Equipamento" do Controle de Estoque:
                          sair da tela custaria o filtro, a busca e a página
                          em que a pessoa está. */}
                      <DetalheEmPopup
                        solicitacao={s}
                        projetos={projetos}
                        catalogo={catalogo}
                        hoteis={hoteis}
                        perfis={perfis}
                        verValores={verValores}
                      />
                      {/* Editar abre o popup daqui mesmo. Pedido
                          Finalizado, Cancelado ou Recusado não tem lápis:
                          é registro, e reescrever registro apaga a
                          história em vez de corrigi-la. A rota PATCH
                          recusa igual — esta é só a porta certa. */}
                      {podeEditar(s.status) && s.status !== "Recusada" ? (
                        <button
                          className="btn-icon"
                          type="button"
                          title="Editar solicitação"
                          onClick={() => abrirEdicao(s)}
                        >
                          <Icone nome="editar" />
                        </button>
                      ) : null}
                      {s.equipamentos.length ? (
                        <ChecklistEmPopup solicitacao={s} catalogo={catalogo} />
                      ) : null}
                      {/* A CHAVE INGLESA — pedir material, diária ou despesa
                          que o campo precisou e o pedido não previu. Está
                          aqui além da Conferência porque quem PEDE trabalha
                          nesta lista: o solicitante não abre a fila do
                          balcão. Ela mesma se esconde em pedido fechado. */}
                      <AjusteEmCampo
                        solicitacao={s}
                        catalogo={catalogo}
                        hoteis={hoteis}
                        diarias={diariasCadastradas}
                      />
                      {/* O atalho de conferência direto da lista, como no
                          `abrirConferenciaAuto` da versão anterior: o modo
                          (entrega ou devolução) é decidido pelo estado do
                          pedido, não escolhido. Só aparece onde faz sentido
                          — com equipamento e no intervalo em que o banco
                          aceita a conferência. */}
                      {aceitaConferencia(s) ? (
                        <RegistrarConferencia
                          solicitacao={s}
                          catalogo={catalogo}
                          nomeDoAdministrativo={nomeDoAdministrativo}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <TabelaVazia visivel={filtradas.length === 0}>
              <div className="empty-icon">
                <Icone nome="solicitacoes" tamanho={40} />
              </div>
              <strong>
                {estrutura.base
                  ? "Nenhuma solicitação registrada"
                  : "O banco ainda não tem as tabelas de solicitação (supabase/01_solicitacoes.sql)"}
              </strong>
            </TabelaVazia>
          </div>

          <Paginacao
            total={filtradas.length}
            pagina={paginaAtual}
            porPagina={porPagina}
            aoTrocarPagina={setPagina}
            aoTrocarPorPagina={(n) => {
              setPorPagina(n);
              setPagina(1);
            }}
          />
        </div>
      </div>

      {/* ══ O FORMULÁRIO, EM POPUP ══
          Sem `rodape`: o formulário já traz o par Cancelar / Enviar no fim
          do corpo, e um segundo rodapé no Modal daria dois pares de botões
          dizendo a mesma coisa.

          `key` no formulário: sem ela, abrir um pedido depois do outro
          reaproveitaria o mesmo componente e o estado do anterior
          continuaria preenchido. Com ela, cada abertura é um formulário
          novo. */}
      <Modal
        titulo={formulario?.id ? `Editar ${formulario.codigo ?? "solicitação"}` : "Nova solicitação"}
        aberto={formulario !== null}
        aoFechar={() => setFormulario(null)}
      >
        {formulario ? (
          <FormularioDeSolicitacao
            key={formulario.id ?? "nova"}
            emPopup
            solicitacaoId={formulario.id}
            codigo={formulario.codigo}
            inicial={formulario.inicial}
            equipamentosEntregues={formulario.equipamentosEntregues}
            projetos={projetos}
            hoteis={hoteis}
            catalogo={catalogo}
            diariasCadastradas={diariasCadastradas}
            usuarioId={usuarioId}
            solicitanteNome={solicitanteNome}
            ehDirecao={ehDirecao}
            aoFechar={() => setFormulario(null)}
            aoSalvar={() => {
              setFormulario(null);
              // A lista atrás precisa refletir o pedido novo/alterado. O
              // formulário já chamou `refresh()`; este é o que garante que
              // o popup só some depois de a lista ter sido pedida de novo.
              roteador.refresh();
            }}
          />
        ) : null}
      </Modal>
    </section>
  );
}

function resumo(
  estrutura: EstadoEstrutura,
  total: number,
  aguardandoLider: number,
  comLogisticaAFechar: number,
  emCampo: number
): string {
  if (!estrutura.base) {
    return "Estrutura do banco pendente — a tela funciona, mas ainda não há onde gravar.";
  }
  const plural = `${total} solicitaç${total === 1 ? "ão" : "ões"}`;
  if (!estrutura.v2) {
    return `${plural} · rode supabase/02_campo_v2.sql para ligar reserva de material, calendário e previsto × real.`;
  }
  return `${plural} · ${aguardandoLider} aguardando líder · ${comLogisticaAFechar} com logística a fechar · ${emCampo} em campo`;
}

// ─── Exportação ──────────────────────────────────────────────────────────
//
// As mesmas colunas da versão anterior, na mesma ordem: quem já monta
// planilha em cima deste CSV não pode ter as colunas trocadas embaixo.
//
// ── AS COLUNAS DE DINHEIRO SAEM PARA QUEM NÃO PODE VER VALOR ──
//
// Elas SAEM, não vêm em branco. Coluna vazia num CSV é indistinguível de
// "não informado", e quem abrisse a planilha concluiria que o campo não
// tem previsto — que é uma informação errada, e não uma ausente.

const COLUNAS_BASE = [
  "Código", "Tipo", "Status", "Solicitante", "Setor", "Cliente | Projeto", "Escopo", "Código Clockify",
  "Destino", "Período", "Dias", "Equipe", "Líder", "Recurso até",
  "Veículo", "Modalidade", "Locadora", "Contrato", "Placa",
  "Hospedagem", "Equipamentos", "Reservados",
] as const;

const COLUNAS_DE_VALOR = [
  "Previsto veículo", "Previsto hospedagem", "Previsto alimentação", "Previsto outros", "Previsto total",
  "Real veículo", "Real hospedagem", "Real alimentação", "Real outros", "Real avaria", "Real total",
  "Desvio", "Desvio %", "Status de curso",
] as const;

/** SST e a CONTAGEM de avarias não são valor — quantas avarias o campo teve
 *  é informação de operação, e quem está em campo precisa dela. O CUSTO
 *  delas é que é dinheiro, e esse fica com as colunas de valor. */
const COLUNAS_FINAIS = ["SST", "Avarias"] as const;
const COLUNAS_FINAIS_DE_VALOR = ["Custo de avaria", "Solicitado no financeiro"] as const;

function cabecalhoCsv(verValores: boolean): readonly string[] {
  return verValores
    ? [...COLUNAS_BASE, ...COLUNAS_DE_VALOR, ...COLUNAS_FINAIS, ...COLUNAS_FINAIS_DE_VALOR]
    : [...COLUNAS_BASE, ...COLUNAS_FINAIS];
}

function linhaCsv(s: SolicitacaoDeLista, verValores: boolean): unknown[] {
  const lider = s.equipe.find((e) => e.lider);
  const locadora = s.transporte_locadora === "Outros" ? s.transporte_locadora_outra : s.transporte_locadora;
  const dias = s.periodo_inicio && s.periodo_fim ? diasDeCampo(s.periodo_inicio, s.periodo_fim) : "";

  const base = [
    s.codigo, s.tipo, s.status, s.solicitante_nome, s.setor, s.cliente_projeto, s.escopo ?? "", s.codigo_clockify,
    s.destino, periodoTexto(s), dias,
    s.equipe.map((e) => e.colaborador).join(" / "),
    lider ? lider.colaborador : "",
    dataISOparaBR(s.data_recurso),
    s.veiculo_necessario ? "Sim" : "Não",
    s.transporte_modalidade, locadora, s.transporte_contrato, s.transporte_placa,
    s.hospedagens.length ? s.hospedagens.map((h) => `${h.cidade} (${h.dias ?? 0}d)`).join(" / ") : "Não",
    s.equipamentos.length,
    s.reservas.filter((r) => r.situacao !== "Cancelada").length,
  ];

  const valores = [
    csvNumero(s.previsto_veiculo), csvNumero(s.previsto_hospedagem),
    csvNumero(s.previsto_alimentacao), csvNumero(s.previsto_outros), csvNumero(s.previsto_total),
    csvNumero(s.real_veiculo), csvNumero(s.real_hospedagem),
    csvNumero(s.real_alimentacao), csvNumero(s.real_outros), csvNumero(s.real_avaria),
    csvNumero(s.real_total),
    csvNumero(s.desvio_valor),
    s.desvio_percentual == null ? "" : csvNumero(s.desvio_percentual),
    s.status_curso,
  ];

  const sstTexto = s.sst_aplicavel ? "Se aplica" : "Não se aplica";

  return verValores
    ? [
        ...base,
        ...valores,
        sstTexto,
        s.avarias.length,
        // A soma é a MESMA regra do banco (custo_real, ou custo_estimado
        // enquanto a avaria não fechou), e é o valor que já está dentro do
        // real_total pela coluna real_avaria.
        csvNumero(s.avarias.reduce((t, a) => t + (Number(a.custo_real ?? a.custo_estimado) || 0), 0)),
        s.tipo === "Financeiro" ? csvNumero(totalDaSolicitacao(s)) : "",
      ]
    : [...base, sstTexto, s.avarias.length];
}
