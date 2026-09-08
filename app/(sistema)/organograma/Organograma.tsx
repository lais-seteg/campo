"use client";

// Organograma — o cadastro de colaboradores da empresa.
//
// Pessoa entra aqui com ou sem login. ESTAR CADASTRADO BASTA para ser
// candidato a líder no cadastro de projetos — não há autorização por pessoa
// a conceder. O que ainda separa um caso do outro é o ACESSO ao sistema
// (`perfil_id`): liderar é aprovar campo, e a aprovação confere quem está
// logado, então quem não entra no sistema não aparece no seletor de líder.
// A tela diz isso a quem está sem acesso, senão a pessoa procuraria o
// próprio nome lá sem entender a ausência.
//
// EXCLUIR quem lidera projeto não desfaz a aprovação dos campos em curso
// (a RLS lê `projetos.lider_id`), mas tira a pessoa da lista de líderes, e
// aí o projeto dela não pode mais ser salvo sem trocar de líder. O caminho
// certo para quem saiu da empresa é marcar como INATIVO.

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Modal } from "@/app/components/Modal";
import { ModalDeConfirmacao } from "@/app/components/Confirmacao";
import { useAvisos } from "@/app/components/Avisos";
import { Grupo } from "@/app/components/Campos";
import { Grade, Info } from "@/app/components/Detalhe";
import {
  BotaoExportarCsv,
  CabecalhoDeSecao,
  Paginacao,
  Selo,
  TabelaVazia,
} from "@/app/components/Tabela";
import { Icone } from "@/app/components/Icone";
import { ErroDaApi, mensagemDoErro, patch, post, remover } from "@/app/components/api";
import { CARGOS, VINCULOS, type Colaborador, type Vinculo } from "@/lib/tipos";

/**
 * O rascunho do formulário.
 *
 * Ele carrega MAIS campos do que a tela edita — matrícula, setor, vínculo,
 * contato, o acesso do sistema e a observação não têm mais campo aqui, mas
 * continuam no rascunho. Não é sobra: o PATCH deste sistema manda o
 * registro COMPLETO (como o de hotel e o de projeto), então campo ausente
 * do corpo é campo gravado vazio. Sem carregá-los, salvar o cargo de
 * alguém apagaria o acesso dele — e sem acesso a pessoa sai do seletor de
 * líder do cadastro de projetos, porque é o acesso que a sustenta lá.
 */
interface Rascunho {
  id: string | null;
  nome: string;
  cargo: string;
  ativo: boolean;
  // ── Carregados, não editados aqui ──
  codigo: string;
  setor: string;
  vinculo: Vinculo;
  telefone: string;
  email: string;
  perfilId: string;
  observacao: string;
}

function rascunhoVazio(): Rascunho {
  return {
    id: null,
    nome: "",
    codigo: "",
    cargo: "",
    setor: "",
    vinculo: "Seteg",
    telefone: "",
    email: "",
    perfilId: "",
    ativo: true,
    observacao: "",
  };
}

function rascunhoDe(c: Colaborador): Rascunho {
  return {
    id: c.id,
    nome: c.nome,
    codigo: c.codigo ?? "",
    cargo: c.cargo ?? "",
    setor: c.setor ?? "",
    vinculo: c.vinculo,
    telefone: c.telefone ?? "",
    email: c.email ?? "",
    perfilId: c.perfil_id ?? "",
    ativo: c.ativo,
    observacao: c.observacao ?? "",
  };
}

interface Props {
  colaboradores: Colaborador[];
  /** Quantos projetos cada `perfil_id` lidera. */
  projetosPorLider: Record<string, number>;
  /** `false` enquanto supabase/08_organograma.sql não foi rodado. */
  tabelaExiste: boolean;
}

