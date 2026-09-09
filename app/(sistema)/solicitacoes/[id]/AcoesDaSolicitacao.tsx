"use client";

// ═══════════════════════════════════════════════════════════════════════
//  O QUE SE FAZ COM UMA SOLICITAÇÃO ABERTA
//
//  Aprovar e recusar (só o líder do projeto ou a Direção), cancelar,
//  acrescentar equipamento e editar.
//
//  ── RECUSAR NÃO É CANCELAR ──
//
//  Recusar é o líder dizendo que aquele campo não é do escopo do projeto
//  dele; cancelar é desfazer um campo que ia acontecer. Os dois soltam a
//  reserva e os dois exigem motivo — mas são decisões de pessoas
//  diferentes, em momentos diferentes, e por isso são dois botões e não
//  um. É a mesma distinção que existe no banco, em duas funções.
//
//  Nenhuma decisão de permissão é tomada aqui: `podeDecidir` e
//  `podeEditar` chegam prontos do servidor, e a checagem que vale mesmo é
//  a de `aprovar_solicitacao_lider()`, dentro da transação.
// ═══════════════════════════════════════════════════════════════════════

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/app/components/Modal";
import { useAvisos } from "@/app/components/Avisos";
import { mensagemDoErro, post } from "@/app/components/api";
import { dataISOparaBR } from "@/lib/formato";
import type {
  DiariaValor,
  Hotel,
  Item,
  Projeto,
  SolicitacaoDeLista,
  StatusSolicitacao,
} from "@/lib/tipos";
import { ChecklistEmPopup } from "@/app/(sistema)/solicitacoes/[id]/checklist/ChecklistEmPopup";
import { FormularioDeSolicitacao } from "@/app/(sistema)/solicitacoes/formulario/FormularioDeSolicitacao";
import type { EstadoDoFormulario } from "@/app/(sistema)/solicitacoes/formulario/estado";

/**
 * Tudo que o formulário de solicitação precisa para abrir em popup a
 * partir daqui. Vem pronto do Server Component: o formulário não
 * consulta banco.
 */
export interface DadosDoFormulario {
  inicial: EstadoDoFormulario;
  projetos: Projeto[];
  hoteis: Hotel[];
  diariasCadastradas: DiariaValor[];
  usuarioId: string;
  solicitanteNome: string;
  ehDirecao: boolean;
  equipamentosEntregues: number;
}

interface Props {
  id: string;
  codigo: string;
  status: StatusSolicitacao;
  temEquipamento: boolean;
  podeEditar: boolean;
  podeDecidir: boolean;
  catalogo: Item[];
  periodo: { inicio: string | null; fim: string | null };
  /** A solicitação inteira, para o POPUP do checklist montar a folha. */
  solicitacao: SolicitacaoDeLista;
  /** `null` quando o pedido não é editável — aí nem o botão aparece. */
  formulario: DadosDoFormulario | null;
}

type ModalAberto = "recusa" | "cancelamento" | "acrescimo" | "edicao" | null;

