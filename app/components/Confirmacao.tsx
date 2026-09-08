"use client";

// ═══════════════════════════════════════════════════════════════════════
//  A CAIXA DE "TEM CERTEZA?"
//
//  Exclusão é a única ação do sistema que não tem desfazer, e por isso é a
//  única que pergunta antes. A pergunta usava `window.confirm` — o diálogo
//  do NAVEGADOR. Ele funciona, mas tem três problemas que importam aqui:
//
//   · não é a tela do sistema. Fonte, cores e botões são do navegador, e
//     numa exclusão o que se lê depressa é o BOTÃO — "OK" cinza ao lado de
//     "Cancelar" cinza não diz qual dos dois apaga;
//   · não formata nada. A consequência da exclusão ("esta pessoa lidera 3
//     projetos") chega no mesmo tom da pergunta, num parágrafo só;
//   · em alguns navegadores embarcados ele é simplesmente suprimido, e aí
//     o clique não faz nada — ou faz tudo, sem perguntar.
//
//  Este componente é o `Modal` de sempre, no tamanho `sm`, com o botão que
//  apaga em VERMELHO e o foco começando no Cancelar. Esc e clique no fundo
//  cancelam, porque é o comportamento seguro.
// ═══════════════════════════════════════════════════════════════════════

import type { ReactNode } from "react";
import { Modal } from "@/app/components/Modal";

interface Props {
  aberto: boolean;
  /** Título do diálogo. O padrão serve para exclusão. */
  titulo?: string;
  /** A pergunta. Costuma nomear O QUE vai ser excluído. */
  pergunta: ReactNode;
  /** A consequência, quando existe uma — sai destacada em vermelho. É o
   *  que separa "excluir um cadastro solto" de "excluir quem lidera três
   *  projetos". */
  aviso?: ReactNode;
  rotuloConfirmar?: string;
  ocupado?: boolean;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}

export function ModalDeConfirmacao({
  aberto,
  titulo = "Confirmar exclusão",
  pergunta,
  aviso,
  rotuloConfirmar = "Excluir",
  ocupado = false,
  aoConfirmar,
  aoCancelar,
}: Props) {
  return (
    <Modal
      titulo={titulo}
      aberto={aberto}
      aoFechar={aoCancelar}
      tamanho="sm"
      rodape={
        <>
          {/* Cancelar vem PRIMEIRO e é o que o Enter alcança antes: numa
              caixa que apaga, o caminho fácil tem de ser o que não apaga. */}
          <button className="btn btn-ghost" type="button" onClick={aoCancelar} disabled={ocupado}>
            Cancelar
          </button>
          <button className="btn btn-red" type="button" onClick={aoConfirmar} disabled={ocupado}>
            {ocupado ? "Excluindo…" : rotuloConfirmar}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{pergunta}</p>
      {aviso ? (
        <p className="form-hint-alerta" style={{ marginTop: ".6rem", marginBottom: 0 }}>
          {aviso}
        </p>
      ) : null}
    </Modal>
  );
}