export function Organograma({ colaboradores, projetosPorLider, tabelaExiste }: Props) {
  const roteador = useRouter();
  const { avisar } = useAvisos();

  const [setorFiltro, setSetorFiltro] = useState("");
  const [vinculoFiltro, setVinculoFiltro] = useState("");
  const [situacaoFiltro, setSituacaoFiltro] = useState("ativos");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(20);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  /** O colaborador aberto SÓ PARA LEITURA (o olho). Separado de `rascunho`
   *  de propósito: ver não é editar, e um estado só faria o "Salvar"
   *  aparecer numa tela que ninguém pediu para mudar — é o mesmo desenho da
   *  aba Projetos. É também onde os campos que saíram do formulário
   *  continuam visíveis: matrícula, setor, vínculo, contato e acesso. */
  const [detalhe, setDetalhe] = useState<Colaborador | null>(null);
  /** Quem está na fila da caixa de "tem certeza?". `null` = caixa fechada. */
  const [aExcluir, setAExcluir] = useState<Colaborador | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const setores = useMemo(
    () =>
      Array.from(new Set(colaboradores.map((c) => c.setor).filter((s): s is string => !!s))).sort(
        (a, b) => a.localeCompare(b, "pt-BR")
      ),
    [colaboradores]
  );

  const filtrados = useMemo(() => {
    const texto = busca.trim().toLowerCase();
    return colaboradores.filter((c) => {
      if (setorFiltro && c.setor !== setorFiltro) return false;
      if (vinculoFiltro && c.vinculo !== vinculoFiltro) return false;
      if (situacaoFiltro === "ativos" && !c.ativo) return false;
      if (situacaoFiltro === "inativos" && c.ativo) return false;
      if (!texto) return true;
      return `${c.nome} ${c.codigo ?? ""} ${c.cargo ?? ""} ${c.setor ?? ""}`
        .toLowerCase()
        .includes(texto);
    });
  }, [colaboradores, setorFiltro, vinculoFiltro, situacaoFiltro, busca]);

  // ── PAGINAÇÃO ──
  //
  // Trinta e dois colaboradores já são mais tabela do que cabe numa tela, e
  // o organograma só cresce. Mesmo desenho da lista de projetos e da de
  // solicitações: a página pedida pode não existir mais depois de um filtro
  // que encurtou a lista, e isso é corrigido NA LEITURA — não num efeito
  // que chama `setState`, que custaria uma renderização a mais e o
  // pisca-pisca que vem com ela.
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / porPagina));
  const paginaAtual = Math.min(Math.max(1, pagina), totalPaginas);
  const inicio = (paginaAtual - 1) * porPagina;
  const daPagina = filtrados.slice(inicio, inicio + porPagina);

  /** Todo filtro volta para a primeira página: continuar na página 3 de uma
   *  lista que agora tem uma mostraria a tabela vazia sem explicar por quê. */
  function filtrar(aplicar: () => void) {
    aplicar();
    setPagina(1);
  }

  /**
   * As opções do seletor de cargo: a lista fechada, MAIS o cargo que esta
   * pessoa já tem quando ele é de fora dela.
   *
   * O organograma nasceu com os cargos que vinham de `perfis`
   * ("Colaborador", "Assistente de Compras", "Financeiro"…), e nenhum está
   * em `CARGOS`. Sem esse acréscimo, abrir o cadastro de uma dessas pessoas
   * mostraria "Sem cargo definido", e salvar a situação dela apagaria o
   * cargo — uma troca que ninguém pediu, do mesmo tipo que o seletor de
   * líder do cadastro de projetos evita.
   */
  const opcoesDeCargo = useMemo(() => {
    const atual = rascunho?.cargo;
    if (!atual || (CARGOS as readonly string[]).includes(atual)) return CARGOS;
    return [...CARGOS, atual];
  }, [rascunho?.cargo]);

  async function salvar() {
    if (!rascunho) return;
    if (!rascunho.nome.trim()) {
      avisar("Informe o nome do colaborador.", "erro");
      return;
    }
    const corpo = {
      nome: rascunho.nome,
      codigo: rascunho.codigo || null,
      cargo: rascunho.cargo || null,
      setor: rascunho.setor || null,
      vinculo: rascunho.vinculo,
      telefone: rascunho.telefone || null,
      email: rascunho.email || null,
      perfil_id: rascunho.perfilId || null,
      ativo: rascunho.ativo,
      observacao: rascunho.observacao || null,
    };

    setOcupado(true);
    try {
      if (rascunho.id) await patch(`/api/colaboradores/${rascunho.id}`, corpo);
      else await post("/api/colaboradores", corpo);
      setRascunho(null);
      avisar(rascunho.id ? "Colaborador atualizado." : "Colaborador cadastrado.", "ok");
      roteador.refresh();
    } catch (erro) {
      // 409 com `precisaConfirmar`: a pessoa lidera projeto e está saindo
      // da lista de líderes. A rota manda o número; aqui se pergunta.
      if (erro instanceof ErroDaApi && erro.status === 409 && erro.corpo.precisaConfirmar) {
        if (window.confirm(`${erro.message}\n\nSalvar mesmo assim?`)) {
          try {
            await patch(`/api/colaboradores/${rascunho.id}?confirmar=1`, corpo);
            setRascunho(null);
            avisar("Colaborador atualizado.", "ok");
            roteador.refresh();
            return;
          } catch (segundo) {
            avisar(mensagemDoErro(segundo, "salvar o colaborador"), "erro");
            return;
          } finally {
            setOcupado(false);
          }
        }
        setOcupado(false);
        return;
      }
      avisar(mensagemDoErro(erro, "salvar o colaborador"), "erro");
    } finally {
      setOcupado(false);
    }
  }

  /**
   * A exclusão já confirmada na caixa. Ela não pergunta nada — quem
   * pergunta é o `ModalDeConfirmacao`, e é ele que só chama isto depois do
   * "Excluir". Separar as duas coisas é o que faz o `?confirmar=1` abaixo
   * ser honesto: a pessoa viu o número de projetos e disse sim.
   */
  async function excluirConfirmado() {
    if (!aExcluir) return;
    setOcupado(true);
    try {
      await remover(`/api/colaboradores/${aExcluir.id}?confirmar=1`);
      setAExcluir(null);
      avisar("Colaborador excluído.", "ok");
      roteador.refresh();
    } catch (erro) {
      avisar(mensagemDoErro(erro, "excluir o colaborador"), "erro");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="secao active">
      <CabecalhoDeSecao
        titulo="Organograma · colaboradores"
        direita="É daqui que sai quem pode liderar projeto"
      />

      <div className="lista-wrapper">
        <div className="table-controls">
          <div className="filter-row">
            <select
              className="form-control filter-select"
              value={setorFiltro}
              onChange={(e) => filtrar(() => setSetorFiltro(e.target.value))}
              aria-label="Filtrar por setor"
            >
              <option value="">Todos os setores</option>
              {setores.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select
              className="form-control filter-select"
              value={vinculoFiltro}
              onChange={(e) => filtrar(() => setVinculoFiltro(e.target.value))}
              aria-label="Filtrar por vínculo"
            >
              <option value="">Todos os vínculos</option>
              {VINCULOS.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <select
              className="form-control filter-select"
              value={situacaoFiltro}
              onChange={(e) => filtrar(() => setSituacaoFiltro(e.target.value))}
              aria-label="Filtrar por situação"
            >
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
              <option value="">Ativos e inativos</option>
            </select>
            <input
              className="form-control search-input"
              placeholder="Buscar por nome, matrícula, cargo ou setor"
              value={busca}
              onChange={(e) => filtrar(() => setBusca(e.target.value))}
              aria-label="Buscar"
            />
            <div className="filter-row-actions">
              <BotaoExportarCsv
                arquivo="organograma"
                cabecalho={CABECALHO_CSV}
                linhas={() => filtrados.map((c) => linhaCsv(c, projetosPorLider))}
              />
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={() => setRascunho(rascunhoVazio())}
                disabled={!tabelaExiste}
              >
                + Novo colaborador
              </button>
            </div>
          </div>
          {/* Sem linha de resumo sob os filtros: a contagem de registros já
              está na barra de páginas, e o aviso de estrutura pendente já
              está no estado vazio da tabela. A tabela começa aqui. */}
        </div>

        <div className="table-wrapper">
          <div className="table-scroll">
            <table className="art-table tabela-centralizada">
              {/* QUATRO COLUNAS, e o resto do cadastro no formulário.
                  Matrícula, setor, vínculo, acesso e situação continuam
                  cadastrados (e vão inteiros no CSV) — só não disputam a
                  largura da tabela: o que se lê de bate-pronto num
                  organograma é quem é a pessoa, o que ela faz e se ela
                  aprova campo. */}
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Cargo</th>
                  <th>Lidera projeto</th>
                  <th className="col-acoes">Ações</th>
                </tr>
              </thead>
              <tbody>
                {daPagina.map((c) => {
                  const lidera = c.perfil_id ? (projetosPorLider[c.perfil_id] ?? 0) : 0;
                  return (
                    <tr key={c.id}>
                      <td>{c.nome}</td>
                      <td>{c.cargo || "—"}</td>
                      {/* Quantos projetos esta pessoa lidera DE FATO. Não é
                          mais uma autorização a conceder: quem está no
                          organograma, ativo e com acesso já é candidato a
                          líder no cadastro de projetos. Então a coluna
                          responde "lidera?" com o que os projetos dizem, e
                          não com uma marca que alguém teria de manter. */}
                      <td>
                        {lidera > 0 ? (
                          <Selo texto={`Sim · ${lidera}`} classe="st-ok" />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="table-actions">
                        <button
                          className="btn-icon"
                          type="button"
                          title="Visualizar"
                          onClick={() => setDetalhe(c)}
                        >
                          <Icone nome="olho" />
                        </button>
                        <button
                          className="btn-icon"
                          type="button"
                          title="Editar"
                          onClick={() => setRascunho(rascunhoDe(c))}
                        >
                          <Icone nome="editar" />
                        </button>
                        <button
                          className="btn-icon btn-icon-danger"
                          type="button"
                          title="Excluir"
                          onClick={() => setAExcluir(c)}
                        >
                          <Icone nome="lixeira" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <TabelaVazia visivel={filtrados.length === 0}>
              <strong>Nenhum colaborador nesse filtro</strong>
              <p>
                {tabelaExiste
                  ? "O organograma é o cadastro de quem trabalha na empresa — e é dele que sai quem pode liderar projeto."
                  : "Rode supabase/08_organograma.sql para o organograma funcionar."}
              </p>
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
        titulo={rascunho?.id ? "Editar colaborador" : "Novo colaborador"}
        aberto={rascunho !== null}
        aoFechar={() => setRascunho(null)}
        rodape={
          <>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setRascunho(null)}
              disabled={ocupado}
            >
              Cancelar
            </button>
            <button className="btn btn-primary" type="button" onClick={salvar} disabled={ocupado}>
              {ocupado ? "Salvando…" : "Salvar"}
            </button>
          </>
        }
      >
        {/* AS MESMAS TRÊS INFORMAÇÕES DA TABELA, e mais a situação.
            Matrícula, setor, vínculo, contato e o vínculo com o acesso do
            sistema continuam EXISTINDO na linha (e vão inteiros no CSV) —
            só não se editam aqui. Eles viajam intactos no rascunho: o PATCH
            deste sistema manda o registro completo, como o de hotel e o de
            projeto, então um campo ausente do corpo seria gravado como
            vazio. Carregá-los é o que impede que salvar o cargo de alguém
            apague o acesso dele — e apagar o acesso derrubaria a liderança
            junto, porque é ele que a sustenta. */}
        {rascunho ? (
          <div className="form-section-block">
            <div className="form-grid">
              <Grupo rotulo="Nome" obrigatorio largo>
                {(id) => (
                  <input
                    id={id}
                    className="form-control"
                    placeholder="Nome completo"
                    value={rascunho.nome}
                    onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })}
                  />
                )}
              </Grupo>
              {/* LISTA FECHADA: em texto livre, "Analista Ambiental II" e
                  "analista ambiental 2" seriam dois cargos, e o filtro por
                  cargo deixaria de somar. O cargo NÃO decide liderança —
                  quem está no organograma já é candidato a líder. */}
              <Grupo rotulo="Cargo" dica="Qualquer cargo pode liderar projeto.">
                {(id) => (
                  <select
                    id={id}
                    className="form-control"
                    value={rascunho.cargo}
                    onChange={(e) => setRascunho({ ...rascunho, cargo: e.target.value })}
                  >
                    <option value="">Sem cargo definido</option>
                    {opcoesDeCargo.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                )}
              </Grupo>
              <Grupo rotulo="Situação">
                {(id) => (
                  <select
                    id={id}
                    className="form-control"
                    value={rascunho.ativo ? "1" : "0"}
                    onChange={(e) => setRascunho({ ...rascunho, ativo: e.target.value === "1" })}
                  >
                    <option value="1">Ativo</option>
                    <option value="0">Inativo</option>
                  </select>
                )}
              </Grupo>
            </div>

            {/* NÃO HÁ MAIS CAIXA DE "AUTORIZADO A LIDERAR": quem está no
                organograma, ativo e com acesso ao sistema já aparece no
                seletor de líder do cadastro de projetos. O que ainda separa
                um caso do outro é o ACESSO — liderar é aprovar campo, e a
                aprovação confere quem está logado. Quem não tem, a tela
                diz, porque senão a pessoa procuraria o próprio nome no
                cadastro de projetos sem entender a ausência. */}
            {rascunho.id && !rascunho.perfilId ? (
              <p className="form-hint-alerta" style={{ marginTop: ".6rem" }}>
                Sem acesso ao sistema, este colaborador não pode ser líder de projeto: a aprovação
                do campo confere quem está logado. Crie o acesso dele
                (supabase/03_funcao_acesso.sql) para ele aparecer no seletor de líder.
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* ══ O OLHO: O MESMO QUE A TABELA E O CADASTRO MOSTRAM ══
          Nome, cargo, situação e a liderança — nada além. Matrícula, setor,
          vínculo, contato e observação continuam GRAVADOS na linha e saem
          no CSV, mas não se leem aqui: este diálogo é o cadastro em modo de
          leitura, não um relatório da pessoa. Ver não é editar, e por isso
          não há "Salvar". */}
      <Modal
        titulo={detalhe ? detalhe.nome : "Colaborador"}
        aberto={detalhe !== null}
        aoFechar={() => setDetalhe(null)}
        tamanho="sm"
        rodape={
          <button className="btn btn-ghost" type="button" onClick={() => setDetalhe(null)}>
            Fechar
          </button>
        }
      >
        {detalhe ? (
          <Grade>
            <Info rotulo="Nome" largo>
              {detalhe.nome}
            </Info>
            <Info rotulo="Cargo">{detalhe.cargo || "—"}</Info>
            <Info rotulo="Situação">
              <Selo
                texto={detalhe.ativo ? "Ativo" : "Inativo"}
                classe={detalhe.ativo ? "st-ok" : "st-neutro"}
              />
            </Info>
            {/* A MESMA leitura da coluna da tabela, e não uma segunda
                maneira de dizer a mesma coisa. */}
            <Info rotulo="Lidera projeto" largo>
              {lideraProjetos(detalhe, projetosPorLider) > 0 ? (
                <Selo
                  texto={`Sim · ${lideraProjetos(detalhe, projetosPorLider)}`}
                  classe="st-ok"
                />
              ) : (
                "—"
              )}
            </Info>
          </Grade>
        ) : null}
      </Modal>

      {/* A caixa de "tem certeza?" — a do sistema, não a do navegador. */}
      <ModalDeConfirmacao
        aberto={aExcluir !== null}
        pergunta={
          aExcluir ? (
            <>
              Tem certeza que deseja excluir <strong>{aExcluir.nome}</strong> do organograma?
            </>
          ) : null
        }
        aviso={
          aExcluir && lideraProjetos(aExcluir, projetosPorLider) > 0 ? (
            <>
              {aExcluir.nome} lidera {lideraProjetos(aExcluir, projetosPorLider)} projeto(s). A
              aprovação desses campos continua funcionando, mas ela sai da lista de líderes e esses
              projetos não poderão mais ser salvos sem trocar de líder — o melhor é marcar como
              inativa.
            </>
          ) : null
        }
        ocupado={ocupado}
        aoConfirmar={() => void excluirConfirmado()}
        aoCancelar={() => setAExcluir(null)}
      />
    </section>
  );
}

/** Quantos projetos esta pessoa lidera. Só faz sentido perguntar de quem
 *  tem acesso: sem `perfil_id` ela nunca foi líder de nada. */
function lideraProjetos(c: Colaborador, projetosPorLider: Record<string, number>): number {
  return c.perfil_id ? (projetosPorLider[c.perfil_id] ?? 0) : 0;
}

const CABECALHO_CSV = [
  "Nome", "Matrícula", "Cargo", "Setor", "Vínculo", "Telefone", "E-mail",
  "Acesso ao sistema", "Projetos que lidera", "Situação", "Observação",
] as const;

function linhaCsv(c: Colaborador, projetosPorLider: Record<string, number>): unknown[] {
  return [
    c.nome,
    c.codigo ?? "",
    c.cargo ?? "",
    c.setor ?? "",
    c.vinculo,
    c.telefone ?? "",
    c.email ?? "",
    c.perfil_id ? "Sim" : "Não",
    c.perfil_id ? (projetosPorLider[c.perfil_id] ?? 0) : 0,
    c.ativo ? "Ativo" : "Inativo",
    c.observacao ?? "",
  ];
}
