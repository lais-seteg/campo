// Peças de leitura do detalhe: a grade de informação, a marca de "sim/não"
// do quadro de conferência e o título de bloco. Todas as classes vêm do
// design system compartilhado (.info-grid, .modal-subtitle, .status-badge).
//
// Server Components: são só marcação, não vão para o bundle do cliente.

import type { ReactNode } from "react";

export function Info({ rotulo, largo, children }: { rotulo: string; largo?: boolean; children: ReactNode }) {
  return (
    <div className={largo ? "full" : undefined}>
      <span>{rotulo}</span>
      <strong>{children}</strong>
    </div>
  );
}

export function Grade({ children }: { children: ReactNode }) {
  return <div className="info-grid">{children}</div>;
}

/** Só desenha o bloco quando há conteúdo — um título de seção sobre o
 *  vazio faz a tela parecer quebrada. */
export function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <>
      <div className="modal-subtitle">{titulo}</div>
      {children}
    </>
  );
}

/** O "✓" e o "( )" do quadro de conferência do formulário em papel. */
export function Marca({ valor }: { valor: boolean }) {
  return valor ? <span className="status-badge st-ok">✓</span> : <span className="mov-autor">( )</span>;
}

/** Tabela de leitura dentro do detalhe — sem sombra, para não competir
 *  com o cartão que a contém. */
export function TabelaDeLeitura({ colunas, children }: { colunas: readonly string[]; children: ReactNode }) {
  return (
    <div className="table-wrapper" style={{ boxShadow: "none" }}>
      <div className="table-scroll">
        <table className="art-table tabela-centralizada">
          <thead>
            <tr>
              {colunas.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}
