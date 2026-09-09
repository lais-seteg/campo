"use client";

// ═══════════════════════════════════════════════════════════════════════
//  A DICA DO QUE NÃO COUBE
//
//  Toda célula de tabela ocupa UMA linha (ver `.art-table td` no CSS). É
//  isso que dá à tabela a altura regular que faz a fileira ser comparável
//  de cima a baixo: com células de duas e três linhas, cada registro tem
//  uma altura, o olho perde o alinhamento e a grade vira uma pilha de
//  parágrafos.
//
//  O preço é que texto longo não cabe. A resposta não é encolher a fonte
//  nem voltar a quebrar: é CORTAR com "…" e devolver o resto no `title` —
//  a dica que o navegador mostra quando o mouse para em cima.
//
//  ── POR QUE UM SÓ, E NO ALTO ──
//
//  Marcar `title` célula por célula na marcação seria dez arquivos de
//  edição repetida, impossível onde a célula tem JSX dentro (um selo, dois
//  botões), e RUIM: a dica apareceria também nas células curtas, que cabem
//  inteiras. Dica que repete o que já está visível é ruído — ela ensina a
//  pessoa a ignorar as dicas, inclusive as que informam.
//
//  Então a pergunta é feita ao próprio navegador, depois de a tabela estar
//  desenhada: `scrollWidth > clientWidth` significa "tem mais conteúdo do
//  que largura". Só nessas o `title` entra, e ele SAI quando a janela
//  cresce e a célula volta a caber.
//
//  Montado uma vez no layout do sistema, e não por tabela, porque assim
//  alcança também as tabelas dentro dos MODAIS — o painel de logística, a
//  folha de conferência, o previsto × real do olho —, que são justamente as
//  que ninguém lembraria de embrulhar uma a uma.
//
//  ── E SE ISTO NÃO RODAR ──
//
//  Nada quebra. A célula continua cortada com "…" pelo CSS; o que se perde
//  é a dica. Por isso ele não bloqueia renderização nem devolve marcação:
//  é melhoria, não estrutura.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect } from "react";

/** Uma folga de 1px: `scrollWidth` e `clientWidth` diferem por
 *  arredondamento de subpixel em célula que cabe justinha, e sem ela
 *  metade das células ganharia dica repetindo o que já se lê. */
const FOLGA = 1;

/**
 * Quanto se espera parar de mexer antes de medir.
 *
 * Ler `scrollWidth` FORÇA o navegador a calcular o layout na hora. Fazer
 * isso a cada quadro enquanto alguém digita no filtro de uma tabela de
 * trinta linhas é trezentos cálculos de layout por segundo, e a digitação
 * engasga. Esperar a pessoa parar reduz a uma medição por rajada.
 *
 * 120ms é imperceptível para uma dica de mouse — ela só aparece depois de o
 * ponteiro ficar parado por muito mais que isso.
 */
const ESPERA = 120;

export function DicasDaTabela() {
  useEffect(() => {
    let agendado: ReturnType<typeof setTimeout> | null = null;

    function revisar() {
      agendado = null;
      for (const cel of Array.from(document.querySelectorAll<HTMLElement>(".art-table th, .art-table td"))) {
        // A coluna de ações é um flex de BOTÕES, não texto: ali
        // `scrollWidth` mede ícones, e a dica sairia como a emenda dos
        // rótulos — que cada botão já tem no próprio `title`.
        if (cel.classList.contains("table-actions")) continue;

        if (cel.scrollWidth > cel.clientWidth + FOLGA) {
          const texto = montarTexto(cel);
          if (texto) cel.setAttribute("title", texto);
          else cel.removeAttribute("title");
        } else {
          cel.removeAttribute("title");
        }
      }
    }

    /** REINICIA a espera a cada chamada: filtrar uma tabela dispara dezenas
     *  de mutações seguidas, e o que interessa é medir uma vez, no fim. */
    function agendar() {
      if (agendado) clearTimeout(agendado);
      agendado = setTimeout(revisar, ESPERA);
    }

    agendar();
    window.addEventListener("resize", agendar);

    // Só `childList` e `characterData`: observar `attributes` faria o
    // próprio `setAttribute("title", …)` disparar o observador e girar sem
    // parar.
    const observador = new MutationObserver(agendar);
    observador.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      if (agendado) clearTimeout(agendado);
      window.removeEventListener("resize", agendar);
      observador.disconnect();
    };
  }, []);

  return null;
}

/**
 * O texto inteiro da célula, com os separadores que o olho vê.
 *
 * Uma célula montada com partes (`<strong>FORTALEZA</strong><span>Hotel
 * X</span>`) tem `textContent` = "FORTALEZAHotel X" — grudado, porque o
 * separador entre elas é desenhado por `::before` no CSS e pseudo-elemento
 * não é texto. Uma dica assim seria pior que dica nenhuma.
 *
 * Então, quando a célula tem mais de um filho-elemento, o texto é remontado
 * a partir deles. Quando é texto puro — a esmagadora maioria — devolve o
 * próprio.
 */
function montarTexto(cel: HTMLElement): string {
  const partes = Array.from(cel.children)
    .map((f) => f.textContent?.trim() ?? "")
    .filter(Boolean);
  if (partes.length > 1) return partes.join(" · ");
  return cel.textContent?.trim() ?? "";
}
