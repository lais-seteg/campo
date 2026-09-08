"use client";

// ═══════════════════════════════════════════════════════════════════════
//  CALENDÁRIO DE CAMPO
//
//  Um campo não é um ponto no tempo, é um INTERVALO: aparece em todos os
//  dias entre o início e o fim. A pergunta que a coordenação faz é "quem
//  está fora na quinta?", e não "quem pediu na quinta?".
//
//  Calendário à esquerda com um pontinho POR STATUS presente no dia (não
//  por evento: cinco pedidos em campo no mesmo dia viram um ponto, não
//  cinco); lista à direita com projeto, período, destino e equipe. Sem dia
//  escolhido, a lista é do mês inteiro; clicar de novo no mesmo dia volta
//  para o mês.
//
//  O CSV sai como UMA LINHA POR PESSOA POR CAMPO — é assim que se confere
//  escala, não contando pedidos.
// ═══════════════════════════════════════════════════════════════════════

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { BotaoExportarCsv, CabecalhoDeSecao } from "@/app/components/Tabela";
import { dataISOparaBR } from "@/lib/formato";
import { periodoTexto } from "@/lib/consultas";
import type { Projeto, SolicitacaoDeLista, StatusSolicitacao } from "@/lib/tipos";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
] as const;

/**
 * Data LOCAL, e não `new Date("2026-08-25")`: a segunda é interpretada
 * como UTC e volta um dia atrás em fuso negativo — o campo apareceria no
 * dia errado no calendário.
 */
