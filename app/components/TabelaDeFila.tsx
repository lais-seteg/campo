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
//  ── CADA FILA ESCOLHE SUAS COLUNAS ──
//
//  A tabela é a mesma nas três telas, mas as COLUNAS não: cada fila
//  responde a uma pergunta diferente, e coluna que não ajuda a responder
//  aquela pergunta só gasta largura.
//
//    Aprovações  o líder decide se autoriza — precisa de QUEM pede, PARA
//                QUANDO, COM QUEM e QUANTO CUSTA, mais o SST.
//    Logística   o administrativo fecha carro, hotel e material — precisa
//                de PARA ONDE, QUANDO e QUANTAS PESSOAS. Não precisa do
//                dinheiro: ele não decide o gasto, ele executa.
//    Conferência o material sai e volta — precisa de QUEM vai buscar e do
//                STATUS, que é o que diz se o pedido está saindo ou
//                voltando. Não precisa do período: o que importa é hoje.
//
//  Por isso a lista de colunas vem de FORA, na ordem em que a tela quer.
//  O que cada coluna mostra (e como se alinha) mora aqui, num lugar só —
//  senão a mesma coluna sairia diferente em cada fila.
//
//  ── O QUE SAIU DA TABELA CONTINUA NO OLHO ──
//
//  Nada foi perdido ao encurtar as filas: tipo, período, escopo, curso,
//  SST, equipe nominal, veículo, hospedagem, equipamento e histórico
//  estão INTEIROS no popup do olho (`DetalheEmPopup`), que é onde se vai
//  quando a pergunta deixa de ser "qual destes?" e passa a ser "e este,
//  como está?". A tabela é para comparar; o popup é para conferir.
//
//  ── VALOR SÓ PARA QUEM PODE VER ──
//
//  O cartão mostrava previsto e real a QUALQUER UM que abrisse a fila, e
//  a Conferência abre para todo usuário ativo — então um técnico via o
//  dinheiro do campo ali, mesmo sem poder vê-lo na aba Solicitações. Aqui
//  a coluna de valor passa por `verValores`, como na lista: a regra de
//  quem vê dinheiro é uma só e vale em toda tela que o mostra.
// ═══════════════════════════════════════════════════════════════════════

import type { ReactNode } from "react";
import { Selo, TabelaVazia } from "@/app/components/Tabela";
import { classeDoSst, classeDoStatus } from "@/lib/listas";
import { dataCurtaBR, formatarMoeda } from "@/lib/formato";
import { equipeResumo, periodoTexto } from "@/lib/consultas";
import type { Hotel, SolicitacaoDeLista } from "@/lib/tipos";

/** As colunas que uma fila pode pedir. Ver `COLUNAS` para o que cada uma
 *  mostra. A ORDEM de exibição é a ordem do array que a tela passa. */
export type ColunaDeFila =
  | "codigo"
  | "cliente"
  | "escopo"
  | "solicitante"
  | "destino"
  | "periodo"
  | "equipe"
  | "hospedagem"
  | "valores"
  | "sst"
  | "status";

/** O que uma célula precisa saber além da própria solicitação. Hoje só a
 *  coluna de hospedagem usa — para trocar `hotel_id` pelo NOME da casa,
 *  que é o que se lê. */
interface ContextoDaFila {
  hotelPorId: Map<string, Hotel>;
}

interface Coluna {
  titulo: string;
  /** Classe do `th`. `cel-texto` alinha à esquerda, `cel-num` à direita e
   *  a ausência das duas deixa centralizado (selos). */
  classe?: string;
  /** Classe do `td`, quando difere da do cabeçalho. */
  classeCel?: string;
  celula: (s: SolicitacaoDeLista, ctx: ContextoDaFila) => ReactNode;
  /** Coluna de dinheiro: só entra para quem pode ver valor. */
  soComValores?: boolean;
}

