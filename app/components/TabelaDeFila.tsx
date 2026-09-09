// ═══════════════════════════════════════════════════════════════════════
//  A TABELA DAS TRÊS FILAS — Aprovações, Logística e Conferência
//
//  As três eram uma GRADE DE CARTÕES (`.alerta-card`), e cada cartão
//  repetia em cinco linhas soltas o que a tabela põe em colunas. O
//  problema não era o desenho do cartão, era a comparação: numa fila se
//  pergunta "qual destes decido primeiro?", e para isso os campos
//  precisam ficar alinhados um embaixo do outro. Cartão obriga a ler cada
//  um inteiro para comparar dois.
//
//  É a mesma tabela da aba Solicitações, de propósito — mesmas colunas na
//  mesma ordem, mesmas classes (`art-table tabela-centralizada`), mesmo
//  `.table-scroll`. Quem já lê aquela lista não aprende nada novo aqui; o
//  que muda entre as três telas é só a coluna de AÇÕES.
//
//  ── VALOR SÓ PARA QUEM PODE VER ──
//
//  O cartão mostrava previsto e real a QUALQUER UM que abrisse a fila, e
//  a Conferência abre para todo usuário ativo — então um técnico via o
//  dinheiro do campo ali, mesmo sem poder vê-lo na aba Solicitações. Aqui
//  as três colunas de valor passam por `verValores`, como na lista: a
//  regra de quem vê dinheiro é uma só e vale em toda tela que o mostra.
// ═══════════════════════════════════════════════════════════════════════

import type { ReactNode } from "react";
import { Selo, TabelaVazia } from "@/app/components/Tabela";
import { classeDoCurso, classeDoSst, classeDoStatus } from "@/lib/listas";
import { formatarMoeda } from "@/lib/formato";
import { cursoCurto, equipeResumo, periodoTexto } from "@/lib/consultas";
import type { SolicitacaoDeLista } from "@/lib/tipos";

interface Props {
  fila: readonly SolicitacaoDeLista[];
  /** Espelha `podeVerValores()` — ver o cabeçalho. */
  verValores: boolean;
  /**
   * A coluna de Status só entra onde ela VARIA. Em Aprovações todo mundo
   * está "Aguardando aprovação" e em Logística todo mundo está "Aprovada":
   * ali a coluna seria a mesma palavra repetida em todas as linhas,
   * gastando largura sem responder nada. Na Conferência ela mostra três
   * status diferentes e é justamente o que diz se o pedido está indo ou
   * voltando.
   */
  mostrarStatus?: boolean;
  /** O que cada tela faz com a linha. É a única coisa que muda entre elas. */
  acoes: (s: SolicitacaoDeLista) => ReactNode;
  /** O texto do estado vazio, que em cada fila explica um motivo diferente. */
  vazio: ReactNode;
}

export function TabelaDeFila({ fila, verValores, mostrarStatus = false, acoes, vazio }: Props) {
  return (
    <div className="lista-wrapper">
      <div className="table-wrapper">
        <div className="table-scroll">
          <table className="art-table tabela-centralizada">
            {/* ── AS COLUNAS CABEM NA TELA ──
                Saiu a coluna "Contém" (o resumo do que o pedido tem dentro:
                equipe, veículo, hospedagem, equipamento). Era texto corrido
                de largura imprevisível — "3 na equipe · Veículo (Movida) ·
                Hospedagem em 2 cidade(s) · 4 equipamento(s)" — e sozinha
                empurrava a tabela para fora da tela. A informação não se
                perdeu: está inteira no popup do olho, que é onde se vai
                quando se quer o detalhe.

                Previsto e Real também deixaram de ser duas colunas e viraram
                uma: eles se leem SEMPRE juntos ("quanto era × quanto foi"),
                e separados gastavam duas larguras de dinheiro para dizer uma
                comparação. */}
            <thead>
              <tr>
                <th className="cel-texto">Código</th>
                <th className="cel-texto">Cliente | Projeto</th>
                {/* O PROGRAMA do campo: numa fila de um contrato com quatro
                    programas, é o que separa o campo de fauna do de ruído. */}
                <th className="cel-texto">Escopo</th>
                <th className="cel-texto">Tipo</th>
                <th className="cel-texto">Solicitante</th>
                <th className="cel-texto">Destino</th>
                <th className="cel-texto">Período</th>
                <th className="cel-texto">Equipe</th>
                {verValores ? (
                  <>
                    <th className="cel-num">Previsto × Real</th>
                    <th>Curso</th>
                  </>
                ) : null}
                <th>SST</th>
                {mostrarStatus ? <th>Status</th> : null}
                {/* Coluna própria porque aqui ainda há botão com TEXTO — o
                    Aprovar/Recusar do líder, que é decisão e não pode virar
                    desenho sem nome. Os outros gatilhos (confirmar logística,
                    registrar entrega, checklist, informações) já são ícones de
                    27px, como na lista. */}
                <th className="col-acoes-fila">Ações</th>
              </tr>
            </thead>
            <tbody>
              {fila.map((s) => (
                <tr key={s.id}>
                  <td className="cel-texto cel-inteiro">{s.codigo}</td>
                  <td className="cel-texto">{s.cliente_projeto || "—"}</td>
                  <td className="cel-texto">{s.escopo || "—"}</td>
                  <td className="cel-texto">{s.tipo}</td>
                  <td className="cel-texto">{s.solicitante_nome || "—"}</td>
                  <td className="cel-texto">{s.destino || "—"}</td>
                  <td className="cel-texto">{periodoTexto(s)}</td>
                  <td className="cel-texto">{equipeResumo(s)}</td>
                  {verValores ? (
                    <>
                      <td className="cel-num">
                        {formatarMoeda(s.previsto_total)}
                        <br />
                        {formatarMoeda(s.real_total)}
                      </td>
                      <td>
                        <Selo texto={cursoCurto(s)} classe={classeDoCurso(s.status_curso)} />
                      </td>
                    </>
                  ) : null}
                  <td>
                    <Selo texto={s.sst_identificacao} classe={classeDoSst(s.sst_identificacao)} />
                  </td>
                  {mostrarStatus ? (
                    <td>
                      <Selo texto={s.status} classe={classeDoStatus(s.status)} />
                    </td>
                  ) : null}
                  <td className="table-actions acoes-fila">{acoes(s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <TabelaVazia visivel={fila.length === 0}>{vazio}</TabelaVazia>
        </div>
      </div>
    </div>
  );
}
