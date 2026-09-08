"use client";

// Voltar e imprimir. Client Component porque `window.print()` só existe no
// navegador — é a única razão de este arquivo existir separado da página.
//
// A impressão usa o print do próprio navegador: o `@media print` do
// style.css esconde tudo que não está dentro de #checklistFolha, então o
// que sai no papel é só a folha.

import Link from "next/link";

export function BotoesDoChecklist({ voltarPara }: { voltarPara: string }) {
  return (
    <>
      <Link className="btn btn-ghost btn-sm" href={voltarPara}>
        ← Voltar
      </Link>
      <button className="btn btn-primary btn-sm" type="button" onClick={() => window.print()}>
        Imprimir
      </button>
    </>
  );
}