const COLUNAS: Record<ColunaDeFila, Coluna> = {
  // `cel-inteiro` só aqui: código é identificador, e partido ao meio deixa
  // de identificar. As outras células de texto podem quebrar — é isso que
  // mantém a tabela dentro da tela.
  codigo: {
    titulo: "Código",
    classe: "cel-texto",
    classeCel: "cel-texto cel-inteiro",
    celula: (s) => s.codigo,
  },
  cliente: {
    titulo: "Cliente | Projeto",
    classe: "cel-texto",
    celula: (s) => s.cliente_projeto || "—",
  },
  // O PROGRAMA do campo: numa fila de um contrato com quatro programas, é
  // o que separa o campo de fauna do de ruído.
  escopo: {
    titulo: "Escopo",
    classe: "cel-texto",
    celula: (s) => s.escopo || "—",
  },
  solicitante: {
    titulo: "Solicitante",
    classe: "cel-texto",
    celula: (s) => s.solicitante_nome || "—",
  },
  destino: {
    titulo: "Destino",
    classe: "cel-texto",
    celula: (s) => s.destino || "—",
  },
  periodo: {
    titulo: "Período",
    classe: "cel-texto",
    celula: (s) => periodoTexto(s),
  },
  equipe: {
    titulo: "Equipe",
    classe: "cel-texto",
    celula: (s) => equipeResumo(s),
  },
  // ── ONDE A EQUIPE DORME ──
  //
  // Uma linha por cidade, com a casa e as datas DAQUELA hospedagem — que
  // nem sempre são as do campo: quem chega na véspera dorme uma noite a
  // mais que os dias de trabalho.
  //
  // Serve às duas metades da aba Logística. Na fila do que falta fechar,
  // "hotel a definir" é justamente o que se procura — diz qual pedido ainda
  // pede trabalho. Na lista do que já foi confirmado, é o nome da casa e o
  // período, que é o que se lê quando alguém liga perguntando da reserva.
  hospedagem: {
    titulo: "Hospedagem",
    classe: "cel-texto",
    celula: (s, { hotelPorId }) => {
      if (!s.hospedagens.length) return "—";
      return (
        <ul className="cel-lista">
          {s.hospedagens.map((h) => {
            const hotel = h.hotel_id ? hotelPorId.get(h.hotel_id) : undefined;
            const periodo =
              h.entrada && h.saida ? `${dataCurtaBR(h.entrada)} a ${dataCurtaBR(h.saida)}` : "";
            return (
              <li key={h.id}>
                <strong>{h.cidade}</strong>
                <span>{hotel ? hotel.nome : "hotel a definir"}</span>
                {periodo ? <span>{periodo}</span> : null}
              </li>
            );
          })}
        </ul>
      );
    },
  },
  // Previsto e Real numa coluna só, um embaixo do outro: eles se leem
  // SEMPRE juntos ("quanto era × quanto foi"), e separados gastavam duas
  // larguras de dinheiro para dizer uma comparação.
  valores: {
    titulo: "Previsto × Real",
    classe: "cel-num",
    soComValores: true,
    celula: (s) => (
      <>
        {formatarMoeda(s.previsto_total)}
        <br />
        {formatarMoeda(s.real_total)}
      </>
    ),
  },
  sst: {
    titulo: "SST",
    celula: (s) => <Selo texto={s.sst_identificacao} classe={classeDoSst(s.sst_identificacao)} />,
  },
  status: {
    titulo: "Status",
    celula: (s) => <Selo texto={s.status} classe={classeDoStatus(s.status)} />,
  },
};

interface Props {
  fila: readonly SolicitacaoDeLista[];
  /** Espelha `podeVerValores()` — ver o cabeçalho. */
  verValores: boolean;
  /** As colunas desta fila, NA ORDEM em que devem aparecer. */
  colunas: readonly ColunaDeFila[];
  /** Só quem pede a coluna `hospedagem` precisa mandar: é a lista que
   *  traduz `hotel_id` no nome da casa. */
  hoteis?: readonly Hotel[];
  /** O que cada tela faz com a linha. É a única coisa que muda entre elas. */
  acoes: (s: SolicitacaoDeLista) => ReactNode;
  /** O texto do estado vazio, que em cada fila explica um motivo diferente. */
  vazio: ReactNode;
}

export function TabelaDeFila({ fila, verValores, colunas, hoteis = [], acoes, vazio }: Props) {
  // A coluna de dinheiro cai fora inteira — cabeçalho e células — para
  // quem não pode vê-la. Esconder só o valor deixaria a coluna vazia
  // dizendo "existe um número aqui que você não vê", que é pior.
  const visiveis = colunas.filter((c) => !COLUNAS[c].soComValores || verValores);
  // Montado UMA vez para a tabela toda, e não por célula: com trinta linhas
  // e trinta hotéis, o `find` por linha é mil comparações para responder
  // trinta perguntas.
  const contexto: ContextoDaFila = { hotelPorId: new Map(hoteis.map((h) => [h.id, h])) };

  return (
    <div className="lista-wrapper">
      <div className="table-wrapper">
        <div className="table-scroll">
          <table className="art-table tabela-centralizada">
            <thead>
              <tr>
                {visiveis.map((c) => (
                  <th key={c} className={COLUNAS[c].classe}>
                    {COLUNAS[c].titulo}
                  </th>
                ))}
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
                  {visiveis.map((c) => (
                    <td key={c} className={COLUNAS[c].classeCel ?? COLUNAS[c].classe}>
                      {COLUNAS[c].celula(s, contexto)}
                    </td>
                  ))}
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
