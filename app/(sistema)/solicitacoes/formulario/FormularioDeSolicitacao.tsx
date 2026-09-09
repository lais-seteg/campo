"use client";

// ═══════════════════════════════════════════════════════════════════════
//  O FORMULÁRIO DE SOLICITAÇÃO
//
//  Os dois blocos do formulário em papel num só lugar: o ADMINISTRATIVO
//  (veículo, hospedagem, equipamento) e o FINANCEIRO (transporte,
//  combustível, outros, diárias). O tipo escolhido no topo mostra um e
//  esconde o outro — como na planilha, que tem uma aba para cada.
//
//  ── UMA COISA SAIU, E É DE PROPÓSITO ──
//
//  A versão anterior exigia "salvar" cada linha de hospedagem no ✓ antes
//  de enviar. Aquilo não era regra de negócio: era o jeito de o código que
//  lia o DOM saber quando recalcular os dias. Aqui as diárias são
//  derivadas de entrada e saída a cada tecla, então o passo extra deixou
//  de ter razão de existir — e com ele sai o erro "Salvar cada cidade da
//  hospedagem (✓)", que era o mais fácil de encontrar sem entender.
//
//  A validação de verdade continua no servidor
//  (app/api/solicitacoes/validacao.ts). O que esta tela faz é adiantar o
//  que ela já sabe, para ninguém descobrir no Enviar o que a tela via.
// ═══════════════════════════════════════════════════════════════════════

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAvisos } from "@/app/components/Avisos";
import { Icone } from "@/app/components/Icone";
import { CampoMascarado, Caixa, Grupo, GrupoDeRadio, Secao } from "@/app/components/Campos";
import { Selo } from "@/app/components/Tabela";
import { get, mensagemDoErro, patch, post } from "@/app/components/api";
import {
  GRUPOS_DESPESA,
  LOCADORAS,
  TIPOS_SOLICITACAO,
  VINCULOS,
  type DiariaValor,
  type GrupoDespesa,
  type Hotel,
  type Item,
  type ItemDisponivel,
  type Locadora,
  type Projeto,
  type TipoSolicitacao,
  type Vinculo,
} from "@/lib/tipos";
import { EPIS_PADRAO, TECNICOS, classeDoCurso, calcularStatusCurso, diariasDoVinculo, diariaPorTipo } from "@/lib/listas";
import { dataBRparaISO, diasDeCampo, formatarMoeda, formatarNumeroBR, parseMoeda } from "@/lib/formato";
import { aceitaSolicitacaoNova } from "@/lib/papeis";
import type { ListaClockify } from "@/lib/clockify";
import {
  formularioVazio,
  linhaDeDespesaVazia,
  linhaDeDiariaVazia,
  linhaDeEpiVazia,
  linhaDeEquipamentoVazia,
  linhaDeEquipeVazia,
  linhaDeHospedagemVazia,
  montarCorpo,
  noitesDaLinha,
  sugerirPrevisto,
  type EstadoDoFormulario,
} from "@/app/(sistema)/solicitacoes/formulario/estado";

const SETORES = ["Regulatório", "Administrativo", "Financeiro", "PMO", "Projetos", "Inovação"] as const;
const MODALIDADES = ["Locação", "Frota própria", "Aéreo", "Rodoviário", "Aplicativo", "Outros"] as const;

interface Props {
  /** `null` = solicitação nova. */
  solicitacaoId: string | null;
  codigo: string | null;
  inicial: EstadoDoFormulario;
  projetos: Projeto[];
  hoteis: Hotel[];
  catalogo: Item[];
  diariasCadastradas: DiariaValor[];
  usuarioId: string;
  solicitanteNome: string;
  ehDirecao: boolean;
  /** Quantos equipamentos já saíram e por isso não estão editáveis. */
  equipamentosEntregues: number;

  // ── MODO POPUP ──
  //
  // O mesmo formulário serve de PÁGINA (/solicitacoes/nova) e de POPUP
  // sobre a lista. A diferença é só a casca: numa, ele traz o próprio
  // cabeçalho e a própria rolagem; na outra, quem dá isso é o Modal.
  //
  // Um componente só para os dois, e não uma cópia: são mil e trezentas
  // linhas de regra de preenchimento (previsto, disponibilidade de
  // material, diária, SST). Duas cópias divergiriam na primeira correção.

  /** Sem cabeçalho e sem rolagem própria — o Modal cuida das duas. */
  emPopup?: boolean;
  /** O que "Cancelar" e "Voltar" fazem. Sem isto, volta na navegação. */
  aoFechar?: () => void;
  /** Chamado depois de gravar. Sem isto, navega para o pedido salvo. */
  aoSalvar?: () => void;
}

