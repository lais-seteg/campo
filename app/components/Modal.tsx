"use client";

// ═══════════════════════════════════════════════════════════════════════
//  MODAL — um componente, no lugar dos onze `<div class="modal-overlay">`
//  que ficavam pré-montados no index.html e eram acesos com
//  `classList.add("active")`.
//
//  A troca não é cosmética. Antes, TODOS os modais existiam no documento
//  desde o primeiro byte, com os campos preenchidos por id
//  (`document.getElementById("sNome").value = ...`), e "fechar" era só
//  esconder — o conteúdo do pedido anterior continuava ali. Agora o modal
//  só existe enquanto está aberto, e o estado morre com ele.
//
//  Ganhos de acessibilidade que a versão anterior não tinha: Esc fecha,
//  o foco entra no diálogo e volta para onde estava, o fundo não rola e
//  o leitor de tela sabe que é um diálogo.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useId, useRef, type ReactNode } from "react";

export type TamanhoDoModal = "sm" | "lg";

interface Props {
  titulo: string;
  aberto: boolean;
  aoFechar: () => void;
  tamanho?: TamanhoDoModal;
  children: ReactNode;
  /** Botões do rodapé. Sem eles, o rodapé não é renderizado. */
  rodape?: ReactNode;
}

export function Modal({ titulo, aberto, aoFechar, tamanho = "lg", children, rodape }: Props) {
  const idTitulo = useId();
  const dialogo = useRef<HTMLDivElement>(null);
  const focoAnterior = useRef<HTMLElement | null>(null);

  // ── POR QUE `aoFechar` VIVE NUMA REF ──
  //
  // Este efeito MEXE NO FOCO: ao entrar, foca o diálogo; ao sair, devolve o
  // foco a quem abriu o modal. Então ele só pode rodar DUAS VEZES na vida
  // do modal — uma ao abrir, uma ao fechar.
  //
  // `aoFechar` chega como arrow function inline de quem usa o modal
  // (`aoFechar={() => setRascunho(null)}`), e arrow inline tem identidade
  // NOVA a cada render. Se ela entrasse na lista de dependências, cada
  // tecla digitada num campo do modal mudaria o estado, provocaria render,
  // criaria uma `aoFechar` nova, e o efeito seria limpo e refeito — a
  // limpeza devolvendo o foco ao botão que abriu o modal. Era exatamente
  // isso: digitava-se uma letra e o foco saía do campo.
  //
  // Guardar a função numa ref separa as duas coisas: o LISTENER continua
  // sendo montado uma vez só, e ainda assim chama sempre a versão mais
  // recente da função. É a única razão da ref — não é otimização.
  const aoFecharRef = useRef(aoFechar);
  // Sem lista de dependências: roda depois de TODO render, e é só uma
  // atribuição. Atualizar a ref aqui, e não durante o render, é o que
  // mantém o render livre de efeito colateral.
  useEffect(() => {
    aoFecharRef.current = aoFechar;
  });

  useEffect(() => {
    if (!aberto) return;

    focoAnterior.current = document.activeElement as HTMLElement | null;

    const fecharComEsc = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") aoFecharRef.current();
    };
    document.addEventListener("keydown", fecharComEsc);

    // O fundo não pode rolar junto: num formulário longo (a solicitação
    // tem seis blocos), rolar o modal levava a página inteira junto e
    // perdia-se a posição ao fechar.
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // O foco entra no diálogo — sem isso, o Tab continuaria percorrendo a
    // tela de trás, que está visualmente coberta.
    dialogo.current?.focus();

    return () => {
      document.removeEventListener("keydown", fecharComEsc);
      document.body.style.overflow = overflowAnterior;
      focoAnterior.current?.focus();
    };
    // `aberto` é a ÚNICA dependência de propósito — ver o comentário acima.
  }, [aberto]);

  if (!aberto) return null;

  return (
    <div
      className="modal-overlay active"
      // Clique no fundo fecha; clique DENTRO do modal não — daí o
      // `=== currentTarget`. Sem essa checagem, soltar o mouse fora
      // depois de selecionar texto dentro do formulário o fecharia.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div
        ref={dialogo}
        className={`modal modal-${tamanho}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 id={idTitulo}>{titulo}</h2>
          <button className="modal-close" type="button" onClick={aoFechar} aria-label="Fechar">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {rodape ? <div className="modal-footer">{rodape}</div> : null}
      </div>
    </div>
  );
}
