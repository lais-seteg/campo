"use client";

// Aprovar e recusar direto da fila, sem abrir o detalhe. Recusar exige o
// motivo — quem pediu precisa saber por quê, e o banco também cobra.
//
// Quem confere se ESTA pessoa pode decidir ESTE pedido é
// `aprovar_solicitacao_lider()`, dentro da transação, comparando
// `auth.uid()` com `projetos.lider_id`. A fila já veio filtrada do
// servidor; isto aqui é a interface, não a permissão.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/app/components/Modal";
import { useAvisos } from "@/app/components/Avisos";
import { mensagemDoErro, post } from "@/app/components/api";

export function DecisaoDoLider({ id, codigo }: { id: string; codigo: string }) {
  const roteador = useRouter();
  const { avisar } = useAvisos();

  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function decidir(aprovar: boolean) {
    setOcupado(true);
    try {
      const r = await post<{ liberadas?: number }>(`/api/solicitacoes/${id}/aprovar`, {
        aprovar,
        motivo: aprovar ? undefined : motivo,
      });
      const soltas = r.liberadas ?? 0;
      setRecusando(false);
      setMotivo("");
      avisar(
        aprovar
          ? `${codigo} aprovada.`
          : `${codigo} recusada${soltas ? ` · ${soltas} reserva(s) liberada(s)` : ""}.`,
        "ok"
      );
      roteador.refresh();
    } catch (erro) {
      avisar(mensagemDoErro(erro, aprovar ? "aprovar a solicitação" : "recusar a solicitação"), "erro");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <button className="btn btn-green btn-sm" type="button" onClick={() => decidir(true)} disabled={ocupado}>
        Aprovar
      </button>
      <button className="btn btn-red btn-sm" type="button" onClick={() => setRecusando(true)} disabled={ocupado}>
        Recusar
      </button>

      <Modal
        titulo={`Recusar ${codigo}`}
        aberto={recusando}
        aoFechar={() => setRecusando(false)}
        tamanho="sm"
        rodape={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setRecusando(false)} disabled={ocupado}>
              Voltar
            </button>
            <button
              className="btn btn-red"
              type="button"
              disabled={ocupado || !motivo.trim()}
              onClick={() => decidir(false)}
            >
              {ocupado ? "Recusando…" : "Recusar"}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label required" htmlFor={`motivo-${id}`}>
            Motivo da recusa
          </label>
          <textarea
            id={`motivo-${id}`}
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
    </>
  );
}
