"use client";

// ═══════════════════════════════════════════════════════════════════════
//  CAMPOS DE FORMULÁRIO
//
//  As máscaras da versão anterior liam e escreviam `el.value` direto
//  (`mascaraMoedaEl(this)` no `oninput` do HTML). Aqui elas são funções
//  PURAS (lib/formato.ts) e o campo é controlado: o mesmo texto de entrada
//  produz o mesmo texto de saída, e dá para testar sem DOM.
//
//  As classes (.form-group, .form-label, .form-control, .required) são as
//  do design system compartilhado — nada de estilo novo.
// ═══════════════════════════════════════════════════════════════════════

import { useId, type ReactNode } from "react";
import {
  mascararCpf,
  mascararData,
  mascararHora,
  mascararMoeda,
  mascararTelefone,
} from "@/lib/formato";

interface GrupoProps {
  rotulo: string;
  obrigatorio?: boolean;
  /** Ocupa a linha inteira do grid (.full-width). */
  largo?: boolean;
  dica?: ReactNode;
  children: (id: string) => ReactNode;
}

/** O invólucro: rótulo, marca de obrigatório e dica. O `id` é gerado e
 *  entregue ao filho, para o `<label htmlFor>` funcionar sem ninguém
 *  inventar ids à mão (era o que os `sNome`, `sSetor` etc. eram). */
export function Grupo({ rotulo, obrigatorio, largo, dica, children }: GrupoProps) {
  const id = useId();
  return (
    <div className={`form-group${largo ? " full-width" : ""}`}>
      <label className={`form-label${obrigatorio ? " required" : ""}`} htmlFor={id}>
        {rotulo}
      </label>
      {children(id)}
      {dica ? <span className="form-hint">{dica}</span> : null}
    </div>
  );
}

type TipoDeMascara = "data" | "hora" | "cpf" | "telefone" | "moeda";

const MASCARAS: Record<TipoDeMascara, (v: string) => string> = {
  data: mascararData,
  hora: mascararHora,
  cpf: mascararCpf,
  telefone: mascararTelefone,
  moeda: mascararMoeda,
};

/**
 * O teto de caracteres do campo. É a SEGUNDA barreira, e as duas importam:
 * a máscara corta o dígito a mais ao digitar, e o `maxLength` corta o que
 * chega colado da área de transferência — colar não passa pelo caminho de
 * quem digita.
 *
 * 15 no telefone é `(00) 00000-0000` inteiro: dois do DDD, nove do número e
 * os quatro caracteres de formatação.
 */
const TAMANHOS: Record<TipoDeMascara, number> = {
  data: 10,
  hora: 5,
  cpf: 14,
  telefone: 15,
  moeda: 20,
};

const PLACEHOLDERS: Record<TipoDeMascara, string> = {
  data: "00/00/0000",
  hora: "00:00",
  cpf: "000.000.000-00",
  telefone: "(00) 00000-0000",
  moeda: "0,00",
};

interface CampoMascaradoProps {
  id?: string;
  mascara: TipoDeMascara;
  valor: string;
  aoMudar: (valor: string) => void;
  placeholder?: string;
  desabilitado?: boolean;
  className?: string;
}

export function CampoMascarado({
  id,
  mascara,
  valor,
  aoMudar,
  placeholder,
  desabilitado,
  className = "form-control",
}: CampoMascaradoProps) {
  return (
    <input
      id={id}
      type="text"
      className={className}
      // `inputMode="numeric"` faz o celular abrir o teclado de números —
      // as quatro máscaras aceitam só dígitos e separadores.
      inputMode="numeric"
      maxLength={TAMANHOS[mascara]}
      placeholder={placeholder ?? PLACEHOLDERS[mascara]}
      value={valor}
      disabled={desabilitado}
      onChange={(e) => aoMudar(MASCARAS[mascara](e.target.value))}
    />
  );
}

interface RadioProps<T extends string> {
  nome: string;
  valor: T;
  opcoes: readonly { valor: T; rotulo: string }[];
  aoMudar: (valor: T) => void;
}

/** As "pílulas" de escolha única (.radio-pill) — tipo de recurso, precisa
 *  de veículo, exige SST. */
export function GrupoDeRadio<T extends string>({ nome, valor, opcoes, aoMudar }: RadioProps<T>) {
  return (
    <div className="radio-group">
      {opcoes.map((o) => (
        <label key={o.valor} className="radio-pill" data-val={o.valor}>
          <input
            type="radio"
            name={nome}
            value={o.valor}
            checked={valor === o.valor}
            onChange={() => aoMudar(o.valor)}
          />
          <span className="radio-pill-label">{o.rotulo}</span>
        </label>
      ))}
    </div>
  );
}

interface CaixaProps {
  marcada: boolean;
  aoMudar: (marcada: boolean) => void;
  children: ReactNode;
  desabilitada?: boolean;
}

export function Caixa({ marcada, aoMudar, children, desabilitada }: CaixaProps) {
  return (
    <label className="conf-check">
      <input
        type="checkbox"
        checked={marcada}
        disabled={desabilitada}
        onChange={(e) => aoMudar(e.target.checked)}
      />{" "}
      {children}
    </label>
  );
}

/** Bloco de seção do formulário, com o título e o ícone. */
export function Secao({
  titulo,
  icone,
  children,
}: {
  titulo: string;
  icone?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="form-section-block">
      <h4 className="form-subtitle">
        {icone}
        {titulo}
      </h4>
      {children}
    </div>
  );
}
