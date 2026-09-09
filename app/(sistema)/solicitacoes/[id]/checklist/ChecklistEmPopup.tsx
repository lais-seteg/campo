"use client";

// ═══════════════════════════════════════════════════════════════════════
//  O CHECKLIST EM POPUP
//
//  É como se usa a folha: abre sobre a tabela em que a pessoa já está —
//  Solicitações, Conferência, detalhe do pedido — sem trocar de página e
//  sem perder o filtro, a busca e a rolagem em que ela estava. Era assim
//  na versão anterior, e o `@media print` do CSS nunca deixou de tratar o
//  `.modal-overlay` por isso.
//
//  A página `/solicitacoes/[id]/checklist` continua existindo, para link
//  direto e para quem chega pelo endereço. As duas montam a MESMA
//  `FolhaDoChecklist` — documento com duas cópias de layout diverge na
//  primeira alteração, e o que sai no papel passaria a depender de por onde
//  se entrou.
//
//  ── AS ASSINATURAS SÓ CHEGAM AO ABRIR ──
//
//  Elas são PNG de até 400 KB, quatro por pedido, e a lista não as traz —
//  se trouxesse, abrir a tabela de Solicitações baixaria toda assinatura da
//  empresa. O popup as busca quando é aberto, e é a única ida a mais que
//  ele cobra.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useState } from "react";
import { Modal } from "@/app/components/Modal";
import { Icone } from "@/app/components/Icone";
import { useAvisos } from "@/app/components/Avisos";
import { FolhaDoChecklist } from "@/app/(sistema)/solicitacoes/[id]/checklist/FolhaDoChecklist";
import { get, mensagemDoErro } from "@/app/components/api";
import type {
  Item,
  SituacaoDaAssinatura,
  SolicitacaoAssinatura,
  SolicitacaoDeLista,
} from "@/lib/tipos";

interface Carga {
  assinaturas: SolicitacaoAssinatura[];
  situacao: SituacaoDaAssinatura[];
}

export function ChecklistEmPopup({
  solicitacao: s,
  catalogo,
  rotulo,
}: {
  solicitacao: SolicitacaoDeLista;
  catalogo: Item[];
  /** Quando presente, o gatilho é um botão com texto (usado no detalhe da
   *  solicitação, onde as ações são botões escritos). Sem ele, é só o
   *  ícone — que é o que cabe numa coluna de ações. */
  rotulo?: string;
}) {
  const { avisar } = useAvisos();
  const [aberto, setAberto] = useState(false);
  const [carga, setCarga] = useState<Carga | null>(null);
  const [carregando, setCarregando] = useState(false);

  const abrir = useCallback(async () => {
    setAberto(true);
    // Recarrega a cada abertura de propósito: entre uma abertura e outra
    // alguém pode ter assinado do acesso dele, e uma folha em cache mostraria
    // a linha ainda vazia — justamente a informação que faz a pessoa esperar
    // ou seguir.
    setCarregando(true);
    try {
      setCarga(await get<Carga>(`/api/solicitacoes/${s.id}/checklist`));
    } catch (erro) {
      avisar(mensagemDoErro(erro, "abrir o checklist"), "erro");
    } finally {
      setCarregando(false);
    }
  }, [s.id, avisar]);

  return (
    <>
      {rotulo ? (
        <button className="btn btn-ghost" type="button" onClick={abrir}>
          {rotulo}
        </button>
      ) : (
        <button
          className="btn-icon"
          type="button"
          title="Checklist de campo"
          aria-label="Checklist de campo"
          onClick={abrir}
        >
          <Icone nome="checklist" />
        </button>
      )}

      <Modal
        titulo={`Checklist · ${s.codigo}`}
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        rodape={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setAberto(false)}>
              Fechar
            </button>
            {/* A impressão é a do navegador: o `@media print` esconde tudo
                que não está em #checklistFolha, então o papel sai com a
                folha e nada da tela. */}
            <button className="btn btn-primary" type="button" onClick={() => window.print()}>
              Imprimir
            </button>
          </>
        }
      >
        {carregando && !carga ? (
          <p className="modal-hint">Carregando a folha…</p>
        ) : carga ? (
          <FolhaDoChecklist
            solicitacao={s}
            catalogo={catalogo}
            assinaturas={carga.assinaturas}
            situacao={carga.situacao}
          />
        ) : (
          <p className="modal-hint">Não foi possível carregar o checklist.</p>
        )}
      </Modal>
    </>
  );
}
