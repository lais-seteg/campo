"use client";

// ═══════════════════════════════════════════════════════════════════════
//  CADASTRO DE PROJETOS E LÍDERES
//
//  Cada projeto tem cliente, projeto, LÍDER, o PRAZO, o ESCOPO e o GASTO
//  PREVISTO por categoria.
//
//  ── DE ONDE VEM O LÍDER ──
//
//  Do ORGANOGRAMA (aba própria, `colaboradores`): quem a Direção autorizou
//  a liderar, está ativo e tem acesso ao sistema. Até então a lista era
//  `perfis` INTEIRA — os trinta e três acessos, técnico por técnico, como
//  candidatos a aprovar campo. Continua sendo lista e não texto livre,
//  pelo mesmo motivo de sempre: nome digitado não aprova nada.
//
//  ── AS TRÊS MUDANÇAS DA v3 ──
//
//   · PRAZO: início e fim do projeto. Opcionais, porque projeto existe
//     antes de o contrato ter data — mas fim antes do início não passa.
//   · ESCOPO no lugar de "programas desenvolvidos". Mesmo campo, o nome do
//     contrato. Continua digitado um item por linha e gravado como texto
//     separado por vírgula, que é como a busca e a exportação leem.
//   · GASTO PREVISTO: era três valores fixos POR DIA (veículo, hotel,
//     alimentação); agora é uma LISTA de categoria + valor TOTAL do
//     projeto, com um "+" para o que este contrato tem e os outros não —
//     licença ambiental, análise laboratorial, frete de equipamento.
//
//  E SITUAÇÃO em quatro estados no lugar de Ativo/Inativo: Stand By,
//  Ativo, Cancelado, Finalizado. SÓ `Ativo` aceita solicitação nova (o
//  banco recusa o insert nos outros três), e campo já aberto segue até o
//  fim — pedido em andamento não morre porque o projeto entrou em pausa.
// ═══════════════════════════════════════════════════════════════════════

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/app/components/Modal";
import { useAvisos } from "@/app/components/Avisos";
import { CampoMascarado, Grupo } from "@/app/components/Campos";
import {
  BotaoExportarCsv,
  CabecalhoDeSecao,
  Paginacao,
  Selo,
  TabelaVazia,
} from "@/app/components/Tabela";
import { Icone } from "@/app/components/Icone";
import { Bloco, Grade, Info, TabelaDeLeitura } from "@/app/components/Detalhe";
import { get, mensagemDoErro, patch, post, remover } from "@/app/components/api";
import {
  csvNumero,
  dataBRparaISO,
  dataISOparaBR,
  formatarMoeda,
  formatarNumeroBR,
  parseMoeda,
} from "@/lib/formato";
import { classeDaSituacaoDoProjeto } from "@/lib/listas";
import type { ListaClockify } from "@/lib/clockify";
import { CATEGORIAS_DE_GASTO, SITUACOES_PROJETO } from "@/lib/tipos";
import type { LiderDisponivel, Projeto, ProjetoGastoPrevisto, SituacaoProjeto } from "@/lib/tipos";

/** Uma linha do bloco de gasto previsto. A `chave` existe só para o React:
 *  sem ela, remover a linha do meio remontaria os campos de baixo e o
 *  cursor saltaria de lugar enquanto a pessoa digita. */
interface LinhaDeGasto {
  chave: string;
  categoria: string;
  valor: string;
  observacao: string;
}

interface Rascunho {
  id: string | null;
  cliente: string;
  nome: string;
  liderId: string;
  /**
   * O nome do líder ATUAL, como está gravado no projeto. Existe só para o
   * caso em que ele saiu do organograma (desativado, com o acesso desligado
   * ou excluído) e por isso não está na lista de candidatos: sem guardá-lo, o
   * seletor abriria em branco e salvar trocaria o líder de um projeto em
   * andamento sem ninguém ter escolhido isso.
   */
  liderNome: string;
  clockify: string;
  escopo: string[];
  inicio: string;
  fim: string;
  gastos: LinhaDeGasto[];
  observacao: string;
  situacao: SituacaoProjeto;
}

let sequenciaDeChave = 0;
function linhaDeGastoVazia(): LinhaDeGasto {
  sequenciaDeChave += 1;
  return { chave: `g${sequenciaDeChave}`, categoria: "", valor: "", observacao: "" };
}

