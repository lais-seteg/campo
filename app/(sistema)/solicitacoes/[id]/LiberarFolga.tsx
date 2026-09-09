"use client";

// ═══════════════════════════════════════════════════════════════════════
//  LIBERAR A FOLGA ENTRE CAMPOS, item a item
//
//  A reserva segura o material também na véspera e no dia seguinte do
//  campo, para separar, transportar e conferir na volta. Isso é padrão, não
//  lei: às vezes o campo anterior volta de manhã e o próximo sai à tarde, do
//  mesmo galpão. Quem sabe disso é o administrativo.
//
//  Quando o pedido esbarra SÓ na folga, a linha do equipamento é gravada sem
//  reserva e fica aguardando. Este botão é o que resolve — e resolver aqui,
//  dentro do pedido, é o que faz a decisão ficar registrada em vez de
//  acontecer por mensagem.
//
//  A permissão de verdade está em `liberar_folga_equipamento()`, que confere
//  `eh_administrativo()` contra `auth.uid()` na mesma transação em que grava.
//  Este componente só não é mostrado a quem tomaria 403.
// ═══════════════════════════════════════════════════════════════════════

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/app/components/Modal";
import { useAvisos } from "@/app/components/Avisos";
import { mensagemDoErro, post } from "@/app/components/api";

interface Props {
  solicitacaoId: string;
  equipamentoId: string;
  equipamento: string;
  /** Já liberado? Então o botão retira a liberação em vez de conceder. */
  liberado: boolean;
}

export function LiberarFolga({ solicitacaoId, equipamentoId, equipamento, liberado }: Props) {
  const roteador = useRouter();
  const { avisar } = useAvisos();

  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function enviar(liberar: boolean) {
    setOcupado(true);
    try {
      const r = await post<{ reservado?: boolean }>(
        `/api/solicitacoes/${solicitacaoId}/equipamentos/${equipamentoId}/folga`,
        { liberar, motivo: liberar ? motivo : undefined }
      );
      setAberto(false);
      setMotivo("");
      avisar(
        liberar
          ? `Folga liberada · ${equipamento}${r.reservado ? " reservado" : ""}.`
          : `Liberação retirada · ${equipamento}.`,
        "ok"
      );
      roteador.refresh();
    } catch (erro) {
      avisar(mensagemDoErro(erro, liberar ? "liberar a folga" : "retirar a liberação"), "erro");
    } finally {
      setOcupado(false);
    }
  }

  // Retirar a liberação não pede motivo: é voltar ao padrão do sistema, e o
  // padrão não precisa ser justificado. Conceder, sim.
  //
  // O rótulo é "Retirar" e não "Retirar liberação": o longo dobrava a largura
  // da coluna de reserva, e o que ele explica cabe no `title`. Texto e não
  // ícone porque desfazer uma liberação é decisão — um desenho sem nome ali
  // seria clicado por engano.
  if (liberado) {
    return (
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        disabled={ocupado}
        onClick={() => enviar(false)}
        title="Retirar a liberação: volta a exigir a folga de um dia antes e depois"
      >
        {ocupado ? "…" : "Retirar"}
      </button>
    );
  }

  return (
    <>
      <button className="btn btn-green btn-sm" type="button" onClick={() => setAberto(true)} disabled={ocupado}>
        Liberar
      </button>

      <Modal
        titulo="Liberar a folga entre campos"
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        tamanho="sm"
        rodape={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setAberto(false)} disabled={ocupado}>
              Voltar
            </button>
            <button className="btn btn-green" type="button" disabled={ocupado} onClick={() => enviar(true)}>
              {ocupado ? "Liberando…" : "Liberar"}
            </button>
          </>
        }
      >
        <p className="modal-hint" style={{ marginTop: 0 }}>
          <strong>{equipamento}</strong> está livre nas datas deste campo. O que segura é a folga de
          um dia que a reserva guarda antes e depois de outro campo, para separar, transportar e
          conferir na volta.
        </p>
        <div className="form-group">
          <label className="form-label" htmlFor={`folga-motivo-${equipamentoId}`}>
            Motivo (opcional)
          </label>
          <textarea
            id={`folga-motivo-${equipamentoId}`}
            className="form-control"
            rows={3}
            placeholder="Ex.: o campo anterior devolve na manhã do dia 12, e este sai à tarde"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>
        <p className="modal-hint">
          A reserva é feita agora, na mesma ação, e fica no histórico com o seu nome. Se outro campo
          tiver levado o item nesse meio-tempo, nada é gravado e o sistema avisa.
        </p>
      </Modal>
    </>
  );
}
