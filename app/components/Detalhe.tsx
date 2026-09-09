// Peças de leitura do detalhe: a grade de informação, a marca de "sim/não"
// do quadro de conferência e o título de bloco. Todas as classes vêm do
// design system compartilhado (.info-grid, .modal-subtitle, .status-badge).
//
// Server Components: são só marcação, não vão para o bundle do cliente.

import type { ReactNode } from "react";

/**
 * Um campo da grade de informação.
 *
 * `largo` ocupa a LINHA INTEIRA — para texto corrido que não tem tamanho
 * previsível (observação, motivo de recusa, dados de transferência).
 *
 * `duplo` ocupa DUAS COLUNAS. Existe para o caso do meio: campo comprido
 * demais para uma coluna de 180px, mas que não deveria tomar a linha toda
 * porque tem um PAR natural ao lado dele — recebimento e entrega do
 * veículo, que se leem comparando um com o outro. Com `largo` os dois
 * empilhavam e a comparação exigia subir e descer o olho.
 *
 * Na tela estreita o grid encolhe as duas colunas para uma e eles voltam a
 * empilhar sozinhos, o que é o certo lá.
 */
export function Info({
  rotulo,
  largo,
  duplo,
  children,
}: {
  rotulo: string;
  largo?: boolean;
  duplo?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={largo ? "full" : duplo ? "duplo" : undefined}>
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