function comoDiaLocal(v: string | null): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function mesmoDia(a: Date | null, b: Date | null): boolean {
  return (
    !!a &&
    !!b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function classeDoPonto(status: StatusSolicitacao): string {
  switch (status) {
    case "Aprovada":
      return "aprovada";
    case "Logística confirmada":
      return "logistica";
    case "Em campo":
      return "campo";
    case "Finalizada":
      return "finalizada";
    default:
      return "aguardando";
  }
}

interface Props {
  solicitacoes: SolicitacaoDeLista[];
  projetos: Projeto[];
  v2Ativa: boolean;
}

export function CalendarioDeCampo({ solicitacoes, projetos, v2Ativa }: Props) {
  const roteador = useRouter();
  const hoje = useMemo(() => new Date(), []);

  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth());
  const [dia, setDia] = useState<Date | null>(null);
  const [projetoFiltro, setProjetoFiltro] = useState("");
  const [pessoaFiltro, setPessoaFiltro] = useState("");

  /** Campo cancelado ou recusado pelo líder NÃO está no calendário:
   *  ninguém vai a ele. */
  const agendaveis = useMemo(
    () =>
      solicitacoes.filter((s) => {
        if (s.status === "Cancelada" || s.status === "Recusada") return false;
        if (!s.periodo_inicio || !s.periodo_fim) return false;
        if (projetoFiltro && (s.projeto_id ?? "") !== projetoFiltro) return false;
        if (pessoaFiltro && !s.equipe.some((e) => e.colaborador === pessoaFiltro)) return false;
        return true;
      }),
    [solicitacoes, projetoFiltro, pessoaFiltro]
  );

  const camposNoDia = (data: Date): SolicitacaoDeLista[] =>
    agendaveis.filter((s) => {
      const inicio = comoDiaLocal(s.periodo_inicio);
      const fim = comoDiaLocal(s.periodo_fim);
      return !!inicio && !!fim && data >= inicio && data <= fim;
    });

  // Sobreposição com o mês: campo que começa em julho e termina em agosto
  // aparece nos dois.
  const camposNoMes = useMemo(() => {
    const primeiro = new Date(ano, mes, 1);
    const ultimo = new Date(ano, mes + 1, 0);
    return agendaveis.filter((s) => {
      const inicio = comoDiaLocal(s.periodo_inicio);
      const fim = comoDiaLocal(s.periodo_fim);
      return !!inicio && !!fim && fim >= primeiro && inicio <= ultimo;
    });
  }, [agendaveis, ano, mes]);

  const pessoas = useMemo(
    () =>
      Array.from(new Set(solicitacoes.flatMap((s) => s.equipe.map((e) => e.colaborador)))).sort((a, b) =>
        a.localeCompare(b, "pt-BR")
      ),
    [solicitacoes]
  );

  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const vazios = new Date(ano, mes, 1).getDay();
  const lista = dia ? camposNoDia(dia) : camposNoMes;

  function andarMes(passo: number) {
    const d = new Date(ano, mes + passo, 1);
    setAno(d.getFullYear());
    setMes(d.getMonth());
    setDia(null);
  }

  function irParaHoje() {
    setAno(hoje.getFullYear());
    setMes(hoje.getMonth());
    setDia(hoje);
  }

  return (
    <section className="secao active">
      <CabecalhoDeSecao titulo="Calendário de campo" direita="Quem está em campo, em que projeto e quando" />

      <div className="table-controls">
        <div className="filter-row">
          <select
            className="form-control filter-select"
            value={projetoFiltro}
            onChange={(e) => setProjetoFiltro(e.target.value)}
            aria-label="Filtrar por projeto"
          >
            <option value="">Todos os projetos</option>
            {projetos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.cliente} | {p.nome}
              </option>
            ))}
          </select>

          <select
            className="form-control filter-select"
            value={pessoaFiltro}
            onChange={(e) => setPessoaFiltro(e.target.value)}
            aria-label="Filtrar por pessoa"
          >
            <option value="">Toda a equipe</option>
            {pessoas.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>

          <div className="filter-row-actions">
            <button className="btn btn-ghost btn-sm" type="button" onClick={irParaHoje}>
              Hoje
            </button>
            <BotaoExportarCsv
              arquivo="calendario-campo"
              cabecalho={CABECALHO_CSV}
              linhas={() => linhasCsv(lista)}
            />
          </div>
        </div>
      </div>

      <div className="cal-layout">
        <div className="cal-bloco">
          <div className="cal-topo">
            <div className="cal-nav">
              <button className="btn-pagination" type="button" onClick={() => andarMes(-1)} aria-label="Mês anterior">
                ‹
              </button>
              <span className="cal-titulo">
                {MESES[mes]} de {ano}
              </span>
              <button className="btn-pagination" type="button" onClick={() => andarMes(1)} aria-label="Próximo mês">
                ›
              </button>
            </div>
          </div>

          <div className="cal-corpo">
            <div className="cal-semana">
              <span>dom</span>
              <span>seg</span>
              <span>ter</span>
              <span>qua</span>
              <span>qui</span>
              <span>sex</span>
              <span>sáb</span>
            </div>
            <div className="cal-grade">
              {Array.from({ length: vazios }, (_, i) => (
                <button className="cal-dia cal-fora" key={`vazio-${i}`} disabled />
              ))}
              {Array.from({ length: diasNoMes }, (_, i) => {
                const numero = i + 1;
                const data = new Date(ano, mes, numero);
                const campos = camposNoDia(data);
                // Um pontinho por STATUS presente no dia, não por campo.
                const status = Array.from(new Set(campos.map((c) => c.status)));
                const classes = ["cal-dia"];
                if (mesmoDia(data, hoje)) classes.push("cal-hoje");
                if (mesmoDia(data, dia)) classes.push("cal-ativo");
                return (
                  <button
                    className={classes.join(" ")}
                    key={numero}
                    type="button"
                    title={`${campos.length} campo(s)`}
                    // Clicar de novo no mesmo dia volta para o mês inteiro.
                    onClick={() => setDia((atual) => (mesmoDia(atual, data) ? null : data))}
                  >
                    <span>{numero}</span>
                    <span className="cal-dia-pontos">
                      {status.map((st) => (
                        <i className={`cal-ponto cal-ponto-${classeDoPonto(st)}`} key={st} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* A legenda vive DENTRO do cartão do calendário, no pé dele, e
              EMPILHADA — um status por linha. É a explicação das cores da
              grade que está logo acima: num bloco separado, o olho teria de
              sair do calendário para entender o calendário.

              Empilhada e não deitada porque os cinco itens lado a lado só
              cabiam alargando a coluna do calendário, e essa largura faz
              falta na lista do dia. Na vertical ela não cobra largura.

              Fica COLADA na grade, e não no pé do cartão: legenda longe do
              que ela explica não parece legenda. O espaço que sobra no
              cartão ficou embaixo dela, onde não separa nada de nada. */}
          <div className="cal-legenda">
            <span>
              <i className="cal-ponto cal-ponto-aguardando" /> Aguardando líder
            </span>
            <span>
              <i className="cal-ponto cal-ponto-aprovada" /> Aprovada
            </span>
            <span>
              <i className="cal-ponto cal-ponto-logistica" /> Logística confirmada
            </span>
            <span>
              <i className="cal-ponto cal-ponto-campo" /> Em campo
            </span>
            <span>
              <i className="cal-ponto cal-ponto-finalizada" /> Finalizada
            </span>
          </div>
        </div>

        <div className="cal-bloco">
          <div className="cal-detalhe">
            <h5>
              {dia
                ? `${dia.toLocaleDateString("pt-BR")} · ${lista.length} campo(s)`
                : `${MESES[mes]} inteiro · ${lista.length} campo(s)`}
            </h5>
            <div className="cal-detalhe-lista">
              {lista.length ? (
                lista.map((s) => (
                  <button
                    className={`cal-evento ev-${classeDoPonto(s.status)}`}
                    key={s.id}
                    type="button"
                    onClick={() => roteador.push(`/solicitacoes/${s.id}`)}
                  >
                    <strong>{s.cliente_projeto || "—"}</strong>
                    <small>
                      {periodoTexto(s)} · {s.destino || "—"}
                    </small>
                    <small>
                      {s.equipe.map((e) => e.colaborador).join(", ") || "Equipe não informada"}
                    </small>
                    <small className="cal-evento-id">
                      {s.codigo} · {s.status}
                      {s.equipamentos.length ? ` · ${s.equipamentos.length} equipamento(s)` : ""}
                    </small>
                  </button>
                ))
              ) : (
                <p className="cal-detalhe-vazio">
                  {v2Ativa
                    ? "Nenhum campo neste período."
                    : "Rode supabase/02_campo_v2.sql para o calendário mostrar a equipe."}
                </p>
              )}
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}

const CABECALHO_CSV = [
  "Código", "Cliente | Projeto", "Destino", "Início", "Fim",
  "Colaborador", "Função", "Líder", "Clockify", "Status", "SST",
] as const;

/** Uma linha por PESSOA por campo. Campo sem equipe informada continua
 *  aparecendo, com a marca — sumir seria pior do que dizer que falta. */
function linhasCsv(lista: readonly SolicitacaoDeLista[]): unknown[][] {
  return lista.flatMap((s) => {
    const equipe = s.equipe.length
      ? s.equipe
      : [{ colaborador: "(equipe não informada)", funcao: "", lider: false, codigo_clockify: "" }];
    return equipe.map((e) => [
      s.codigo,
      s.cliente_projeto,
      s.destino,
      dataISOparaBR(s.periodo_inicio),
      dataISOparaBR(s.periodo_fim),
      e.colaborador,
      e.funcao ?? "",
      e.lider ? "Sim" : "",
      e.codigo_clockify ?? "",
      s.status,
      s.sst_identificacao,
    ]);
  });
}