function rascunhoVazio(): Rascunho {
  return {
    id: null,
    cliente: "",
    nome: "",
    liderId: "",
    liderNome: "",
    clockify: "",
    escopo: [""],
    inicio: "",
    fim: "",
    gastos: [linhaDeGastoVazia()],
    observacao: "",
    situacao: "Ativo",
  };
}

function rascunhoDe(p: Projeto, gastos: readonly ProjetoGastoPrevisto[]): Rascunho {
  return {
    id: p.id,
    cliente: p.cliente,
    nome: p.nome,
    liderId: p.lider_id ?? "",
    liderNome: p.lider ?? "",
    clockify: p.codigo_clockify ?? "",
    escopo: separarEscopo(p.escopo),
    inicio: dataISOparaBR(p.data_inicio),
    fim: dataISOparaBR(p.data_fim),
    // Uma linha em branco no fim para a Direção acrescentar sem precisar
    // clicar no "+" primeiro.
    gastos: [
      ...gastos.map((g) => ({
        ...linhaDeGastoVazia(),
        categoria: g.categoria,
        valor: formatarNumeroBR(g.valor),
        observacao: g.observacao ?? "",
      })),
      linhaDeGastoVazia(),
    ],
    observacao: p.observacao ?? "",
    situacao: p.situacao,
  };
}

/** A coluna é texto separado por vírgula; a tela mostra um campo por item.
 *  Uma linha em branco garante que o bloco nunca abre vazio. */