export function AcoesDaSolicitacao({
  id,
  codigo,
  status,
  temEquipamento,
  podeEditar,
  podeDecidir,
  catalogo,
  periodo,
  solicitacao,
  formulario,
}: Props) {
  const roteador = useRouter();
  const { avisar } = useAvisos();

  const [aberto, setAberto] = useState<ModalAberto>(null);
  const [ocupado, setOcupado] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [itemEscolhido, setItemEscolhido] = useState("");
  const [quantidade, setQuantidade] = useState("1");

  function fechar() {
    setAberto(null);
    setMotivo("");
  }

  /** O padrão de toda ação: trava o botão, chama, avisa e recarrega os
   *  Server Components. `router.refresh()` é o que substitui o
   *  `recarregarTudo()` da versão anterior — sem recarregar a página. */
  async function executar(acao: () => Promise<string>, oQueFalhou: string) {
    setOcupado(true);
    try {
      const mensagem = await acao();
      fechar();
      avisar(mensagem, "ok");
      roteador.refresh();
    } catch (erro) {
      avisar(mensagemDoErro(erro, oQueFalhou), "erro");
    } finally {
      setOcupado(false);
    }
  }

  function aprovar() {
    void executar(async () => {
      await post(`/api/solicitacoes/${id}/aprovar`, { aprovar: true });
      return `${codigo} aprovada.`;
    }, "aprovar a solicitação");
  }

  function recusar() {
    if (!motivo.trim()) {
      avisar("Escreva o motivo da recusa.", "erro");
      return;
    }
    void executar(async () => {
      const r = await post<{ liberadas?: number }>(`/api/solicitacoes/${id}/aprovar`, {
        aprovar: false,
        motivo,
      });
      const soltas = r.liberadas ?? 0;
      return `${codigo} recusada${soltas ? ` · ${soltas} reserva(s) liberada(s)` : ""}.`;
    }, "recusar a solicitação");
  }

  function cancelar() {
    if (!motivo.trim()) {
      avisar("Escreva o motivo do cancelamento.", "erro");
      return;
    }
    void executar(async () => {
      const r = await post<{ liberadas?: number }>(`/api/solicitacoes/${id}/cancelar`, { motivo });
      const soltas = r.liberadas ?? 0;
      return `Solicitação cancelada${soltas ? ` · ${soltas} reserva(s) liberada(s)` : ""}.`;
    }, "cancelar a solicitação");
  }

  function acrescentar() {
    if (!itemEscolhido) {
      avisar("Escolha o equipamento.", "erro");
      return;
    }
    const qtd = Number(quantidade);
    if (!Number.isInteger(qtd) || qtd <= 0) {
      avisar("A quantidade precisa ser maior que zero.", "erro");
      return;
    }
    void executar(async () => {
      await post(`/api/solicitacoes/${id}/equipamentos`, { item_id: itemEscolhido, quantidade: qtd });
      setItemEscolhido("");
      setQuantidade("1");
      return "Equipamento acrescentado e reservado no período.";
    }, "acrescentar o equipamento");
  }

  const temPeriodo = Boolean(periodo.inicio && periodo.fim);

  return (
    <>
      <div className="modal-footer" style={{ marginTop: "1.2rem", paddingInline: 0 }}>
        {podeEditar ? (
          <button className="btn btn-red" type="button" onClick={() => setAberto("cancelamento")}>
            Cancelar solicitação
          </button>
        ) : null}

        {podeEditar ? (
          <button className="btn btn-ghost" type="button" onClick={() => setAberto("acrescimo")}>
            + Acrescentar equipamento
          </button>
        ) : null}

        {/* Editar abre POPUP sobre o detalhe, não outra página. Depois de
            salvar, o `refresh()` do formulário atualiza este detalhe
            embaixo — a pessoa vê a alteração no mesmo lugar de onde
            pediu. */}
        {podeEditar && formulario ? (
          <button className="btn btn-ghost" type="button" onClick={() => setAberto("edicao")}>
            Editar
          </button>
        ) : null}

        {/* Popup, e não link: o detalhe já é a tela do pedido, e trocar de
            página para ver a folha dele — e voltar — é uma ida e volta que
            não acrescenta nada. Aqui o gatilho é botão com texto, porque as
            outras ações deste rodapé também são. */}
        {temEquipamento ? (
          <ChecklistEmPopup solicitacao={solicitacao} catalogo={catalogo} rotulo="Checklist" />
        ) : null}

        {podeDecidir ? (
          <>
            <button className="btn btn-red" type="button" onClick={() => setAberto("recusa")} disabled={ocupado}>
              Recusar
            </button>
            <button className="btn btn-green" type="button" onClick={aprovar} disabled={ocupado}>
              Aprovar
            </button>
          </>
        ) : null}
      </div>

      <Modal
        titulo="Recusar solicitação"
        aberto={aberto === "recusa"}
        aoFechar={fechar}
        tamanho="sm"
        rodape={
          <>
            <button className="btn btn-ghost" type="button" onClick={fechar} disabled={ocupado}>
              Voltar
            </button>
            <button className="btn btn-red" type="button" onClick={recusar} disabled={ocupado}>
              {ocupado ? "Recusando…" : "Recusar"}
            </button>
          </>
        }
      >
        <div className="info-grid">
          <div>
            <span>Solicitação</span>
            <strong>{codigo}</strong>
          </div>
          <div>
            <span>Situação</span>
            <strong>{status}</strong>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label required" htmlFor="motivo-recusa">
            Motivo da recusa
          </label>
          <textarea
            id="motivo-recusa"
            className="form-control"
            rows={3}
            placeholder="Explique para quem pediu"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>
        <p className="modal-hint">
          O motivo aparece para o solicitante e fica no histórico. O material reservado volta a ficar
          disponível nas datas.
        </p>
      </Modal>

      <Modal
        titulo="Cancelar solicitação"
        aberto={aberto === "cancelamento"}
        aoFechar={fechar}
        tamanho="sm"
        rodape={
          <>
            <button className="btn btn-ghost" type="button" onClick={fechar} disabled={ocupado}>
              Voltar
            </button>
            <button className="btn btn-red" type="button" onClick={cancelar} disabled={ocupado}>
              {ocupado ? "Cancelando…" : "Cancelar solicitação"}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label required" htmlFor="motivo-cancelamento">
            Motivo
          </label>
          <textarea
            id="motivo-cancelamento"
            className="form-control"
            rows={3}
            placeholder="Explique para quem pediu"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>
        <p className="modal-hint">
          O motivo fica no histórico da solicitação. O material que estava reservado volta a ficar
          disponível nas datas.
        </p>
      </Modal>

      <Modal
        titulo="Acrescentar equipamento"
        aberto={aberto === "acrescimo"}
        aoFechar={fechar}
        tamanho="sm"
        rodape={
          <>
            <button className="btn btn-ghost" type="button" onClick={fechar} disabled={ocupado}>
              Cancelar
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={acrescentar}
              disabled={ocupado || !temPeriodo}
            >
              {ocupado ? "Acrescentando…" : "Acrescentar"}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label required" htmlFor="acrescimo-item">
            Equipamento
          </label>
          <select
            id="acrescimo-item"
            className="form-control"
            value={itemEscolhido}
            onChange={(e) => setItemEscolhido(e.target.value)}
          >
            <option value="">Selecione no estoque</option>
            {catalogo.map((c) => (
              <option key={c.id} value={c.id}>
                {c.produto} · {c.codigo} (saldo {c.estoque_atual})
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label required" htmlFor="acrescimo-qtd">
            Quantidade
          </label>
          <input
            id="acrescimo-qtd"
            className="form-control"
            type="number"
            min={1}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
          />
        </div>
        <p className="modal-hint">
          {temPeriodo
            ? `O acréscimo é reservado de ${dataISOparaBR(periodo.inicio)} a ${dataISOparaBR(periodo.fim)}. Se não couber, o sistema diz o que falta e nada é gravado.`
            : "Esta solicitação não tem período definido — o acréscimo não pode ser reservado sem datas."}
        </p>
      </Modal>

      {/* ══ EDIÇÃO EM POPUP ══
          Sem `rodape`: o formulário já traz Cancelar / Salvar no fim do
          corpo. */}
      <Modal titulo={`Editar ${codigo}`} aberto={aberto === "edicao"} aoFechar={() => setAberto(null)}>
        {aberto === "edicao" && formulario ? (
          <FormularioDeSolicitacao
            emPopup
            solicitacaoId={id}
            codigo={codigo}
            inicial={formulario.inicial}
            projetos={formulario.projetos}
            hoteis={formulario.hoteis}
            catalogo={catalogo}
            diariasCadastradas={formulario.diariasCadastradas}
            usuarioId={formulario.usuarioId}
            solicitanteNome={formulario.solicitanteNome}
            ehDirecao={formulario.ehDirecao}
            equipamentosEntregues={formulario.equipamentosEntregues}
            aoFechar={() => setAberto(null)}
            aoSalvar={() => setAberto(null)}
          />
        ) : null}
      </Modal>
    </>
  );
}
