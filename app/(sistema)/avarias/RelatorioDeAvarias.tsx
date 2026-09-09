"use client";

// O relatório de avarias com custo estimado e custo real, e a edição de
// cada uma. A regra "Resolvida e Cobrada exigem custo real" é do banco e
// aparece aqui como uma frase, antes de o botão ser apertado — deixá-la só
// para o banco faria a tela mostrar o nome de uma constraint.

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Modal } from "@/app/components/Modal";
import { useAvisos } from "@/app/components/Avisos";
import { CampoMascarado } from "@/app/components/Campos";
import { BotaoExportarCsv, CabecalhoDeSecao, TabelaVazia } from "@/app/components/Tabela";
import { Icone } from "@/app/components/Icone";
import { mensagemDoErro, patch } from "@/app/components/api";
import { csvNumero, formatarData, formatarMoeda, formatarNumeroBR, parseMoeda } from "@/lib/formato";
import {
  GRAVIDADES_AVARIA,
  PROVIDENCIAS_AVARIA,
  SITUACOES_AVARIA,
  SITUACOES_AVARIA_QUE_EXIGEM_CUSTO,
  type AvariaResolvida,
  type GravidadeAvaria,
  type ProvidenciaAvaria,
  type SituacaoAvaria,
} from "@/lib/tipos";

interface Rascunho {
  id: string;
  contexto: string;
  descricao: string;
  gravidade: GravidadeAvaria;
  providencia: ProvidenciaAvaria;
  causa: string;
  responsavel: string;
  custoEstimado: string;
  custoReal: string;
  fornecedor: string;
  notaFiscal: string;
  situacao: SituacaoAvaria;
}