function separarEscopo(texto: string | null): string[] {
  const lista = (texto ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return lista.length ? lista : [""];
}

interface Props {
  projetos: Projeto[];
  gastosPrevistos: ProjetoGastoPrevisto[];
  /**
   * Quem pode ser líder — vem do ORGANOGRAMA, e não mais de `perfis`
   * inteira. Antes o seletor oferecia os trinta e três acessos do sistema,
   * técnico por técnico, como candidatos a aprovar campo; agora oferece
   * quem a Direção autorizou no organograma, está ativo e tem login (ver
   * `lideresDisponiveis()` em lib/consultas.ts).
   */
  lideresDisponiveis: LiderDisponivel[];
  campos: Record<string, number>;
  aAprovar: Record<string, number>;
  v2Ativa: boolean;
}

export function CadastroDeProjetos({
  projetos,
  gastosPrevistos,
  lideresDisponiveis,
  campos,
  aAprovar,
  v2Ativa,
}: Props) {
  const roteador = useRouter();
  const { avisar } = useAvisos();

  const [busca, setBusca] = useState("");
  const [liderFiltro, setLiderFiltro] = useState("");
  const [situacaoFiltro, setSituacaoFiltro] = useState("");
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(20);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  /** O projeto aberto SÓ PARA LEITURA (o olho). Separado de `rascunho` de
   *  propósito: ver não é editar, e um estado só faria o "Salvar" aparecer
   *  numa tela que ninguém pediu para mudar. */
  const [detalhe, setDetalhe] = useState<Projeto | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [clockify, setClockify] = useState<ListaClockify | null>(null);

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

  // Agrupado UMA vez: cruzar a lista de gastos dentro de cada linha da
  // tabela refaria a varredura N vezes por render.
  const gastosPorProjeto = useMemo(() => {
    const mapa = new Map<string, ProjetoGastoPrevisto[]>();
    for (const g of gastosPrevistos) {
      const atual = mapa.get(g.projeto_id);
      if (atual) atual.push(g);
      else mapa.set(g.projeto_id, [g]);
    }
    return mapa;
  }, [gastosPrevistos]);

  const totalPrevistoDo = (projetoId: string) =>
    (gastosPorProjeto.get(projetoId) ?? []).reduce((t, g) => t + (Number(g.valor) || 0), 0);

  // O FILTRO da tabela sai dos projetos, não do organograma: filtrar por
  // alguém que não lidera nada devolveria uma lista vazia sempre. São duas
  // listas diferentes de propósito — esta é "quem lidera", a de baixo é
  // "quem pode liderar".
  const lideresComProjeto = useMemo(
    () => Array.from(new Set(projetos.map((p) => p.lider).filter((l): l is string => !!l))).sort(),
    [projetos]
  );

  /**
   * As opções do seletor de líder: os candidatos do organograma, MAIS o
   * líder atual deste projeto quando ele já não é candidato.
   *
   * Esse acréscimo é o que impede uma troca silenciosa: se o líder de um
   * projeto em andamento for desativado no organograma (ou perder o acesso), o
   * seletor abriria em branco, e salvar qualquer outra coisa no cadastro
   * gravaria um líder diferente — ou falharia na validação — sem que
   * ninguém tivesse pedido para trocar. Ele aparece marcado, e a Direção
   * decide se troca.
   */
  const opcoesDeLider = useMemo(() => {
    const atual = rascunho?.liderId;
    if (!atual || lideresDisponiveis.some((l) => l.perfil_id === atual)) {
      return lideresDisponiveis;
    }
    return [
      ...lideresDisponiveis,
      {
        perfil_id: atual,
        nome: `${rascunho?.liderNome || "Líder atual"} (fora do organograma)`,
        cargo: null,
        setor: null,
      },
    ];
  }, [lideresDisponiveis, rascunho?.liderId, rascunho?.liderNome]);

  const filtrados = useMemo(() => {
    const texto = busca.trim().toLowerCase();
    return projetos.filter((p) => {
      if (liderFiltro && p.lider !== liderFiltro) return false;
      if (situacaoFiltro && p.situacao !== situacaoFiltro) return false;
      if (!texto) return true;
      return `${p.cliente} ${p.nome} ${p.lider ?? ""} ${p.escopo ?? ""}`.toLowerCase().includes(texto);
    });
  }, [projetos, busca, liderFiltro, situacaoFiltro]);

  // ── PAGINAÇÃO ──
  //
  // A página pedida pode não existir mais depois de um filtro que encurtou
  // a lista. Corrigir NA LEITURA (e não num efeito que chama setState)
  // evita uma renderização a mais e o pisca-pisca que vem com ela — é o
  // mesmo desenho da lista de solicitações.
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / porPagina));
  const paginaAtual = Math.min(Math.max(1, pagina), totalPaginas);
  const inicio = (paginaAtual - 1) * porPagina;
  const daPagina = filtrados.slice(inicio, inicio + porPagina);

  /** Todo filtro volta para a primeira página: continuar na página 7 de uma
   *  lista que agora tem duas mostraria a tabela vazia sem explicar por quê. */
  function filtrar(aplicar: () => void) {
    aplicar();
    setPagina(1);
  }

  const totalDosGastosDoRascunho = useMemo(
    () => (rascunho?.gastos ?? []).reduce((t, g) => t + parseMoeda(g.valor), 0),
    [rascunho]
  );

  async function salvar() {
    if (!rascunho) return;

    const escopo = rascunho.escopo.map((s) => s.trim()).filter(Boolean);
    if (!rascunho.cliente.trim() || !rascunho.nome.trim()) {
      avisar("Preencha cliente e projeto.", "erro");
      return;
    }
    if (!rascunho.liderId) {
      avisar("Escolha o líder do projeto — é ele quem aprova o campo.", "erro");
      return;
    }
    if (!escopo.length) {
      avisar("Informe ao menos um item de escopo.", "erro");
      return;
    }

    const inicio = dataBRparaISO(rascunho.inicio) || null;
    const fim = dataBRparaISO(rascunho.fim) || null;
    if (rascunho.inicio.trim() && !inicio) {
      avisar("Data de início incompleta.", "erro");
      return;
    }
    if (rascunho.fim.trim() && !fim) {
      avisar("Data de fim incompleta.", "erro");
      return;
    }
    if (inicio && fim && fim < inicio) {
      avisar("A data de fim do projeto é anterior à de início.", "erro");
      return;
    }

    // Linha em branco é descartada (a tela abre com uma por conveniência);
    // linha com valor e sem categoria é erro, porque ninguém sabe do que é
    // o gasto.
    const gastos: { categoria: string; valor: number; observacao: string | null }[] = [];
    for (const linha of rascunho.gastos) {
      const categoria = linha.categoria.trim();
      const valor = parseMoeda(linha.valor);
      if (!categoria && !valor) continue;
      if (!categoria) {
        avisar("Há um gasto previsto com valor e sem categoria. Diga do que é o gasto.", "erro");
        return;
      }
      gastos.push({ categoria, valor, observacao: linha.observacao.trim() || null });
    }

    const corpo = {
      cliente: rascunho.cliente,
      nome: rascunho.nome,
      lider_id: rascunho.liderId,
      codigo_clockify: rascunho.clockify || null,
      // `lider` (o texto) NÃO é enviado: é preenchido por trigger a partir
      // do `lider_id`. Mandar os dois faria eles divergirem. `ativo` idem:
      // no banco ele é derivado de `situacao`.
      escopo,
      data_inicio: inicio,
      data_fim: fim,
      gastos,
      observacao: rascunho.observacao || null,
      situacao: rascunho.situacao,
    };

    setOcupado(true);
    try {
      const resposta = rascunho.id
        ? await patch<{ aviso?: string }>(`/api/projetos/${rascunho.id}`, corpo)
        : await post<{ aviso?: string }>("/api/projetos", corpo);

      setRascunho(null);
      // O projeto grava numa tabela e os gastos em outra, sem transação: o
      // servidor avisa quando a segunda parte falhou, e a tela repassa em
      // vez de dizer "salvo" sobre um cadastro pela metade.
      if (resposta?.aviso) avisar(resposta.aviso, "erro");
      else avisar(rascunho.id ? "Projeto atualizado." : "Projeto cadastrado.", "ok");
      roteador.refresh();
    } catch (erro) {
      avisar(mensagemDoErro(erro, "salvar o projeto"), "erro");
    } finally {
      setOcupado(false);
    }
  }

  async function excluir(p: Projeto) {
    const usos = campos[p.id] ?? 0;
    const pergunta = usos
      ? `${p.cliente} | ${p.nome} está em ${usos} solicitação(ões). Excluir desfaz esse vínculo e apaga de quem era a aprovação — o melhor é pôr a situação em Cancelado ou Finalizado. Excluir mesmo assim?`
      : `Excluir ${p.cliente} | ${p.nome}?`;
    if (!window.confirm(pergunta)) return;

    try {
      await remover(`/api/projetos/${p.id}?confirmar=1`);
      avisar("Projeto excluído.", "ok");
      roteador.refresh();
    } catch (erro) {
      avisar(mensagemDoErro(erro, "excluir o projeto"), "erro");
    }
  }

  function trocarEscopo(indice: number, valor: string) {
    if (!rascunho) return;
    setRascunho({ ...rascunho, escopo: rascunho.escopo.map((p, i) => (i === indice ? valor : p)) });
  }

  function trocarGasto(indice: number, mudanca: Partial<LinhaDeGasto>) {
    if (!rascunho) return;
    setRascunho({
      ...rascunho,
      gastos: rascunho.gastos.map((g, i) => (i === indice ? { ...g, ...mudanca } : g)),
    });
  }

  return (
    <section className="secao active">
      <CabecalhoDeSecao
        titulo="Direção · projetos e líderes"
        direita="Quem lidera cada projeto é quem aprova o campo dele"
      />

      <div className="lista-wrapper">
        <div className="table-controls">
          <div className="filter-row">
            <select
              className="form-control filter-select"
              value={liderFiltro}
              onChange={(e) => filtrar(() => setLiderFiltro(e.target.value))}
              aria-label="Filtrar por líder"
            >
              <option value="">Todos os líderes</option>
              {lideresComProjeto.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            <select
              className="form-control filter-select"
              value={situacaoFiltro}
              onChange={(e) => filtrar(() => setSituacaoFiltro(e.target.value))}
              aria-label="Filtrar por situação"
            >
              <option value="">Todas as situações</option>
              {SITUACOES_PROJETO.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <input
              className="form-control search-input"
              placeholder="Buscar por cliente, projeto, líder ou escopo"
              value={busca}
              onChange={(e) => filtrar(() => setBusca(e.target.value))}
              aria-label="Buscar"
            />
            <div className="filter-row-actions">
              <BotaoExportarCsv
                arquivo="projetos-campo"
                cabecalho={CABECALHO_CSV}
                linhas={() =>
                  filtrados.map((p) =>
                    linhaCsv(
                      p,
                      gastosPorProjeto.get(p.id) ?? [],
                      campos[p.id] ?? 0,
                      aAprovar[p.id] ?? 0
                    )
                  )
                }
              />
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={() => setRascunho(rascunhoVazio())}
              >
                + Novo projeto
              </button>
            </div>
          </div>
          <div className="filter-resumo">
            {v2Ativa
              ? `${filtrados.length} projeto(s) · ${projetos.filter((p) => p.situacao === "Ativo").length} ativo(s) · ${projetos.filter((p) => p.situacao === "Stand By").length} em stand by`
              : "Rode supabase/02_campo_v2.sql, 04_direcao_e_aprovacao.sql e 05_ajustes_v3.sql para o cadastro de projetos funcionar."}
          </div>
        </div>

        <div className="table-wrapper">
          <div className="table-scroll">
            <table className="art-table tabela-centralizada">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Projeto</th>
                  <th>Líder</th>
                  <th>Escopo</th>
                  <th>Clockify</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th className="cel-num">Gasto previsto</th>
                  <th>Campos</th>
                  <th>A aprovar</th>
                  <th>Situação</th>
                  <th className="col-acoes">Ações</th>
                </tr>
              </thead>
              <tbody>
                {daPagina.map((p) => (
                  <tr key={p.id}>
                    <td>{p.cliente}</td>
                    <td>{p.nome}</td>
                    <td>
                      {p.lider ?? (
                        // Projeto sem líder trava campo para sempre: o
                        // pedido nasceria esperando decisão de ninguém.
                        <Selo texto="Sem líder" classe="st-ruim" />
                      )}
                    </td>
                    <td>{p.escopo || "—"}</td>
                    <td>{p.codigo_clockify || "—"}</td>
                    <td>{dataISOparaBR(p.data_inicio) || "—"}</td>
                    <td>{dataISOparaBR(p.data_fim) || "—"}</td>
                    {/* A composição ao LADO do total e não embaixo: como
                        segunda linha ela dobrava a altura de TODA linha da
                        tabela, para dizer um número que é contexto do valor
                        e não um valor à parte. */}
                    <td className="cel-num">
                      {formatarMoeda(totalPrevistoDo(p.id))} ({(gastosPorProjeto.get(p.id) ?? []).length}{" "}
                      categoria(s))
                    </td>
                    <td>{campos[p.id] ?? 0}</td>
                    <td>{aAprovar[p.id] ?? 0}</td>
                    <td>
                      <Selo texto={p.situacao} classe={classeDaSituacaoDoProjeto(p.situacao)} />
                    </td>
                    <td className="table-actions">
                      {/* O OLHO vem primeiro: a tabela mostra o resumo (o
                          escopo cortado, o gasto só somado), e há coisa
                          cadastrada que não cabe em coluna nenhuma — a
                          observação, o gasto categoria por categoria. Ver
                          não deve exigir abrir o formulário de edição, que
                          é onde se estraga o cadastro por acidente. */}
                      <button
                        className="btn-icon"
                        type="button"
                        title="Ver tudo que foi preenchido"
                        onClick={() => setDetalhe(p)}
                      >
                        <Icone nome="olho" />
                      </button>
                      <button
                        className="btn-icon"
                        type="button"
                        title="Editar"
                        onClick={() => setRascunho(rascunhoDe(p, gastosPorProjeto.get(p.id) ?? []))}
                      >
                        <Icone nome="editar" />
                      </button>
                      <button
                        className="btn-icon btn-icon-danger"
                        type="button"
                        title="Excluir"
                        onClick={() => void excluir(p)}
                      >
                        <Icone nome="lixeira" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TabelaVazia visivel={filtrados.length === 0}>
              <div className="empty-icon">
                <Icone nome="direcao" tamanho={40} />
              </div>
              <strong>Nenhum projeto cadastrado</strong>
              <p>Sem projeto ninguém abre solicitação de campo: é ele que diz quem aprova.</p>
            </TabelaVazia>
          </div>
        </div>

        {/* Irmã direta de `.table-wrapper`, e não dentro dele: é assim que
            o `:has(> .pagination-container)` do design system sabe emendar
            a borda de baixo da tabela com a barra de páginas. */}
        <Paginacao
          total={filtrados.length}
          pagina={paginaAtual}
          porPagina={porPagina}
          aoTrocarPagina={setPagina}
          aoTrocarPorPagina={(n) => {
            setPorPagina(n);
            setPagina(1);
          }}
        />
      </div>

      <Modal
        titulo={rascunho?.id ? "Editar projeto" : "Novo projeto"}
        aberto={rascunho !== null}
        aoFechar={() => setRascunho(null)}
        rodape={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setRascunho(null)} disabled={ocupado}>
              Cancelar
            </button>
            <button className="btn btn-primary" type="button" onClick={salvar} disabled={ocupado}>
              {ocupado ? "Salvando…" : "Salvar"}
            </button>
          </>
        }
      >
        {rascunho ? (
          <>
            <div className="form-section-block">
              <h4 className="form-subtitle">Identificação</h4>
              <div className="form-grid">
                <Grupo rotulo="Cliente" obrigatorio>
                  {(id) => (
                    <input
                      id={id}
                      className="form-control"
                      placeholder="Ex.: ENEL"
                      value={rascunho.cliente}
                      onChange={(e) => setRascunho({ ...rascunho, cliente: e.target.value })}
                    />
                  )}
                </Grupo>
                <Grupo rotulo="Projeto" obrigatorio>
                  {(id) => (
                    <input
                      id={id}
                      className="form-control"
                      placeholder="Ex.: SE Aquiraz"
                      value={rascunho.nome}
                      onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })}
                    />
                  )}
                </Grupo>

                {/* LISTA, e não texto livre: é este vínculo que dá ao líder
                    o poder de aprovar. Nome digitado não aprova nada.
                    E a lista vem do ORGANOGRAMA: todo colaborador ativo com
                    acesso ao sistema é candidato. Antes eram os acessos de
                    `perfis`, sem filtro nenhum. */}
                <Grupo
                  rotulo="Líder do projeto"
                  obrigatorio
                  dica={
                    lideresDisponiveis.length === 0 ? (
                      <span className="form-hint-alerta">
                        Nenhum colaborador disponível. Cadastre a pessoa na aba Organograma — e
                        lembre que liderar é aprovar campo, então ela precisa de acesso ao sistema
                        para entrar nesta lista.
                      </span>
                    ) : (
                      `${lideresDisponiveis.length} colaborador(es) do organograma nesta lista.`
                    )
                  }
                >
                  {(id) => (
                    <select
                      id={id}
                      className="form-control"
                      value={rascunho.liderId}
                      onChange={(e) => setRascunho({ ...rascunho, liderId: e.target.value })}
                    >
                      <option value="">Selecione quem aprova este projeto</option>
                      {opcoesDeLider.map((l) => (
                        <option key={l.perfil_id} value={l.perfil_id}>
                          {l.cargo ? `${l.nome} · ${l.cargo}` : l.nome}
                        </option>
                      ))}
                    </select>
                  )}
                </Grupo>

                <Grupo
                  rotulo="Código Clockify"
                  dica={
                    clockify === null
                      ? "Buscando os projetos no Clockify…"
                      : clockify.erro
                        ? <span className="form-hint-alerta">{clockify.erro}</span>
                        : `${clockify.projetos.length} projeto(s) do Clockify na lista.`
                  }
                >
                  {(id) => (
                    <>
                      <input
                        id={id}
                        className="form-control"
                        list="lista-clockify-projeto"
                        placeholder="Ex.: 0189-3-2025 — escolha na lista do Clockify"
                        value={rascunho.clockify}
                        onChange={(e) => setRascunho({ ...rascunho, clockify: e.target.value })}
                      />
                      <datalist id="lista-clockify-projeto">
                        {(clockify?.projetos ?? []).map((p) => (
                          <option key={p.id} value={p.codigo}>
                            {p.cliente && p.cliente !== p.nome ? `${p.nome} · ${p.cliente}` : p.nome}
                          </option>
                        ))}
                      </datalist>
                    </>
                  )}
                </Grupo>

                {/* ── O PRAZO ── Opcionais: projeto entra no sistema antes
                    de o contrato ter data, e travar o cadastro por causa
                    disso deixaria o projeto sem líder — que é o que
                    realmente impede o campo de andar. */}
                <Grupo rotulo="Início do projeto">
                  {(id) => (
                    <CampoMascarado
                      id={id}
                      mascara="data"
                      valor={rascunho.inicio}
                      aoMudar={(v) => setRascunho({ ...rascunho, inicio: v })}
                    />
                  )}
                </Grupo>
                <Grupo rotulo="Fim do projeto">
                  {(id) => (
                    <CampoMascarado
                      id={id}
                      mascara="data"
                      valor={rascunho.fim}
                      aoMudar={(v) => setRascunho({ ...rascunho, fim: v })}
                    />
                  )}
                </Grupo>

                <Grupo
                  rotulo="Situação"
                  dica="Só Ativo aceita solicitação nova. Campo já aberto segue até o fim."
                >
                  {(id) => (
                    <select
                      id={id}
                      className="form-control"
                      value={rascunho.situacao}
                      onChange={(e) =>
                        setRascunho({ ...rascunho, situacao: e.target.value as SituacaoProjeto })
                      }
                    >
                      {SITUACOES_PROJETO.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  )}
                </Grupo>

                <div className="form-group full-width">
                  <label className="form-label required">Escopo</label>
                  <div className="sol-itens">
                    {rascunho.escopo.map((item, indice) => (
                      <div className="sol-linha sol-linha-programa" key={indice}>
                        <input
                          className="form-control"
                          placeholder="Ex.: Fauna, Flora, Qualidade do Ar…"
                          value={item}
                          aria-label={`Item de escopo ${indice + 1}`}
                          onChange={(e) => trocarEscopo(indice, e.target.value)}
                          onKeyDown={(e) => {
                            // Enter fecha o item e já abre a linha
                            // seguinte — é assim que a Direção digita, um
                            // atrás do outro.
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            setRascunho({ ...rascunho, escopo: [...rascunho.escopo, ""] });
                          }}
                        />
                        <button
                          className="btn-icon btn-icon-danger"
                          type="button"
                          title="Remover"
                          onClick={() =>
                            setRascunho({
                              ...rascunho,
                              escopo: rascunho.escopo.filter((_, i) => i !== indice),
                            })
                          }
                        >
                          <Icone nome="lixeira" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    style={{ marginTop: ".5rem" }}
                    onClick={() => setRascunho({ ...rascunho, escopo: [...rascunho.escopo, ""] })}
                  >
                    + Adicionar item de escopo
                  </button>
                </div>
              </div>
              <p className="modal-hint">
                O líder escolhido aqui é quem <strong>aprova</strong> toda solicitação de campo deste projeto —
                a não ser que ele mesmo tenha solicitado.
              </p>
            </div>

            {/* ══ GASTOS PREVISTOS ══
                Lista aberta, e não três campos fixos: cada contrato tem
                gasto que os outros não têm. A categoria é sugerida por
                datalist (para "Aluguel de veículo" não virar cinco
                grafias e o total por categoria não somar), mas aceita
                texto livre — lista fechada aqui impediria de cadastrar o
                gasto que apareceu neste contrato. */}
            <div className="form-section-block">
              <h4 className="form-subtitle">Gastos previstos</h4>
              <div className="sol-itens">
                {rascunho.gastos.map((linha, indice) => (
                  <div className="sol-linha sol-linha-gasto" key={linha.chave}>
                    <input
                      className="form-control"
                      list="lista-categorias-gasto"
                      placeholder="Categoria — ex.: Aluguel de veículo"
                      aria-label={`Categoria do gasto ${indice + 1}`}
                      value={linha.categoria}
                      onChange={(e) => trocarGasto(indice, { categoria: e.target.value })}
                    />
                    <CampoMascarado
                      mascara="moeda"
                      valor={linha.valor}
                      aoMudar={(v) => trocarGasto(indice, { valor: v })}
                    />
                    <input
                      className="form-control"
                      placeholder="Observação (opcional)"
                      aria-label={`Observação do gasto ${indice + 1}`}
                      value={linha.observacao}
                      onChange={(e) => trocarGasto(indice, { observacao: e.target.value })}
                    />
                    <button
                      className="btn-icon btn-icon-danger"
                      type="button"
                      title="Remover gasto"
                      onClick={() =>
                        setRascunho({
                          ...rascunho,
                          gastos: rascunho.gastos.filter((_, i) => i !== indice),
                        })
                      }
                    >
                      <Icone nome="lixeira" />
                    </button>
                  </div>
                ))}
              </div>
              <datalist id="lista-categorias-gasto">
                {CATEGORIAS_DE_GASTO.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>

              <div className="form-preview-row" style={{ marginTop: ".5rem" }}>
                <div className="form-preview-item">
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() =>
                      setRascunho({ ...rascunho, gastos: [...rascunho.gastos, linhaDeGastoVazia()] })
                    }
                  >
                    + Adicionar gasto
                  </button>
                </div>
                <div className="form-preview-item">
                  <span>Total previsto do projeto</span>
                  <strong>{formatarMoeda(totalDosGastosDoRascunho)}</strong>
                </div>
              </div>

              <p className="modal-hint">
                O valor é o <strong>total previsto para o projeto</strong>, não o valor por dia. Ele é a
                referência do gasto do projeto no Painel — e o previsto de cada solicitação continua sendo
                informado no formulário do campo.
              </p>

              <div className="form-group" style={{ marginTop: ".6rem" }}>
                <label className="form-label" htmlFor="projeto-obs">
                  Observação
                </label>
                <textarea
                  id="projeto-obs"
                  className="form-control"
                  rows={2}
                  value={rascunho.observacao}
                  onChange={(e) => setRascunho({ ...rascunho, observacao: e.target.value })}
                />
              </div>
            </div>
          </>
        ) : null}
      </Modal>

      {/* ══ O OLHO: TUDO QUE FOI PREENCHIDO, SÓ LEITURA ══
          Modal separado do de edição, e não o mesmo com os campos
          desabilitados: formulário desabilitado ainda tem rodapé de
          "Salvar", ainda captura Tab e ainda parece que vai gravar algo.
          Aqui o único botão é Fechar. */}
      <Modal
        titulo={detalhe ? `${detalhe.cliente} | ${detalhe.nome}` : ""}
        aberto={detalhe !== null}
        aoFechar={() => setDetalhe(null)}
        rodape={
          <>
            {/* Atalho para quem abriu para ver e decidiu corrigir: evita
                fechar, procurar a linha de novo e clicar no lápis. */}
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                if (!detalhe) return;
                const p = detalhe;
                setDetalhe(null);
                setRascunho(rascunhoDe(p, gastosPorProjeto.get(p.id) ?? []));
              }}
            >
              Editar
            </button>
            <button className="btn btn-primary" type="button" onClick={() => setDetalhe(null)}>
              Fechar
            </button>
          </>
        }
      >
        {detalhe ? (
          <>
            <Grade>
              <Info rotulo="Cliente">{detalhe.cliente}</Info>
              <Info rotulo="Projeto">{detalhe.nome}</Info>
              <Info rotulo="Líder">
                {detalhe.lider ?? <Selo texto="Sem líder" classe="st-ruim" />}
              </Info>
              <Info rotulo="Situação">
                <Selo texto={detalhe.situacao} classe={classeDaSituacaoDoProjeto(detalhe.situacao)} />
              </Info>
              <Info rotulo="Início do projeto">{dataISOparaBR(detalhe.data_inicio) || "—"}</Info>
              <Info rotulo="Fim do projeto">{dataISOparaBR(detalhe.data_fim) || "—"}</Info>
              <Info rotulo="Código Clockify">{detalhe.codigo_clockify || "—"}</Info>
              <Info rotulo="Campos abertos">{campos[detalhe.id] ?? 0}</Info>
              <Info rotulo="Esperando aprovação">{aAprovar[detalhe.id] ?? 0}</Info>
              <Info rotulo="Escopo" largo>
                {detalhe.escopo || "—"}
              </Info>
              {detalhe.observacao ? (
                <Info rotulo="Observação" largo>
                  {detalhe.observacao}
                </Info>
              ) : null}
            </Grade>

            {/* O gasto previsto é a razão principal de existir este olho: na
                tabela ele aparece somado, e é aqui que se vê DE QUÊ. */}
            <Bloco titulo="Gastos previstos">
              {(gastosPorProjeto.get(detalhe.id) ?? []).length ? (
                <TabelaDeLeitura colunas={["Categoria", "Valor previsto", "Observação"]}>
                  {(gastosPorProjeto.get(detalhe.id) ?? []).map((g) => (
                    <tr key={g.id}>
                      <td>{g.categoria}</td>
                      <td>{formatarMoeda(g.valor)}</td>
                      <td>{g.observacao || "—"}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <strong>Total</strong>
                    </td>
                    <td>
                      <strong>{formatarMoeda(totalPrevistoDo(detalhe.id))}</strong>
                    </td>
                    <td>—</td>
                  </tr>
                </TabelaDeLeitura>
              ) : (
                <p className="modal-hint">
                  Nenhum gasto previsto cadastrado. Sem ele, o Painel mostra este projeto como
                  &quot;Sem previsto&quot; — não há com o que comparar o gasto real.
                </p>
              )}
            </Bloco>
          </>
        ) : null}
      </Modal>
    </section>
  );
}

const CABECALHO_CSV = [
  "Cliente", "Projeto", "Líder", "Escopo", "Clockify", "Início", "Fim",
  "Gasto previsto (total)", "Gastos por categoria", "Campos", "A aprovar", "Situação", "Observação",
] as const;

function linhaCsv(
  p: Projeto,
  gastos: readonly ProjetoGastoPrevisto[],
  campos: number,
  aAprovar: number
): unknown[] {
  const total = gastos.reduce((t, g) => t + (Number(g.valor) || 0), 0);
  return [
    p.cliente,
    p.nome,
    p.lider ?? "",
    p.escopo ?? "",
    p.codigo_clockify ?? "",
    dataISOparaBR(p.data_inicio),
    dataISOparaBR(p.data_fim),
    csvNumero(total),
    // As categorias numa célula só: quem exporta quer o total por projeto
    // e a composição ao lado, não um arquivo por tabela.
    gastos.map((g) => `${g.categoria}: ${formatarNumeroBR(g.valor)}`).join(" | "),
    campos,
    aAprovar,
    p.situacao,
    p.observacao ?? "",
  ];
}