export function FormularioDeSolicitacao({
  solicitacaoId,
  codigo,
  inicial,
  projetos,
  hoteis,
  catalogo,
  diariasCadastradas,
  usuarioId,
  solicitanteNome,
  ehDirecao,
  equipamentosEntregues,
  emPopup = false,
  aoFechar,
  aoSalvar,
}: Props) {
  const roteador = useRouter();
  const { avisar } = useAvisos();

  /** Fechar é voltar na navegação quando o formulário é PÁGINA, e é o que
   *  o popup mandar quando ele é POPUP. */
  const fechar = aoFechar ?? (() => roteador.back());

  const [f, setF] = useState<EstadoDoFormulario>(inicial);
  const [enviando, setEnviando] = useState(false);
  const [disponibilidade, setDisponibilidade] = useState<ItemDisponivel[] | null>(null);
  const [clockify, setClockify] = useState<ListaClockify | null>(null);

  const editando = solicitacaoId !== null;
  const administrativo = f.tipo === "Administrativo";

  /** Atualiza um punhado de campos de uma vez, preservando o resto. */
  const mudar = useCallback((mudanca: Partial<EstadoDoFormulario>) => {
    setF((atual) => ({ ...atual, ...mudanca }));
  }, []);

  const inicioIso = dataBRparaISO(f.periodoInicio);
  const fimIso = dataBRparaISO(f.periodoFim);
  const dias = diasDeCampo(inicioIso, fimIso);

  // ── Disponibilidade do material NAS DATAS do campo ──
  //
  // Não é o saldo do estoque: é o saldo menos o que já está comprometido
  // com outros campos no mesmo período. Recarrega quando o período muda —
  // mudar a data muda quem disputa o quê.
  useEffect(() => {
    if (!inicioIso || !fimIso || fimIso < inicioIso) {
      setDisponibilidade(null);
      return;
    }
    let cancelado = false;
    const busca = new URLSearchParams({ inicio: inicioIso, fim: fimIso });
    if (solicitacaoId) busca.set("ignorar", solicitacaoId);

    get<{ itens: ItemDisponivel[] }>(`/api/itens/disponiveis?${busca}`)
      .then((r) => {
        // A resposta pode chegar depois de o período ter mudado de novo:
        // sem esta guarda, a lista antiga sobrescreveria a nova.
        if (!cancelado) setDisponibilidade(r.itens);
      })
      .catch(() => {
        if (!cancelado) setDisponibilidade(null);
      });

    return () => {
      cancelado = true;
    };
  }, [inicioIso, fimIso, solicitacaoId]);

  // A lista do Clockify é uma sugestão: se falhar, o campo continua
  // aceitando o código digitado e a tela diz o motivo embaixo.
  useEffect(() => {
    let cancelado = false;
    get<ListaClockify>("/api/clockify/projetos")
      .then((r) => {
        if (!cancelado) setClockify(r);
      })
      .catch(() => {
        if (!cancelado) setClockify({ projetos: [], erro: "Não foi possível consultar o Clockify." });
      });
    return () => {
      cancelado = true;
    };
  }, []);

  const projetoEscolhido = projetos.find((p) => p.id === f.projetoId);
  const sugestao = useMemo(
    () => sugerirPrevisto(f, projetos, diariasCadastradas),
    [f, projetos, diariasCadastradas]
  );

  const disponibilidadePorItem = useMemo(() => {
    const mapa = new Map<string, ItemDisponivel>();
    for (const d of disponibilidade ?? []) mapa.set(d.item_id, d);
    return mapa;
  }, [disponibilidade]);

  // ── Previsto × real ──
  const previsto = {
    veiculo: parseMoeda(f.previstoVeiculo),
    hospedagem: parseMoeda(f.previstoHospedagem),
    alimentacao: parseMoeda(f.previstoAlimentacao),
    outros: parseMoeda(f.previstoOutros),
  };
  const real = {
    veiculo: parseMoeda(f.realVeiculo),
    hospedagem: parseMoeda(f.realHospedagem),
    alimentacao: parseMoeda(f.realAlimentacao),
    outros: parseMoeda(f.realOutros),
  };
  const previstoTotal = previsto.veiculo + previsto.hospedagem + previsto.alimentacao + previsto.outros;
  // A AVARIA entra no real, como entra no banco. Ela não é digitada aqui —
  // vem de `solicitacao_avarias`, somada por trigger — mas deixá-la fora da
  // prévia faria esta tela mostrar um total menor e um desvio que não é o
  // desvio que vai ficar gravado.
  const realTotal =
    real.veiculo + real.hospedagem + real.alimentacao + real.outros + f.realAvaria;
  // Prévia com a MESMA faixa de tolerância do trigger no banco — quem
  // calcula de verdade é ele; isto existe para a prévia não mentir.
  const curso = calcularStatusCurso(previstoTotal, realTotal);

  const totalDespesas = f.despesas.reduce((t, d) => t + parseMoeda(d.valor), 0);
  const totalDiarias = f.diarias.reduce((t, d) => t + (Number(d.dias) || 0) * parseMoeda(d.valor), 0);

  function aplicarProjeto(projetoId: string) {
    const projeto = projetos.find((p) => p.id === projetoId);
    if (!projeto) {
      mudar({ projetoId });
      return;
    }
    // Escolher o projeto preenche o que já se sabe dele. O código do
    // Clockify só é sobrescrito quando o projeto tem um — apagar o que a
    // pessoa digitou porque o cadastro está incompleto seria pior.
    mudar({
      projetoId,
      clienteProjeto: `${projeto.cliente} | ${projeto.nome}`.toUpperCase(),
      ...(projeto.codigo_clockify ? { codigoClockify: projeto.codigo_clockify } : {}),
    });
  }

  function aplicarSugestao() {
    if (!sugestao) {
      avisar("Informe o período do campo antes de aplicar a sugestão.", "erro");
      return;
    }
    // Sugestão de zero NÃO apaga o que a pessoa digitou. Desde a v3 o
    // veículo não tem mais de onde ser sugerido (o gasto previsto do
    // projeto passou a ser valor total de contrato, não diária), e
    // sobrescrever com zero jogaria fora o único valor que só quem está
    // pedindo conhece.
    mudar({
      ...(sugestao.veiculo > 0 ? { previstoVeiculo: formatarNumeroBR(sugestao.veiculo) } : {}),
      ...(sugestao.hospedagem > 0 ? { previstoHospedagem: formatarNumeroBR(sugestao.hospedagem) } : {}),
      ...(sugestao.alimentacao > 0 ? { previstoAlimentacao: formatarNumeroBR(sugestao.alimentacao) } : {}),
    });
    avisar(`Previsto aplicado: ${sugestao.dias} dia(s), ${sugestao.equipe} pessoa(s).`, "ok");
  }

  async function enviar() {
    setEnviando(true);
    try {
      const corpo = montarCorpo(f);

      if (editando) {
        const r = await patch<{ reservados?: number; entreguesForaDaEdicao?: number }>(
          `/api/solicitacoes/${solicitacaoId}`,
          corpo
        );
        const reserva = r.reservados ? ` · ${r.reservados} item(ns) reservado(s) no período` : "";
        const foraDaEdicao = r.entreguesForaDaEdicao
          ? ` ${r.entreguesForaDaEdicao} equipamento(s) já entregue(s) não foram alterados.`
          : "";
        avisar(`Alterações salvas${reserva}.${foraDaEdicao}`, "ok");
        if (!aoSalvar) roteador.push(`/solicitacoes/${solicitacaoId}`);
      } else {
        const r = await post<{ id: string; codigo: string | null; status: string | null; reservados?: number }>(
          "/api/solicitacoes",
          corpo
        );
        const reserva = r.reservados ? ` · ${r.reservados} item(ns) reservado(s) no período` : "";
        // O status REAL vem do banco: quem pede sendo o líder do projeto
        // não espera por si mesmo, e o pedido nasce aprovado.
        avisar(
          r.status === "Aprovada"
            ? `${r.codigo ?? "Solicitação"} registrada e já aprovada (você lidera este projeto)${reserva}.`
            : `${r.codigo ?? "Solicitação"} registrada · aguardando aprovação de ${projetoEscolhido?.lider ?? "o líder do projeto"}${reserva}.`,
          "ok"
        );
        if (!aoSalvar) roteador.push(`/solicitacoes/${r.id}`);
      }
      // Como PÁGINA, o formulário navega para o pedido salvo. Como POPUP,
      // quem manda é o `aoSalvar`: ele fecha o popup e deixa a lista
      // atrás, que é de onde a pessoa veio.
      roteador.refresh();
      aoSalvar?.();
    } catch (erro) {
      avisar(mensagemDoErro(erro, editando ? "salvar as alterações" : "registrar a solicitação"), "erro");
      setEnviando(false);
    }
  }

  return (
    <Casca
      emPopup={emPopup}
      titulo={editando ? `Editar ${codigo ?? "solicitação"}` : "Nova solicitação"}
      aoFechar={fechar}
    >
        <Secao titulo="Tipo de recurso">
          <GrupoDeRadio<TipoSolicitacao>
            nome="tipo"
            valor={f.tipo}
            opcoes={TIPOS_SOLICITACAO.map((t) => ({ valor: t, rotulo: t }))}
            aoMudar={(tipo) => mudar({ tipo })}
          />
        </Secao>

        {/* ══ IDENTIFICAÇÃO ══ */}
        <Secao titulo="Identificação" icone={<Icone nome="solicitacoes" tamanho={18} />}>
          <div className="form-grid">
            {/* Somente leitura: o solicitante é carimbado por TRIGGER a
                partir de auth.uid(), e é isso que impede alguém abrir
                pedido em nome de outra pessoa. O campo existe para quem
                está preenchendo conferir de quem vai ser o pedido. */}
            <Grupo rotulo="Solicitante">
              {(id) => <input id={id} className="form-control" value={solicitanteNome} readOnly />}
            </Grupo>

            <Grupo rotulo="Setor" obrigatorio>
              {(id) => (
                <select id={id} className="form-control" value={f.setor} onChange={(e) => mudar({ setor: e.target.value })}>
                  <option value="">Selecione</option>
                  {SETORES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              )}
            </Grupo>

            <Grupo rotulo="Data para receber o recurso" obrigatorio>
              {(id) => (
                <CampoMascarado
                  id={id}
                  mascara="data"
                  valor={f.dataRecurso}
                  aoMudar={(v) => mudar({ dataRecurso: v })}
                />
              )}
            </Grupo>

            {/* O PROJETO É O QUE DIZ QUEM APROVA. Sem ele não há líder, e
                sem líder não há aprovação — o banco recusa o pedido. */}
            <Grupo rotulo="Projeto" obrigatorio largo dica={<DicaDoProjeto projeto={projetoEscolhido} temProjetos={projetos.length > 0} usuarioId={usuarioId} ehDirecao={ehDirecao} />}>
              {(id) => (
                <select
                  id={id}
                  className="form-control"
                  value={f.projetoId}
                  onChange={(e) => aplicarProjeto(e.target.value)}
                >
                  <option value="">Selecione o projeto</option>
                  {/* SÓ PROJETO ATIVO aceita campo novo — o banco recusa o
                      insert em Stand By, Cancelado e Finalizado. O projeto
                      já escolhido continua na lista mesmo fora de Ativo:
                      é a EDIÇÃO de um pedido que nasceu antes da pausa, e
                      tirá-lo daqui esvaziaria o campo ao salvar. */}
                  {projetos
                    .filter((p) => aceitaSolicitacaoNova(p) || p.id === f.projetoId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.cliente} | {p.nome}
                        {aceitaSolicitacaoNova(p) ? "" : ` (${p.situacao.toLowerCase()})`}
                      </option>
                    ))}
                </select>
              )}
            </Grupo>

            <Grupo rotulo="Cliente | Projeto" obrigatorio>
              {(id) => (
                <input
                  id={id}
                  className="form-control"
                  placeholder="Ex.: ENEL | SE Aquiraz"
                  value={f.clienteProjeto}
                  onChange={(e) => mudar({ clienteProjeto: e.target.value })}
                />
              )}
            </Grupo>

            <Grupo
              rotulo="Código Clockify"
              obrigatorio
              dica={<DicaDoClockify lista={clockify} />}
            >
              {(id) => (
                <>
                  <input
                    id={id}
                    className="form-control"
                    list="lista-clockify"
                    placeholder="Ex.: 0189-3-2025"
                    value={f.codigoClockify}
                    onChange={(e) => mudar({ codigoClockify: e.target.value })}
                  />
                  {/* No datalist, o VALOR é o que entra no campo (o código)
                      e o texto é a dica (o nome do empreendimento). */}
                  <datalist id="lista-clockify">
                    {(clockify?.projetos ?? []).map((p) => (
                      <option key={p.id} value={p.codigo}>
                        {p.cliente && p.cliente !== p.nome ? `${p.nome} · ${p.cliente}` : p.nome}
                      </option>
                    ))}
                  </datalist>
                </>
              )}
            </Grupo>

            <Grupo rotulo="Destino" obrigatorio>
              {(id) => (
                <input
                  id={id}
                  className="form-control"
                  placeholder="Cidade / subestação"
                  value={f.destino}
                  onChange={(e) => mudar({ destino: e.target.value })}
                />
              )}
            </Grupo>

            <Grupo rotulo="Período — início" obrigatorio>
              {(id) => (
                <CampoMascarado
                  id={id}
                  mascara="data"
                  valor={f.periodoInicio}
                  aoMudar={(v) => mudar({ periodoInicio: v })}
                />
              )}
            </Grupo>

            <Grupo rotulo="Período — fim" obrigatorio>
              {(id) => (
                <CampoMascarado
                  id={id}
                  mascara="data"
                  valor={f.periodoFim}
                  aoMudar={(v) => mudar({ periodoFim: v })}
                />
              )}
            </Grupo>

            <Grupo rotulo="Dias de campo">
              {(id) => <input id={id} className="form-control" value={dias ? `${dias} dia(s)` : "—"} readOnly />}
            </Grupo>
          </div>
        </Secao>

        {/* ══ EQUIPE ══ */}
        <Secao titulo="Equipe de campo" icone={<Icone nome="equipe" tamanho={18} />}>
          <div className="sol-itens">
            {f.equipe.map((linha, indice) => (
              <div className="sol-equipe" key={linha.chave}>
                <input
                  className="form-control"
                  placeholder="Nome e sobrenome"
                  list="lista-nomes-tecnicos"
                  value={linha.colaborador}
                  onChange={(e) => trocarEquipe(setF, indice, { colaborador: e.target.value })}
                />
                <input
                  className="form-control"
                  placeholder="Função em campo"
                  value={linha.funcao}
                  onChange={(e) => trocarEquipe(setF, indice, { funcao: e.target.value })}
                />
                <select
                  className="form-control"
                  value={linha.vinculo}
                  onChange={(e) => trocarEquipe(setF, indice, { vinculo: e.target.value as Vinculo })}
                  aria-label="Vínculo"
                >
                  {VINCULOS.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
                {/* Não há campo de Clockify por pessoa. O código que importa é
                    o do PROJETO, no cabeçalho da solicitação, e ele vem da API
                    do Clockify — pedi-lo de novo em cada linha da equipe era
                    coletar o mesmo dado N vezes, que é onde ele sai diferente. */}
                <input
                  className="form-control"
                  placeholder="Telefone"
                  value={linha.telefone}
                  onChange={(e) => trocarEquipe(setF, indice, { telefone: e.target.value })}
                />
                <label className="conf-check" title="O líder informa o previsto e assina como prestador">
                  <input
                    type="radio"
                    name="equipe-lider"
                    className="eq-lider"
                    checked={linha.lider}
                    onChange={() =>
                      // Um líder por solicitação — o banco garante isso com
                      // um índice único parcial. Marcar um desmarca o outro.
                      setF((atual) => ({
                        ...atual,
                        equipe: atual.equipe.map((l, i) => ({ ...l, lider: i === indice })),
                      }))
                    }
                  />{" "}
                  Líder
                </label>
                <button
                  className="btn-icon btn-icon-danger"
                  type="button"
                  title="Remover"
                  onClick={() => setF((a) => ({ ...a, equipe: a.equipe.filter((_, i) => i !== indice) }))}
                >
                  <Icone nome="lixeira" />
                </button>
              </div>
            ))}
          </div>
          <datalist id="lista-nomes-tecnicos">
            {TECNICOS.map((t) => (
              <option key={t.codigo} value={t.nome}>
                {t.codigo}
              </option>
            ))}
          </datalist>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            style={{ marginTop: ".5rem" }}
            onClick={() => setF((a) => ({ ...a, equipe: [...a.equipe, linhaDeEquipeVazia()] }))}
          >
            + Adicionar pessoa
          </button>
          <p className="modal-hint">
            Marque quem é o <strong>líder</strong>: é quem informa o previsto e assina como prestador na
            conferência.
          </p>
        </Secao>

        {administrativo ? (
          <>
            {/* ══ 1 · VEÍCULO ══ */}
            <Secao titulo="1 · Veículo" icone={<Icone nome="caminhao" tamanho={18} />}>
              <GrupoDeRadio
                nome="veiculo"
                valor={f.veiculoNecessario ? "sim" : "nao"}
                opcoes={[
                  { valor: "sim", rotulo: "Precisa de veículo" },
                  { valor: "nao", rotulo: "Não precisa" },
                ]}
                aoMudar={(v) => mudar({ veiculoNecessario: v === "sim" })}
              />
              {f.veiculoNecessario ? (
                <div className="form-grid" style={{ marginTop: ".6rem" }}>
                  <Grupo rotulo="Modalidade" obrigatorio>
                    {(id) => (
                      <select
                        id={id}
                        className="form-control"
                        value={f.transporteModalidade}
                        onChange={(e) => mudar({ transporteModalidade: e.target.value })}
                      >
                        <option value="">Selecione</option>
                        {MODALIDADES.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </select>
                    )}
                  </Grupo>

                  <Grupo
                    rotulo="Locadora"
                    dica="Lista fechada: é sobre a locadora que se negocia contrato."
                  >
                    {(id) => (
                      <select
                        id={id}
                        className="form-control"
                        value={f.transporteLocadora}
                        onChange={(e) => mudar({ transporteLocadora: e.target.value as Locadora | "" })}
                      >
                        <option value="">—</option>
                        {LOCADORAS.map((l) => (
                          <option key={l}>{l}</option>
                        ))}
                      </select>
                    )}
                  </Grupo>

                  {f.transporteLocadora === "Outros" ? (
                    <Grupo rotulo="Qual locadora" obrigatorio>
                      {(id) => (
                        <input
                          id={id}
                          className="form-control"
                          placeholder="Nome da locadora"
                          value={f.transporteLocadoraOutra}
                          onChange={(e) => mudar({ transporteLocadoraOutra: e.target.value })}
                        />
                      )}
                    </Grupo>
                  ) : null}

                  <Grupo rotulo="Contrato / reserva">
                    {(id) => (
                      <input
                        id={id}
                        className="form-control"
                        placeholder="Nº do contrato ou da reserva"
                        value={f.transporteContrato}
                        onChange={(e) => mudar({ transporteContrato: e.target.value })}
                      />
                    )}
                  </Grupo>

                  <Grupo rotulo="Placa">
                    {(id) => (
                      <input
                        id={id}
                        className="form-control"
                        maxLength={8}
                        placeholder="ABC1D23"
                        value={f.transportePlaca}
                        onChange={(e) => mudar({ transportePlaca: e.target.value.toUpperCase() })}
                      />
                    )}
                  </Grupo>

                  <Grupo rotulo="Nome do condutor" obrigatorio>
                    {(id) => (
                      <input
                        id={id}
                        className="form-control"
                        placeholder="Nome e sobrenome"
                        value={f.condutor}
                        onChange={(e) => mudar({ condutor: e.target.value })}
                      />
                    )}
                  </Grupo>

                  <Grupo rotulo="CPF do condutor" obrigatorio>
                    {(id) => (
                      <CampoMascarado
                        id={id}
                        mascara="cpf"
                        valor={f.condutorCpf}
                        aoMudar={(v) => mudar({ condutorCpf: v })}
                      />
                    )}
                  </Grupo>

                  <Grupo rotulo="Veículo" obrigatorio>
                    {(id) => (
                      <input
                        id={id}
                        className="form-control"
                        placeholder="Ex.: Hilux / Locação"
                        value={f.veiculoDescricao}
                        onChange={(e) => mudar({ veiculoDescricao: e.target.value })}
                      />
                    )}
                  </Grupo>

                  <Grupo rotulo="Local de recebimento do veículo" obrigatorio largo>
                    {(id) => (
                      <input
                        id={id}
                        className="form-control"
                        placeholder="Onde o condutor pega o veículo"
                        value={f.localRetirada}
                        onChange={(e) => mudar({ localRetirada: e.target.value })}
                      />
                    )}
                  </Grupo>

                  <Grupo rotulo="Data de retirada" obrigatorio>
                    {(id) => (
                      <CampoMascarado id={id} mascara="data" valor={f.dataRetirada} aoMudar={(v) => mudar({ dataRetirada: v })} />
                    )}
                  </Grupo>
                  <Grupo rotulo="Horário de retirada" obrigatorio>
                    {(id) => (
                      <CampoMascarado id={id} mascara="hora" valor={f.horaRetirada} aoMudar={(v) => mudar({ horaRetirada: v })} />
                    )}
                  </Grupo>

                  <Grupo rotulo="Local de entrega do veículo" obrigatorio largo>
                    {(id) => (
                      <input
                        id={id}
                        className="form-control"
                        placeholder="Onde o veículo é devolvido"
                        value={f.localEntrega}
                        onChange={(e) => mudar({ localEntrega: e.target.value })}
                      />
                    )}
                  </Grupo>

                  <Grupo rotulo="Data de entrega" obrigatorio>
                    {(id) => (
                      <CampoMascarado id={id} mascara="data" valor={f.dataEntrega} aoMudar={(v) => mudar({ dataEntrega: v })} />
                    )}
                  </Grupo>
                  <Grupo rotulo="Horário de entrega" obrigatorio>
                    {(id) => (
                      <CampoMascarado id={id} mascara="hora" valor={f.horaEntrega} aoMudar={(v) => mudar({ horaEntrega: v })} />
                    )}
                  </Grupo>
                </div>
              ) : null}
            </Secao>

            {/* ══ 2 · HOSPEDAGEM ══ */}
            <Secao titulo="2 · Hospedagem" icone={<Icone nome="cama" tamanho={18} />}>
              <GrupoDeRadio
                nome="hospedagem"
                valor={f.hospedagemNecessaria ? "sim" : "nao"}
                opcoes={[
                  { valor: "sim", rotulo: "Precisa de hospedagem" },
                  { valor: "nao", rotulo: "Não precisa" },
                ]}
                aoMudar={(v) => mudar({ hospedagemNecessaria: v === "sim" })}
              />
              {f.hospedagemNecessaria ? (
                <div style={{ marginTop: ".6rem" }}>
                  {/* Os nomes da EQUIPE desta solicitação, oferecidos como
                      sugestão no campo "Hospedado(s)". Sai daqui e não de uma
                      lista fixa: quem dorme no hotel é quem vai a este campo. */}
                  <datalist id="lista-equipe-do-campo">
                    {f.equipe
                      .map((e) => e.colaborador.trim())
                      .filter((nome) => nome.length > 0)
                      .map((nome) => (
                        <option key={nome} value={nome} />
                      ))}
                  </datalist>
                  {/* Uma linha por cidade: campo que passa por mais de uma
                      base dorme em mais de um lugar, e cada trecho tem
                      entrada, saída e diária própria. */}
                  <div className="sol-itens">
                    {f.hospedagens.map((linha, indice) => {
                      const noites = noitesDaLinha(linha);
                      return (
                        <div className="sol-hospedagem" key={linha.chave}>
                          <input
                            className="form-control"
                            placeholder="Cidade"
                            value={linha.cidade}
                            onChange={(e) => trocarHospedagem(setF, indice, { cidade: e.target.value })}
                          />
                          {/* QUEM dorme aqui. A linha é por cidade e pode
                              abrigar mais de uma pessoa, então é texto livre —
                              mas com a equipe já digitada como sugestão, para o
                              nome sair igual nos dois lugares. Sem isto, o
                              hotel recebia uma reserva sem saber para quem. */}
                          <input
                            className="form-control"
                            placeholder="Hospedado(s)"
                            list="lista-equipe-do-campo"
                            value={linha.hospedes}
                            onChange={(e) => trocarHospedagem(setF, indice, { hospedes: e.target.value })}
                          />
                          <select
                            className="form-control"
                            value={linha.hotelId}
                            aria-label="Hotel"
                            onChange={(e) => {
                              // Escolher o hotel traz a diária COMBINADA
                              // com a casa — é para isso que o cadastro
                              // existe.
                              const hotel = hoteis.find((h) => h.id === e.target.value);
                              trocarHospedagem(setF, indice, {
                                hotelId: e.target.value,
                                ...(hotel ? { diaria: formatarNumeroBR(hotel.valor_diaria) } : {}),
                              });
                            }}
                          >
                            <option value="">Hotel a definir</option>
                            {hoteis
                              .filter((h) => h.ativo)
                              .map((h) => (
                                <option key={h.id} value={h.id}>
                                  {h.nome} · {h.municipio}/{h.uf}
                                </option>
                              ))}
                          </select>
                          <CampoMascarado
                            mascara="data"
                            valor={linha.entrada}
                            aoMudar={(v) => trocarHospedagem(setF, indice, { entrada: v })}
                            placeholder="Entrada"
                          />
                          <CampoMascarado
                            mascara="data"
                            valor={linha.saida}
                            aoMudar={(v) => trocarHospedagem(setF, indice, { saida: v })}
                            placeholder="Saída"
                          />
                          <span className="sol-disp" title="Diárias (noites) entre entrada e saída">
                            {noites} diária(s)
                          </span>
                          <CampoMascarado
                            mascara="moeda"
                            valor={linha.diaria}
                            aoMudar={(v) => trocarHospedagem(setF, indice, { diaria: v })}
                            placeholder="Diária"
                          />
                          <button
                            className="btn-icon btn-icon-danger"
                            type="button"
                            title="Remover"
                            onClick={() =>
                              setF((a) => ({ ...a, hospedagens: a.hospedagens.filter((_, i) => i !== indice) }))
                            }
                          >
                            <Icone nome="lixeira" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    style={{ marginTop: ".4rem" }}
                    onClick={() => setF((a) => ({ ...a, hospedagens: [...a.hospedagens, linhaDeHospedagemVazia()] }))}
                  >
                    + Adicionar cidade
                  </button>
                </div>
              ) : null}
            </Secao>

            {/* ══ 3 · EQUIPAMENTO ══ */}
            <Secao titulo="3 · Equipamento requisitado para campo" icone={<Icone nome="caixa" tamanho={18} />}>
              <p className="modal-hint">
                {inicioIso && fimIso
                  ? "A lista mostra o que está disponível NAS DATAS deste campo — e não o saldo do estoque. A reserva pega também o dia anterior e o dia seguinte ao período, porque separar, transportar e conferir na volta não cabe no mesmo dia. Pode pedir mesmo assim: se o item estiver livre nas suas datas e só esbarrar nessa folga, o pedido é salvo e o item fica aguardando a liberação do administrativo. Item em manutenção aparece com zero, para você saber por que não pode levar."
                  : "Informe o período do campo para o sistema calcular o que está disponível nessas datas."}
              </p>
              {equipamentosEntregues > 0 ? (
                <p className="modal-hint">
                  <strong>{equipamentosEntregues} equipamento(s) já entregue(s)</strong> não aparecem aqui: eles
                  estão com a equipe, e a linha é a obrigação de devolver. A edição reescreve só o que ainda não
                  saiu.
                </p>
              ) : null}

              <div className="sol-itens">
                {f.equipamentos.map((linha, indice) => {
                  const disp = linha.itemId ? disponibilidadePorItem.get(linha.itemId) : undefined;
                  const quantidade = Number(linha.quantidade) || 1;
                  const excede = disp ? quantidade > disp.disponivel : false;
                  return (
                    <div className={`sol-linha sol-linha-equip${excede ? " sol-linha-excede" : ""}`} key={linha.chave}>
                      <select
                        className="form-control sol-item"
                        value={linha.itemId}
                        aria-label="Equipamento"
                        onChange={(e) => trocarEquipamento(setF, indice, { itemId: e.target.value })}
                      >
                        <option value="">Selecione o equipamento no estoque</option>
                        {catalogo.map((c) => {
                          const d = disponibilidadePorItem.get(c.id);
                          const rotulo = c.em_manutencao
                            ? "em manutenção"
                            : d
                              ? `${d.disponivel} disponível${d.disponivel === 1 ? "" : "s"} no período`
                              : `saldo ${c.estoque_atual}`;
                          // Item indisponível CONTINUA na lista, desabilitado:
                          // quem pede precisa saber que o item existe e por
                          // que não pode levar.
                          const bloqueado = d ? d.disponivel <= 0 && c.id !== linha.itemId : false;
                          return (
                            <option key={c.id} value={c.id} disabled={bloqueado}>
                              {c.produto} · {c.codigo} ({rotulo})
                            </option>
                          );
                        })}
                      </select>
                      <input
                        className="form-control sol-qtd"
                        type="number"
                        min={1}
                        title="Quantidade"
                        value={linha.quantidade}
                        onChange={(e) => trocarEquipamento(setF, indice, { quantidade: e.target.value })}
                      />
                      <span
                        className="sol-disp"
                        title="Disponível nas datas do campo, contando um dia de folga antes e depois"
                      >
                        {disp ? `${disp.disponivel} disp.` : "—"}
                      </span>
                      <button
                        className="btn-icon btn-icon-danger"
                        type="button"
                        title="Remover"
                        onClick={() =>
                          setF((a) => ({ ...a, equipamentos: a.equipamentos.filter((_, i) => i !== indice) }))
                        }
                      >
                        <Icone nome="lixeira" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                style={{ marginTop: ".5rem" }}
                onClick={() => setF((a) => ({ ...a, equipamentos: [...a.equipamentos, linhaDeEquipamentoVazia()] }))}
              >
                + Adicionar equipamento
              </button>
            </Secao>
          </>
        ) : (
          <>
            {/* ══ FINANCEIRO ══ */}
            <Secao
              titulo="Valor com necessidade de prestação de contas"
              icone={<Icone nome="dinheiro" tamanho={18} />}
            >
              {GRUPOS_DESPESA.map((grupo, ordem) => (
                <div key={grupo}>
                  <h5 className="form-subtitle-mini">
                    {ordem + 1} · {grupo}
                  </h5>
                  <div className="sol-itens">
                    {f.despesas.map((linha, indice) =>
                      linha.grupo !== grupo ? null : (
                        <div className="sol-linha sol-linha-despesa" key={linha.chave}>
                          <input
                            className="form-control"
                            placeholder="Descrição"
                            value={linha.descricao}
                            onChange={(e) => trocarDespesa(setF, indice, { descricao: e.target.value })}
                          />
                          <CampoMascarado
                            mascara="moeda"
                            valor={linha.valor}
                            aoMudar={(v) => trocarDespesa(setF, indice, { valor: v })}
                          />
                          <button
                            className="btn-icon btn-icon-danger"
                            type="button"
                            title="Remover"
                            onClick={() =>
                              setF((a) => ({ ...a, despesas: a.despesas.filter((_, i) => i !== indice) }))
                            }
                          >
                            <Icone nome="lixeira" />
                          </button>
                        </div>
                      )
                    )}
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    style={{ marginTop: ".4rem" }}
                    onClick={() => setF((a) => ({ ...a, despesas: [...a.despesas, linhaDeDespesaVazia(grupo)] }))}
                  >
                    + Adicionar
                  </button>
                </div>
              ))}

              <div className="form-preview-row">
                {GRUPOS_DESPESA.map((g) => (
                  <div className="form-preview-item" key={g}>
                    <span>{g}</span>
                    <strong>{formatarMoeda(totalDoGrupo(f.despesas, g))}</strong>
                  </div>
                ))}
                <div className="form-preview-item">
                  <span>Total</span>
                  <strong>{formatarMoeda(totalDespesas)}</strong>
                </div>
              </div>

              <div className="form-group" style={{ marginTop: ".7rem" }}>
                <label className="form-label required" htmlFor="dados-transferencia">
                  4 · Dados da transferência
                </label>
                <textarea
                  id="dados-transferencia"
                  className="form-control"
                  rows={2}
                  placeholder="Banco, agência, conta, PIX e favorecido"
                  value={f.dadosTransferencia}
                  onChange={(e) => mudar({ dadosTransferencia: e.target.value })}
                />
              </div>
            </Secao>

            <Secao
              titulo="Valor sem prestação de contas · alimentação (mediante recibo)"
              icone={<Icone nome="talher" tamanho={18} />}
            >
              <div className="sol-itens">
                {f.diarias.map((linha, indice) => {
                  const oferecidas = diariasDoVinculo(diariasCadastradas, linha.vinculo);
                  const referencia = diariaPorTipo(diariasCadastradas, linha.tipoDiaria);
                  // Diária fora da referência fica marcada: a diferença
                  // passa a ser escolhida, e não acidental.
                  const foraDaReferencia =
                    referencia != null && parseMoeda(linha.valor) > 0 && parseMoeda(linha.valor) !== referencia.valor;
                  return (
                    <div className={`sol-diaria${foraDaReferencia ? " sol-diaria-diverge" : ""}`} key={linha.chave}>
                      <input
                        className="form-control"
                        placeholder="Colaborador"
                        list="lista-equipe-atual"
                        value={linha.colaborador}
                        onChange={(e) => trocarDiaria(setF, indice, { colaborador: e.target.value })}
                      />
                      <select
                        className="form-control"
                        value={linha.vinculo}
                        aria-label="Vínculo"
                        onChange={(e) => {
                          const vinculo = e.target.value as Vinculo;
                          const primeira = diariasDoVinculo(diariasCadastradas, vinculo)[0];
                          trocarDiaria(setF, indice, {
                            vinculo,
                            tipoDiaria: primeira?.tipo_diaria ?? "",
                            valor: primeira ? formatarNumeroBR(primeira.valor) : "",
                          });
                        }}
                      >
                        {VINCULOS.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                      <select
                        className="form-control"
                        value={linha.tipoDiaria}
                        aria-label="Tipo de diária"
                        onChange={(e) => {
                          // Escolher o tipo preenche o valor sozinho; o
                          // campo continua editável.
                          const escolhida = diariaPorTipo(diariasCadastradas, e.target.value);
                          trocarDiaria(setF, indice, {
                            tipoDiaria: e.target.value,
                            ...(escolhida ? { valor: formatarNumeroBR(escolhida.valor) } : {}),
                          });
                        }}
                      >
                        {oferecidas.map((d) => (
                          <option key={d.tipo_diaria} value={d.tipo_diaria}>
                            {d.tipo_diaria} · {formatarMoeda(d.valor)}
                          </option>
                        ))}
                      </select>
                      <input
                        className="form-control"
                        type="number"
                        min={1}
                        title="Dias"
                        value={linha.dias}
                        onChange={(e) => trocarDiaria(setF, indice, { dias: e.target.value })}
                      />
                      <CampoMascarado
                        mascara="moeda"
                        valor={linha.valor}
                        aoMudar={(v) => trocarDiaria(setF, indice, { valor: v })}
                        className="form-control d-valor"
                      />
                      <input
                        className="form-control"
                        placeholder="Dados bancários"
                        value={linha.dadosBancarios}
                        onChange={(e) => trocarDiaria(setF, indice, { dadosBancarios: e.target.value })}
                      />
                      <button
                        className="btn-icon btn-icon-danger"
                        type="button"
                        title="Remover"
                        onClick={() => setF((a) => ({ ...a, diarias: a.diarias.filter((_, i) => i !== indice) }))}
                      >
                        <Icone nome="lixeira" />
                      </button>
                    </div>
                  );
                })}
              </div>
              {/* Os nomes da equipe deste pedido, para as diárias sugerirem
                  as mesmas pessoas — digitar o nome duas vezes é onde ele
                  sai diferente. */}
              <datalist id="lista-equipe-atual">
                {f.equipe
                  .filter((e) => e.colaborador.trim())
                  .map((e) => (
                    <option key={e.chave} value={e.colaborador} />
                  ))}
              </datalist>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                style={{ marginTop: ".5rem" }}
                onClick={() =>
                  setF((a) => {
                    const primeira = diariasDoVinculo(diariasCadastradas, "Seteg")[0];
                    const nova = linhaDeDiariaVazia(primeira?.tipo_diaria ?? "");
                    return {
                      ...a,
                      diarias: [
                        ...a.diarias,
                        primeira ? { ...nova, valor: formatarNumeroBR(primeira.valor) } : nova,
                      ],
                    };
                  })
                }
              >
                + Adicionar diária
              </button>
              <div className="form-preview-row">
                <div className="form-preview-item">
                  <span>Total a transferir</span>
                  <strong>{formatarMoeda(totalDiarias)}</strong>
                </div>
                <div className="form-preview-item">
                  <span>Total geral da solicitação</span>
                  <strong>{formatarMoeda(totalDespesas + totalDiarias)}</strong>
                </div>
              </div>
            </Secao>
          </>
        )}

        {/* ══ SST — SÓ NO ADMINISTRATIVO ══
            Saiu do pedido FINANCEIRO. SST é sobre o que vai a campo: EPI,
            equipe exposta, risco do cliente. Um pedido financeiro é
            prestação de contas — despesa, diária, dados de transferência —
            e não tira ninguém do escritório. Perguntar segurança do
            trabalho ali era pedir duas vezes o que o administrativo já
            responde, e a segunda resposta é a que ninguém confere.

            UMA MARCA, desde a v3: se aplica ou não se aplica. Antes eram
            seis conferências (APR, PT, DDS, treinamento, ASO, EPI) mais o
            responsável, e o pedido só ficava "Conforme" com as seis
            fechadas — o que na prática deixava quase todo campo em
            "Pendente". As colunas continuam no banco com o que já estava
            gravado; nada novo é escrito nelas.

            A LISTA DE EPIs continua: ela não é uma marca de conferência, é
            o que sai fisicamente com a equipe, e é ela que aparece no
            checklist impresso. */}
        {administrativo ? (
        <Secao titulo="SST · segurança do trabalho" icone={<Icone nome="escudo" tamanho={18} />}>
          <GrupoDeRadio
            nome="sst"
            valor={f.sstAplicavel ? "sim" : "nao"}
            opcoes={[
              { valor: "sim", rotulo: "Se aplica" },
              { valor: "nao", rotulo: "Não se aplica" },
            ]}
            aoMudar={(v) => mudar({ sstAplicavel: v === "sim" })}
          />
          {f.sstAplicavel ? (
            <div style={{ marginTop: ".6rem" }}>
              <h5 className="form-subtitle-mini">EPIs que vão com a equipe</h5>
              <div className="sol-itens">
                {f.epis.map((linha, indice) => (
                  <div className="sol-epi" key={linha.chave}>
                    <input
                      className="form-control"
                      placeholder="EPI"
                      list="lista-epis"
                      value={linha.epi}
                      onChange={(e) => trocarEpi(setF, indice, { epi: e.target.value })}
                    />
                    <input
                      className="form-control"
                      type="number"
                      min={1}
                      title="Quantidade"
                      value={linha.quantidade}
                      onChange={(e) => trocarEpi(setF, indice, { quantidade: e.target.value })}
                    />
                    <input
                      className="form-control"
                      placeholder="CA"
                      value={linha.ca}
                      onChange={(e) => trocarEpi(setF, indice, { ca: e.target.value })}
                    />
                    <Caixa marcada={linha.conferido} aoMudar={(v) => trocarEpi(setF, indice, { conferido: v })}>
                      Conferido
                    </Caixa>
                    <button
                      className="btn-icon btn-icon-danger"
                      type="button"
                      title="Remover"
                      onClick={() => setF((a) => ({ ...a, epis: a.epis.filter((_, i) => i !== indice) }))}
                    >
                      <Icone nome="lixeira" />
                    </button>
                  </div>
                ))}
              </div>
              <datalist id="lista-epis">
                {EPIS_PADRAO.map((e) => (
                  <option key={e} value={e} />
                ))}
              </datalist>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                style={{ marginTop: ".4rem" }}
                onClick={() => setF((a) => ({ ...a, epis: [...a.epis, linhaDeEpiVazia()] }))}
              >
                + Adicionar EPI
              </button>

              <div className="form-group" style={{ marginTop: ".6rem" }}>
                <label className="form-label" htmlFor="sst-observacao">
                  Observação de SST
                </label>
                <textarea
                  id="sst-observacao"
                  className="form-control"
                  rows={2}
                  placeholder="Risco específico, restrição do cliente, o que mais precisa ser dito"
                  value={f.sstObservacao}
                  onChange={(e) => mudar({ sstObservacao: e.target.value })}
                />
              </div>
            </div>
          ) : null}
        </Secao>
        ) : null}

        {/* ══ PREVISTO × REAL ══ */}
        <Secao titulo="Previsto × Real" icone={<Icone nome="grafico" tamanho={18} />}>
          {/* Os totais, o desvio e o status de curso são CALCULADOS NO
              BANCO por trigger. O que está aqui é a prévia — com a mesma
              faixa de 5%, para não contar história diferente. */}
          <div className="pxr-tabela">
            <div className="pxr-cabecalho">
              <span>Linha</span>
              <span>Previsto</span>
              <span>Real</span>
              <span>Desvio</span>
            </div>
            <LinhaPxr
              rotulo="Veículo / transporte"
              previsto={f.previstoVeiculo}
              real={f.realVeiculo}
              aoMudarPrevisto={(v) => mudar({ previstoVeiculo: v })}
              aoMudarReal={(v) => mudar({ realVeiculo: v })}
            />
            <LinhaPxr
              rotulo="Hospedagem"
              previsto={f.previstoHospedagem}
              real={f.realHospedagem}
              aoMudarPrevisto={(v) => mudar({ previstoHospedagem: v })}
              aoMudarReal={(v) => mudar({ realHospedagem: v })}
            />
            <LinhaPxr
              rotulo="Alimentação (diárias)"
              previsto={f.previstoAlimentacao}
              real={f.realAlimentacao}
              aoMudarPrevisto={(v) => mudar({ previstoAlimentacao: v })}
              aoMudarReal={(v) => mudar({ realAlimentacao: v })}
            />
            <LinhaPxr
              rotulo="Outros"
              previsto={f.previstoOutros}
              real={f.realOutros}
              aoMudarPrevisto={(v) => mudar({ previstoOutros: v })}
              aoMudarReal={(v) => mudar({ realOutros: v })}
            />
            {/* AVARIA — linha de leitura. O valor vem das avarias
                registradas neste campo (aba Avarias) e é somado pelo
                banco; não há o que digitar aqui, e um campo editável
                sugeriria que dá para ajustar o custo por fora. Só aparece
                quando existe avaria: uma linha zerada em todo campo seria
                ruído. */}
            {f.realAvaria > 0 ? (
              <div className="pxr-linha">
                <span>Avaria (das avarias registradas)</span>
                <span>—</span>
                <strong>{formatarMoeda(f.realAvaria)}</strong>
                <span>—</span>
              </div>
            ) : null}
            <div className="pxr-linha pxr-total">
              <span>Total</span>
              <strong>{formatarMoeda(previstoTotal)}</strong>
              <strong>{formatarMoeda(realTotal)}</strong>
              <strong className={classeDeDesvio(realTotal - previstoTotal)}>
                {previstoTotal || realTotal ? textoDeDesvio(previstoTotal, realTotal) : "—"}
              </strong>
            </div>
          </div>

          <div className="form-preview-row">
            <div className="form-preview-item">
              <span>Status de curso</span>
              <strong>
                <Selo texto={curso} classe={classeDoCurso(curso)} />
              </strong>
            </div>
            <div className="form-preview-item">
              <span>Sugestão pelo período</span>
              <strong>
                {sugestao
                  ? `${formatarMoeda(sugestao.veiculo + sugestao.hospedagem + sugestao.alimentacao)} · ${sugestao.dias} dia(s) × ${sugestao.equipe} pessoa(s) · diária ${formatarMoeda(sugestao.referenciaDaDiaria)} ${sugestao.temPernoite ? "com" : "sem"} pernoite`
                  : "Informe o período"}
              </strong>
            </div>
            <div className="form-preview-item">
              <button className="btn btn-ghost btn-sm" type="button" onClick={aplicarSugestao}>
                Aplicar sugestão
              </button>
            </div>
          </div>
        </Secao>

        <Secao titulo="Observação">
          <div className="form-group">
            <textarea
              className="form-control"
              rows={2}
              placeholder="Informações que ajudem quem vai atender"
              value={f.observacao}
              onChange={(e) => mudar({ observacao: e.target.value })}
              aria-label="Observação"
            />
          </div>
        </Secao>

        <div className="modal-footer" style={{ paddingInline: 0 }}>
          <button className="btn btn-ghost" type="button" onClick={fechar} disabled={enviando}>
            Cancelar
          </button>
          <button className="btn btn-primary" type="button" onClick={enviar} disabled={enviando}>
            {enviando ? "Enviando…" : editando ? "Salvar alterações" : "Enviar solicitação"}
          </button>
        </div>
    </Casca>
  );
}

/**
 * A CASCA — a única diferença entre o formulário-página e o
 * formulário-popup.
 *
 * Como PÁGINA, ele precisa do próprio cabeçalho (título + Voltar) e da
 * própria rolagem: `.secao` é `overflow:hidden`, e sem `pagina-rolavel` o
 * botão de enviar, lá no fim, ficaria fora da tela.
 *
 * Como POPUP, as duas coisas já vêm do Modal — o título no cabeçalho dele
 * e a rolagem no `.modal-body`. Repetir aqui daria dois cabeçalhos e duas
 * barras de rolagem, uma dentro da outra.
 */
function Casca({
  emPopup,
  titulo,
  aoFechar,
  children,
}: {
  emPopup: boolean;
  titulo: string;
  aoFechar: () => void;
  children: React.ReactNode;
}) {
  // `form-em-popup` existe por uma razão só, e ela não é estética: o
  // design system aplica `text-transform:uppercase` em todo `.form-control`
  // dentro de `.modal-body`. Faz sentido nos cadastros (cliente, hotel e
  // projeto SÃO gravados em caixa alta), mas não aqui — este formulário
  // tem observação, nome de condutor e dados bancários, que o servidor
  // grava como foram digitados. Sem esta classe, o popup mostraria em
  // maiúsculas um texto que será salvo em minúsculas.
  if (emPopup) return <div className="form-em-popup">{children}</div>;

  return (
    <section className="secao active">
      <div className="sec-header">
        <h2>{titulo}</h2>
        <div className="sec-header-right">
          <button className="btn btn-ghost btn-sm" type="button" onClick={aoFechar}>
            ← Voltar
          </button>
        </div>
      </div>
      <div className="lista-wrapper pagina-rolavel" style={{ padding: "1.2rem" }}>
        {children}
      </div>
    </section>
  );
}

// ─── Peças ───────────────────────────────────────────────────────────────

function LinhaPxr({
  rotulo,
  previsto,
  real,
  aoMudarPrevisto,
  aoMudarReal,
}: {
  rotulo: string;
  previsto: string;
  real: string;
  aoMudarPrevisto: (v: string) => void;
  aoMudarReal: (v: string) => void;
}) {
  const p = parseMoeda(previsto);
  const r = parseMoeda(real);
  const desvio = r - p;
  return (
    <div className="pxr-linha">
      <span>{rotulo}</span>
      <CampoMascarado mascara="moeda" valor={previsto} aoMudar={aoMudarPrevisto} />
      <CampoMascarado mascara="moeda" valor={real} aoMudar={aoMudarReal} />
      <strong className={classeDeDesvio(desvio)}>
        {p || r ? `${desvio > 0 ? "+" : desvio < 0 ? "−" : ""}${formatarMoeda(Math.abs(desvio))}` : "—"}
      </strong>
    </div>
  );
}

function classeDeDesvio(desvio: number): string {
  return desvio > 0 ? "pxr-acima" : desvio < 0 ? "pxr-abaixo" : "";
}

function textoDeDesvio(previsto: number, real: number): string {
  const desvio = real - previsto;
  const sinal = desvio > 0 ? "+" : desvio < 0 ? "−" : "";
  const percentual = previsto ? ` (${desvio > 0 ? "+" : ""}${((desvio / previsto) * 100).toFixed(1)}%)` : "";
  return `${sinal}${formatarMoeda(Math.abs(desvio))}${percentual}`;
}

/**
 * A frase que diz DE QUEM o pedido depende. É a razão de o campo Projeto
 * ser obrigatório: quem pede precisa saber quem vai decidir.
 */
function DicaDoProjeto({
  projeto,
  temProjetos,
  usuarioId,
  ehDirecao,
}: {
  projeto: Projeto | undefined;
  temProjetos: boolean;
  usuarioId: string;
  ehDirecao: boolean;
}) {
  if (!projeto) {
    return (
      <span className="form-hint-alerta">
        {temProjetos
          ? "Escolha o projeto: é o líder dele que aprova esta solicitação."
          : "Nenhum projeto cadastrado. A Direção precisa cadastrar projeto e líder antes de abrir solicitação."}
      </span>
    );
  }
  if (!projeto.lider_id) {
    return (
      <span className="form-hint-alerta">
        Este projeto está sem líder — a Direção precisa completar o cadastro antes de alguém pedir campo nele.
      </span>
    );
  }
  if (projeto.lider_id === usuarioId) {
    return <span className="form-hint-ok">Você lidera este projeto: a solicitação já nasce aprovada.</span>;
  }
  if (ehDirecao) {
    return (
      <span className="form-hint-ok">
        Líder: {projeto.lider}. Como Direção, sua solicitação já nasce aprovada.
      </span>
    );
  }
  return (
    <>
      Quem aprova é {projeto.lider}
      {projeto.escopo ? ` · escopo: ${projeto.escopo}` : ""}.
    </>
  );
}

function DicaDoClockify({ lista }: { lista: ListaClockify | null }) {
  if (!lista) return <>Buscando os projetos no Clockify…</>;
  if (lista.erro) return <span className="form-hint-alerta">{lista.erro}</span>;
  return <>{lista.projetos.length} projeto(s) do Clockify na lista.</>;
}

function totalDoGrupo(despesas: readonly { grupo: GrupoDespesa; valor: string }[], grupo: GrupoDespesa): number {
  return despesas.filter((d) => d.grupo === grupo).reduce((t, d) => t + parseMoeda(d.valor), 0);
}

// ─── Atualizadores de linha ──────────────────────────────────────────────
//
// Um por lista, em vez de um genérico com `keyof`: o genérico ficaria com
// a assinatura ilegível e o ganho seria nenhum — são cinco linhas cada.

type Definir = React.Dispatch<React.SetStateAction<EstadoDoFormulario>>;

function trocarEquipe(setF: Definir, indice: number, mudanca: Partial<EstadoDoFormulario["equipe"][number]>) {
  setF((a) => ({ ...a, equipe: a.equipe.map((l, i) => (i === indice ? { ...l, ...mudanca } : l)) }));
}

function trocarHospedagem(
  setF: Definir,
  indice: number,
  mudanca: Partial<EstadoDoFormulario["hospedagens"][number]>
) {
  setF((a) => ({ ...a, hospedagens: a.hospedagens.map((l, i) => (i === indice ? { ...l, ...mudanca } : l)) }));
}

function trocarEquipamento(
  setF: Definir,
  indice: number,
  mudanca: Partial<EstadoDoFormulario["equipamentos"][number]>
) {
  setF((a) => ({ ...a, equipamentos: a.equipamentos.map((l, i) => (i === indice ? { ...l, ...mudanca } : l)) }));
}

function trocarDespesa(setF: Definir, indice: number, mudanca: Partial<EstadoDoFormulario["despesas"][number]>) {
  setF((a) => ({ ...a, despesas: a.despesas.map((l, i) => (i === indice ? { ...l, ...mudanca } : l)) }));
}

function trocarDiaria(setF: Definir, indice: number, mudanca: Partial<EstadoDoFormulario["diarias"][number]>) {
  setF((a) => ({ ...a, diarias: a.diarias.map((l, i) => (i === indice ? { ...l, ...mudanca } : l)) }));
}

function trocarEpi(setF: Definir, indice: number, mudanca: Partial<EstadoDoFormulario["epis"][number]>) {
  setF((a) => ({ ...a, epis: a.epis.map((l, i) => (i === indice ? { ...l, ...mudanca } : l)) }));
}

// `formularioVazio` é reexportado para a página de "nova" não precisar
// importar de dois lugares.
export { formularioVazio };