export function RelatorioDeAvarias({
  avarias,
  v2Ativa,
}: {
  avarias: AvariaResolvida[];
  v2Ativa: boolean;
}) {
  const roteador = useRouter();
  const { avisar } = useAvisos();

  const [situacao, setSituacao] = useState("");
  const [gravidade, setGravidade] = useState("");
  const [busca, setBusca] = useState("");
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const filtradas = useMemo(() => {
    const texto = busca.trim().toLowerCase();
    return avarias.filter((a) => {
      if (situacao && a.situacao !== situacao) return false;
      if (gravidade && a.gravidade !== gravidade) return false;
      if (!texto) return true;
      const alvo = `${a.equipamento} ${a.solicitacao_codigo} ${a.projeto} ${a.descricao}`.toLowerCase();
      return alvo.includes(texto);
    });
  }, [avarias, situacao, gravidade, busca]);

  const totalEstimado = filtradas.reduce((t, a) => t + (Number(a.custo_estimado) || 0), 0);
  const totalReal = filtradas.reduce((t, a) => t + (Number(a.custo_real) || 0), 0);
  // "Em aberto" é o que ainda não teve custo real lançado: é o que pode
  // virar despesa e ninguém sabe de quanto.
  const emAberto = filtradas
    .filter((a) => a.custo_real == null)
    .reduce((t, a) => t + (Number(a.custo_estimado) || 0), 0);

  function abrir(a: AvariaResolvida) {
    setRascunho({
      id: a.id,
      contexto: `${a.solicitacao_codigo} · ${a.projeto} · ${a.equipamento}`,
      descricao: a.descricao,
      gravidade: a.gravidade,
      providencia: a.providencia,
      causa: a.causa ?? "",
      responsavel: a.responsavel ?? "",
      custoEstimado: formatarNumeroBR(a.custo_estimado),
      custoReal: a.custo_real == null ? "" : formatarNumeroBR(a.custo_real),
      fornecedor: a.fornecedor ?? "",
      notaFiscal: a.nota_fiscal ?? "",
      situacao: a.situacao,
    });
  }

  async function salvar() {
    if (!rascunho) return;
    if (!rascunho.descricao.trim()) {
      avisar("Descreva a avaria.", "erro");
      return;
    }
    if (SITUACOES_AVARIA_QUE_EXIGEM_CUSTO.includes(rascunho.situacao) && !rascunho.custoReal.trim()) {
      avisar(`Avaria ${rascunho.situacao.toLowerCase()} exige o custo real.`, "erro");
      return;
    }

    setOcupado(true);
    try {
      await patch(`/api/avarias/${rascunho.id}`, {
        descricao: rascunho.descricao,
        gravidade: rascunho.gravidade,
        providencia: rascunho.providencia,
        causa: rascunho.causa || null,
        responsavel: rascunho.responsavel || null,
        custo_estimado: parseMoeda(rascunho.custoEstimado),
        custo_real: rascunho.custoReal.trim() ? parseMoeda(rascunho.custoReal) : null,
        fornecedor: rascunho.fornecedor || null,
        nota_fiscal: rascunho.notaFiscal || null,
        situacao: rascunho.situacao,
      });
      setRascunho(null);
      avisar("Avaria atualizada.", "ok");
      roteador.refresh();
    } catch (erro) {
      avisar(mensagemDoErro(erro, "salvar a avaria"), "erro");
    } finally {
      setOcupado(false);
    }
  }

  const hoje = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <section className="secao active">
      <CabecalhoDeSecao titulo="Relatório de avarias" direita={hoje} />

      <div className="lista-wrapper">
        <div className="table-controls">
          <div className="filter-row">
            <select
              className="form-control filter-select"
              value={situacao}
              onChange={(e) => setSituacao(e.target.value)}
              aria-label="Filtrar por situação"
            >
              <option value="">Todas as situações</option>
              {SITUACOES_AVARIA.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select
              className="form-control filter-select"
              value={gravidade}
              onChange={(e) => setGravidade(e.target.value)}
              aria-label="Filtrar por gravidade"
            >
              <option value="">Todas as gravidades</option>
              {GRAVIDADES_AVARIA.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
            <input
              className="form-control search-input"
              placeholder="Buscar por equipamento, solicitação ou descrição"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Buscar"
            />
            <div className="filter-row-actions">
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => {
                  setSituacao("");
                  setGravidade("");
                  setBusca("");
                }}
              >
                Limpar
              </button>
              <BotaoExportarCsv
                arquivo="avarias-campo"
                cabecalho={CABECALHO_CSV}
                linhas={() => filtradas.map(linhaCsv)}
              />
            </div>
          </div>
          <div className="filter-resumo">
            {v2Ativa
              ? `${filtradas.length} avaria(s) no filtro · o custo de cada avaria entra no gasto REAL da solicitação e, por ela, no gasto do projeto`
              : "Rode supabase/02_campo_v2.sql para o relatório de avarias funcionar."}
          </div>
        </div>

        <div className="form-preview-row">
          <div className="form-preview-item">
            <span>Avarias</span>
            <strong>{filtradas.length}</strong>
          </div>
          <div className="form-preview-item">
            <span>Custo estimado</span>
            <strong>{formatarMoeda(totalEstimado)}</strong>
          </div>
          <div className="form-preview-item">
            <span>Custo real</span>
            <strong>{formatarMoeda(totalReal)}</strong>
          </div>
          <div className="form-preview-item">
            <span>Em aberto</span>
            <strong>{formatarMoeda(emAberto)}</strong>
          </div>
        </div>

        <div className="table-wrapper">
          <div className="table-scroll">
            <table className="art-table tabela-centralizada">
              {/* ── UM CUSTO, NÃO DOIS ──
                  Eram duas colunas, "Estimado" e "Real", e em toda linha uma
                  das duas estava vazia: enquanto a avaria não fecha só existe
                  a estimativa, e quando fecha é o real que vale. Duas larguras
                  de dinheiro para mostrar um número.
                  Agora é uma: o custo REAL quando já foi lançado, a
                  estimativa enquanto não foi — e aí a segunda linha diz
                  "estimado", porque um número provisório sem aviso vira
                  número definitivo na cabeça de quem lê. Os dois totais
                  continuam separados nos cartões acima.

                  A SITUAÇÃO saiu da tabela: está no filtro, que é como se
                  procura por ela, e no lápis, que é onde se muda. */}
              <thead>
                <tr>
                  <th>Aberta em</th>
                  <th>Solicitação</th>
                  <th>Projeto</th>
                  <th>Equipamento</th>
                  <th>Gravidade</th>
                  <th className="cel-texto">Descrição</th>
                  <th>Providência</th>
                  <th className="cel-num">Custo da avaria</th>
                  <th className="col-acoes">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((a) => (
                  <tr key={a.id}>
                    <td className="cel-inteiro">{formatarData(a.aberto_em)}</td>
                    <td className="cel-inteiro">{a.solicitacao_codigo}</td>
                    <td>{a.projeto}</td>
                    <td>{a.equipamento}</td>
                    <td>{a.gravidade}</td>
                    <td className="cel-texto">{a.descricao}</td>
                    <td>{a.providencia}</td>
                    {/* "(estimado)" ao LADO e não embaixo: como segunda
                        linha ele dobrava a altura só das avarias ainda
                        abertas, e a tabela ficava com linhas de duas
                        alturas. O aviso continua — número provisório sem
                        aviso vira definitivo na cabeça de quem lê. */}
                    <td className="cel-num">
                      {a.custo_real == null
                        ? `${formatarMoeda(a.custo_estimado)} (estimado)`
                        : formatarMoeda(a.custo_real)}
                    </td>
                    <td className="table-actions">
                      <button className="btn-icon" type="button" title="Editar avaria" onClick={() => abrir(a)}>
                        <Icone nome="editar" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TabelaVazia visivel={filtradas.length === 0}>
              <strong>Nenhuma avaria registrada</strong>
            </TabelaVazia>
          </div>
        </div>
      </div>

      <Modal
        titulo="Avaria"
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
            <div className="info-grid">
              <div className="full">
                <span>Origem</span>
                <strong>{rascunho.contexto}</strong>
              </div>
            </div>
            <div className="form-section-block">
              <div className="form-grid">
                <div className="form-group full-width">
                  <label className="form-label required" htmlFor="av-descricao">
                    Descrição da avaria
                  </label>
                  <textarea
                    id="av-descricao"
                    className="form-control"
                    rows={2}
                    value={rascunho.descricao}
                    onChange={(e) => setRascunho({ ...rascunho, descricao: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label required" htmlFor="av-gravidade">
                    Gravidade
                  </label>
                  <select
                    id="av-gravidade"
                    className="form-control"
                    value={rascunho.gravidade}
                    onChange={(e) => setRascunho({ ...rascunho, gravidade: e.target.value as GravidadeAvaria })}
                  >
                    {GRAVIDADES_AVARIA.map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label required" htmlFor="av-providencia">
                    Providência
                  </label>
                  <select
                    id="av-providencia"
                    className="form-control"
                    value={rascunho.providencia}
                    onChange={(e) =>
                      setRascunho({ ...rascunho, providencia: e.target.value as ProvidenciaAvaria })
                    }
                  >
                    {PROVIDENCIAS_AVARIA.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="av-causa">
                    Causa
                  </label>
                  <input
                    id="av-causa"
                    className="form-control"
                    placeholder="Como aconteceu"
                    value={rascunho.causa}
                    onChange={(e) => setRascunho({ ...rascunho, causa: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="av-responsavel">
                    Responsável
                  </label>
                  <input
                    id="av-responsavel"
                    className="form-control"
                    placeholder="Quem estava com o equipamento"
                    value={rascunho.responsavel}
                    onChange={(e) => setRascunho({ ...rascunho, responsavel: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label required" htmlFor="av-estimado">
                    Custo estimado
                  </label>
                  <CampoMascarado
                    id="av-estimado"
                    mascara="moeda"
                    valor={rascunho.custoEstimado}
                    aoMudar={(v) => setRascunho({ ...rascunho, custoEstimado: v })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="av-real">
                    Custo real
                  </label>
                  <CampoMascarado
                    id="av-real"
                    mascara="moeda"
                    valor={rascunho.custoReal}
                    aoMudar={(v) => setRascunho({ ...rascunho, custoReal: v })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="av-fornecedor">
                    Fornecedor do reparo
                  </label>
                  <input
                    id="av-fornecedor"
                    className="form-control"
                    value={rascunho.fornecedor}
                    onChange={(e) => setRascunho({ ...rascunho, fornecedor: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="av-nota">
                    Nota fiscal
                  </label>
                  <input
                    id="av-nota"
                    className="form-control"
                    value={rascunho.notaFiscal}
                    onChange={(e) => setRascunho({ ...rascunho, notaFiscal: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label required" htmlFor="av-situacao">
                    Situação
                  </label>
                  <select
                    id="av-situacao"
                    className="form-control"
                    value={rascunho.situacao}
                    onChange={(e) => setRascunho({ ...rascunho, situacao: e.target.value as SituacaoAvaria })}
                  >
                    {SITUACOES_AVARIA.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="modal-hint">Resolvida e Cobrada exigem o custo real preenchido.</p>
            </div>
          </>
        ) : null}
      </Modal>
    </section>
  );
}

const CABECALHO_CSV = [
  "Aberta em", "Solicitação", "Projeto", "Equipamento", "Gravidade", "Descrição",
  "Causa", "Responsável", "Providência", "Estimado", "Real", "Fornecedor", "Nota fiscal", "Situação",
] as const;

function linhaCsv(a: AvariaResolvida): unknown[] {
  return [
    formatarData(a.aberto_em),
    a.solicitacao_codigo,
    a.projeto,
    a.equipamento,
    a.gravidade,
    a.descricao,
    a.causa ?? "",
    a.responsavel ?? "",
    a.providencia,
    csvNumero(a.custo_estimado),
    a.custo_real == null ? "" : csvNumero(a.custo_real),
    a.fornecedor ?? "",
    a.nota_fiscal ?? "",
    a.situacao,
  ];
}
