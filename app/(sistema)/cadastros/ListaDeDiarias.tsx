"use client";

// O valor de referência da diária de alimentação: R$ 55,00 com pernoite e
// R$ 35,00 sem.
//
// Fica em TABELA e não no código por dois motivos: mudar o valor é decisão
// administrativa e não deploy, e o valor de referência precisa estar ao
// lado do valor efetivamente pago para a diferença aparecer.
//
// Só o VALOR é editável. O nome, o vínculo e o pernoite são a identidade
// da linha — vêm da planilha, e trocar um deles não é corrigir o valor, é
// criar outra diária.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/app/components/Modal";
import { useAvisos } from "@/app/components/Avisos";
import { CampoMascarado } from "@/app/components/Campos";
import { Selo, TabelaVazia } from "@/app/components/Tabela";
import { Icone } from "@/app/components/Icone";
import { mensagemDoErro, patch } from "@/app/components/api";
import { formatarMoeda, formatarNumeroBR, parseMoeda } from "@/lib/formato";
import type { DiariaValor } from "@/lib/tipos";

interface Props {
  diarias: DiariaValor[];
  podeEditar: boolean;
  v2Ativa: boolean;
}

export function ListaDeDiarias({ diarias, podeEditar, v2Ativa }: Props) {
  const roteador = useRouter();
  const { avisar } = useAvisos();

  const [emEdicao, setEmEdicao] = useState<DiariaValor | null>(null);
  const [valor, setValor] = useState("");
  const [ocupado, setOcupado] = useState(false);

  function abrir(d: DiariaValor) {
    setEmEdicao(d);
    setValor(formatarNumeroBR(d.valor));
  }

  async function salvar() {
    if (!emEdicao) return;
    if (parseMoeda(valor) <= 0) {
      avisar("Informe o valor da diária.", "erro");
      return;
    }
    setOcupado(true);
    try {
      await patch(`/api/diarias/${emEdicao.id}`, { valor: parseMoeda(valor) });
      setEmEdicao(null);
      avisar("Valor de referência atualizado.", "ok");
      roteador.refresh();
    } catch (erro) {
      avisar(mensagemDoErro(erro, "atualizar o valor da diária"), "erro");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="lista-wrapper">
      <div className="table-controls">
        <div className="filter-resumo">
          {!v2Ativa
            ? "Rode supabase/02_campo_v2.sql para a tabela de diárias existir."
            : podeEditar
              ? "Só a Gestão altera o valor de referência. Diárias já lançadas guardam o valor com que foram lançadas."
              : "Valores de referência da diária de alimentação. Alterá-los é da Gestão."}
        </div>
      </div>

      <div className="table-wrapper">
        <div className="table-scroll">
          <table className="art-table tabela-centralizada">
            <thead>
              <tr>
                <th>Diária</th>
                <th>Vínculo</th>
                <th>Pernoite</th>
                <th>Valor de referência</th>
                <th className="col-acoes">Ações</th>
              </tr>
            </thead>
            <tbody>
              {diarias.map((d) => (
                <tr key={d.id}>
                  <td>{d.tipo_diaria}</td>
                  <td>{d.vinculo}</td>
                  <td>
                    <Selo texto={d.pernoite ? "Com pernoite" : "Sem pernoite"} classe={d.pernoite ? "st-info" : "st-neutro"} />
                  </td>
                  <td>{formatarMoeda(d.valor)}</td>
                  <td className="table-actions">
                    {podeEditar ? (
                      <button className="btn-icon" type="button" title="Alterar valor" onClick={() => abrir(d)}>
                        <Icone nome="editar" />
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TabelaVazia visivel={diarias.length === 0}>
            <strong>Tabela de diárias não encontrada</strong>
          </TabelaVazia>
        </div>
      </div>

      <Modal
        titulo="Valor de referência da diária"
        aberto={emEdicao !== null}
        aoFechar={() => setEmEdicao(null)}
        tamanho="sm"
        rodape={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setEmEdicao(null)} disabled={ocupado}>
              Cancelar
            </button>
            <button className="btn btn-primary" type="button" onClick={salvar} disabled={ocupado}>
              {ocupado ? "Salvando…" : "Salvar"}
            </button>
          </>
        }
      >
        {emEdicao ? (
          <>
            <div className="form-group">
              <label className="form-label" htmlFor="dv-tipo">
                Diária
              </label>
              <input id="dv-tipo" className="form-control" value={emEdicao.tipo_diaria} readOnly />
            </div>
            <div className="form-group">
              <label className="form-label required" htmlFor="dv-valor">
                Valor
              </label>
              <CampoMascarado id="dv-valor" mascara="moeda" valor={valor} aoMudar={setValor} />
            </div>
            <p className="modal-hint">
              O valor vale para as próximas solicitações. Diárias já lançadas guardam o valor com que foram
              lançadas.
            </p>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
