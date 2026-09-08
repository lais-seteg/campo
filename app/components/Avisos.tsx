"use client";

// ═══════════════════════════════════════════════════════════════════════
//  AVISOS (o "toast" do Controle de Estoque)
//
//  Mesma aparência e mesma duração da versão anterior — as classes CSS
//  (.toast, .toast-ok, .toast-err) vêm do design system compartilhado e
//  não foram tocadas.
//
//  O que mudou é como se chama: em vez de uma função global que procura
//  `#toast` no documento, um contexto. `avisar()` funciona de qualquer
//  componente da árvore, sem ninguém precisar saber que existe uma div
//  com esse id — e sem duas telas brigarem pelo mesmo elemento.
// ═══════════════════════════════════════════════════════════════════════

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type TipoDeAviso = "ok" | "erro" | "neutro";

interface Aviso {
  texto: string;
  tipo: TipoDeAviso;
  /** Trocado a cada chamada para reiniciar a animação mesmo com o mesmo texto. */
  chave: number;
}

interface ContextoDeAvisos {
  avisar: (texto: string, tipo?: TipoDeAviso) => void;
}

const Contexto = createContext<ContextoDeAvisos | null>(null);

/** Os mesmos 3,4 s da versão anterior. */
const DURACAO_MS = 3400;

export function ProvedorDeAvisos({ children }: { children: ReactNode }) {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const avisar = useCallback((texto: string, tipo: TipoDeAviso = "neutro") => {
    setAviso({ texto, tipo, chave: Date.now() });
  }, []);

  useEffect(() => {
    if (!aviso) return;
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setAviso(null), DURACAO_MS);
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    };
  }, [aviso]);

  return (
    <Contexto.Provider value={{ avisar }}>
      {children}
      <div
        className={`toast${aviso ? " show" : ""}${classeDoTipo(aviso?.tipo)}`}
        role="status"
        aria-live="polite"
      >
        {aviso?.texto ?? ""}
      </div>
    </Contexto.Provider>
  );
}

function classeDoTipo(tipo: TipoDeAviso | undefined): string {
  if (tipo === "ok") return " toast-ok";
  if (tipo === "erro") return " toast-err";
  return "";
}

/**
 * Lança se usado fora do provedor, em vez de devolver uma função que não
 * faz nada: um aviso que silenciosamente não aparece é um erro que passa
 * despercebido justamente quando alguém precisava ser avisado.
 */
export function useAvisos(): ContextoDeAvisos {
  const contexto = useContext(Contexto);
  if (!contexto) {
    throw new Error("useAvisos precisa estar dentro de <ProvedorDeAvisos> (ver app/layout.tsx).");
  }
  return contexto;
}
