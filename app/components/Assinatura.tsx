"use client";

// ═══════════════════════════════════════════════════════════════════════
//  A ASSINATURA DESENHADA NA TELA
//
//  As quatro assinaturas do papel — administrativo e prestador, na
//  retirada e na devolução — deixam de ser um nome digitado e passam a ser
//  o traço feito com o dedo, no celular, na hora da conferência.
//
//  Sem biblioteca, como na versão anterior: é um `<canvas>` com eventos de
//  ponteiro, e o mesmo código serve para dedo, caneta e mouse. Meia dúzia
//  de linhas não justifica somar um pacote — nem, antes, abrir a CSP para
//  um CDN por causa de um rabisco.
//
//  A imagem sai como PNG em data URL, com FUNDO BRANCO pintado antes: PNG
//  transparente fica invisível quando o checklist é impresso.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";

export interface ControleDaAssinatura {
  /** PNG em data URL, ou `null` se o quadro está em branco. */
  capturar: () => string | null;
  limpar: () => void;
}

interface Props {
  rotulo: string;
}

export const Assinatura = forwardRef<ControleDaAssinatura, Props>(function Assinatura({ rotulo }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const desenhou = useRef(false);
  const [temTraco, setTemTraco] = useState(false);

  const contexto = useCallback((): CanvasRenderingContext2D | null => {
    const ctx = canvas.current?.getContext("2d") ?? null;
    if (!ctx) return null;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
    return ctx;
  }, []);

  const limpar = useCallback(() => {
    const el = canvas.current;
    const ctx = contexto();
    if (!el || !ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    desenhou.current = false;
    setTemTraco(false);
  }, [contexto]);

  useImperativeHandle(
    ref,
    () => ({
      limpar,
      capturar() {
        const el = canvas.current;
        if (!el || !desenhou.current) return null;
        // Fundo branco pintado num canvas à parte, para não sujar o que
        // está na tela nem impedir de continuar desenhando depois.
        const plano = document.createElement("canvas");
        plano.width = el.width;
        plano.height = el.height;
        const ctx = plano.getContext("2d");
        if (!ctx) return null;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, plano.width, plano.height);
        ctx.drawImage(el, 0, 0);
        return plano.toDataURL("image/png");
      },
    }),
    [limpar]
  );

  useEffect(() => {
    const el = canvas.current;
    const ctx = contexto();
    if (!el || !ctx) return;

    let desenhando = false;

    // O canvas tem tamanho fixo em pixels e é esticado por CSS; sem esta
    // conversão o traço sai deslocado do dedo.
    const ponto = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (el.width / r.width),
        y: (e.clientY - r.top) * (el.height / r.height),
      };
    };

    const comecar = (e: PointerEvent) => {
      desenhando = true;
      el.setPointerCapture(e.pointerId);
      const p = ponto(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      // Um toque sem arrastar também é traço — assinatura com pingo existe.
      ctx.lineTo(p.x + 0.1, p.y);
      ctx.stroke();
      desenhou.current = true;
      setTemTraco(true);
    };

    const mover = (e: PointerEvent) => {
      if (!desenhando) return;
      // `preventDefault` mantém o gesto no quadro em vez de rolar a
      // página — é o que faz assinar no celular funcionar.
      e.preventDefault();
      const p = ponto(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    };

    const soltar = () => {
      desenhando = false;
    };

    el.addEventListener("pointerdown", comecar);
    // `passive: false` porque o handler chama `preventDefault` — sem isso
    // o navegador o ignora em eventos de toque.
    el.addEventListener("pointermove", mover, { passive: false });
    el.addEventListener("pointerup", soltar);
    el.addEventListener("pointercancel", soltar);
    el.addEventListener("pointerleave", soltar);

    return () => {
      el.removeEventListener("pointerdown", comecar);
      el.removeEventListener("pointermove", mover);
      el.removeEventListener("pointerup", soltar);
      el.removeEventListener("pointercancel", soltar);
      el.removeEventListener("pointerleave", soltar);
    };
  }, [contexto]);

  return (
    <div className="assin-bloco">
      <div className="assin-topo">
        <strong>{rotulo}</strong>
        <button className="btn btn-ghost btn-sm" type="button" onClick={limpar}>
          Limpar
        </button>
      </div>
      <canvas ref={canvas} className="assin-canvas" width={600} height={200} />
      <span className="assin-legenda">
        {temTraco ? "Assinado — use Limpar para refazer" : "Assine no quadro acima"}
      </span>
    </div>
  );
});
