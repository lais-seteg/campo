"use client";

// Peças de tabela que se repetiam em cinco telas: o cabeçalho de seção, o
// vazio, a paginação e o botão de exportar. Nada aqui é novo — é o mesmo
// HTML que o script.js montava com template string, agora num lugar só.

import type { ReactNode } from "react";
import { montarCsv, nomeDeArquivoCsv } from "@/lib/formato";
import { useAvisos } from "@/app/components/Avisos";

export function CabecalhoDeSecao({ titulo, direita }: { titulo: string; direita?: ReactNode }) {
  return (
    <div className="sec-header">
      <h2>{titulo}</h2>
      {direita ? (
        <div className="sec-header-right">
          <span className="sec-sub">{direita}</span>
        </div>
      ) : null}
    </div>
  );
}

export function TabelaVazia({ visivel, children }: { visivel: boolean; children: ReactNode }) {
  // A classe `.visible` é o que o CSS do design system usa para mostrar o
  // estado vazio; sem ela o bloco fica no DOM mas escondido.
  return (
    <div className={`table-empty${visivel ? " visible" : ""}`}>
      <div className="empty-state">{children}</div>
    </div>
  );
}

interface PaginacaoProps {
  total: number;
  pagina: number;
  porPagina: number;
  aoTrocarPagina: (pagina: number) => void;
  aoTrocarPorPagina: (porPagina: number) => void;
}

export function Paginacao({
  total,
  pagina,
  porPagina,
  aoTrocarPagina,
  aoTrocarPorPagina,
}: PaginacaoProps) {
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));

  return (
    <div className="pagination-container">
      <span className="pagination-info">
        {total} registro{total === 1 ? "" : "s"}
      </span>
      <div className="pagination-controls">
        <button
          className="btn-pagination"
          type="button"
          disabled={pagina <= 1}
          onClick={() => aoTrocarPagina(pagina - 1)}
          aria-label="Página anterior"
        >
          ‹
        </button>
        <span className="page-number">{pagina}</span>
        <button
          className="btn-pagination"
          type="button"
          disabled={pagina >= totalPaginas}
          onClick={() => aoTrocarPagina(pagina + 1)}
          aria-label="Próxima página"
        >
          ›
        </button>
      </div>
      <div className="pagination-per-page">
        <span>por página</span>
        <select value={porPagina} onChange={(e) => aoTrocarPorPagina(Number(e.target.value))}>
          <option>20</option>
          <option>50</option>
          <option>100</option>
        </select>
      </div>
    </div>
  );
}

interface ExportarProps {
  rotulo?: string;
  arquivo: string;
  cabecalho: readonly string[];
  /** Função, e não array: só monta as linhas quando alguém clica. */
  linhas: () => readonly (readonly unknown[])[];
}

/**
 * O CSV é montado e baixado NO NAVEGADOR, como antes. Não virou rota de
 * servidor de propósito: os dados já estão na tela (foi o servidor que os
 * mandou), e uma segunda ida ao banco só para reformatar o que já se tem
 * seria trabalho a mais para o mesmo arquivo.
 */
export function BotaoExportarCsv({ rotulo = "Exportar CSV", arquivo, cabecalho, linhas }: ExportarProps) {
  const { avisar } = useAvisos();

  function exportar() {
    const dados = linhas();
    if (!dados.length) {
      avisar("Nada para exportar com esses filtros.", "erro");
      return;
    }

    const blob = new Blob([montarCsv(cabecalho, dados)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nomeDeArquivoCsv(arquivo);
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button className="btn btn-ghost btn-sm" type="button" onClick={exportar}>
      {rotulo}
    </button>
  );
}

/** A tarja de status (.status-badge) com a cor que a classe dita. */
export function Selo({ texto, classe }: { texto: string; classe: string }) {
  return <span className={`status-badge ${classe}`}>{texto || "—"}</span>;
}
