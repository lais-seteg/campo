// ═══════════════════════════════════════════════════════════════════════
//  O MENU — quem vê o quê, e em que ordem.
//
//  Módulo puro: recebe papel e "lidera algum projeto?", devolve a lista de
//  abas. Sem DOM, sem React, sem banco — dá para conferir a regra lendo
//  quinze linhas em vez de rastrear `classList.toggle("hidden")` no meio
//  de uma função de render.
//
//  Aba que a pessoa não pode usar não fica na tela. Isso NÃO é a barreira:
//  a barreira é a política do banco (só `direcao` grava em `projetos`) e a
//  checagem de papel nas páginas e rotas. Esconder evita o uso casual e o
//  clique que termina em erro; a RLS impede o resto.
// ═══════════════════════════════════════════════════════════════════════

import type { NomeDeIcone } from "@/app/components/Icone";
import type { Papel } from "@/lib/tipos";
import { ehDirecao, podeAbrirCadastros } from "@/lib/papeis";

export type ChaveDeAba =
  | "solicitacoes"
  | "calendario"
  | "aprovacoes"
  | "logistica"
  | "conferencia"
  | "cadastros"
  | "avarias"
  | "painel"
  | "direcao"
  | "organograma";

export interface Aba {
  chave: ChaveDeAba;
  rotulo: string;
  href: string;
  icone: NomeDeIcone;
  /** Qual contador aparece ao lado, quando maior que zero. */
  contador?: "aprovacoes" | "logistica" | "conferencia" | "avarias";
}

const ABAS: Readonly<Record<ChaveDeAba, Aba>> = {
  solicitacoes: { chave: "solicitacoes", rotulo: "Solicitações", href: "/solicitacoes", icone: "solicitacoes" },
  calendario: { chave: "calendario", rotulo: "Calendário", href: "/calendario", icone: "calendario" },
  aprovacoes: {
    chave: "aprovacoes",
    rotulo: "Aprovações",
    href: "/aprovacoes",
    icone: "aprovacoes",
    contador: "aprovacoes",
  },
  logistica: {
    chave: "logistica",
    rotulo: "Logística",
    href: "/logistica",
    icone: "logistica",
    contador: "logistica",
  },
  conferencia: {
    chave: "conferencia",
    rotulo: "Conferência",
    href: "/conferencia",
    icone: "caminhao",
    contador: "conferencia",
  },
  cadastros: { chave: "cadastros", rotulo: "Cadastros", href: "/cadastros", icone: "cadastros" },
  avarias: { chave: "avarias", rotulo: "Avarias", href: "/avarias", icone: "avaria", contador: "avarias" },
  painel: { chave: "painel", rotulo: "Painel", href: "/painel", icone: "painel" },
  // O RÓTULO é "Projetos" — é o que a aba faz. A `chave` e o `href`
  // continuam `direcao`: são a rota, a restrição em ROTAS_RESTRITAS e a
  // política do banco, e renomear isso trocaria o endereço e a permissão
  // de lugar sem que ninguém tivesse pedido.
  direcao: { chave: "direcao", rotulo: "Projetos", href: "/direcao", icone: "direcao" },
  organograma: { chave: "organograma", rotulo: "Organograma", href: "/organograma", icone: "equipe" },
};

/**
 * A ordem base — vale para todo mundo, Direção inclusive.
 *
 * Três destas são CONDICIONAIS e caem fora para quem não se aplica:
 *
 *   · `aprovacoes` — só para quem lidera algum projeto (quem não lidera
 *     nada não tem o que decidir lá);
 *   · `cadastros`  — do `administrativo`, dono do cadastro de hotel e do
 *     valor da diária, e da Direção;
 *   · `painel`     — só para quem responde por valor (líder,
 *     administrativo, financeiro, Direção).
 *
 * O TÉCNICO comum, que não lidera projeto, fica com cinco abas:
 * Solicitações, Calendário, Logística, Conferência e Avarias.
 */
const ORDEM_PADRAO: readonly ChaveDeAba[] = [
  // O PAINEL VEM PRIMEIRO para quem o tem: é a tela de olhar antes de
  // agir. Quem não vê valor não o tem, e para essa pessoa a primeira aba
  // continua sendo Solicitações — a mesma lista de sempre, sem buraco no
  // topo do menu.
  "painel",
  "solicitacoes",
  "calendario",
  "aprovacoes",
  "logistica",
  "conferencia",
  "cadastros",
  "avarias",
];

/**
 * A Direção vê TUDO: o menu dela é o de todo mundo mais as duas abas que
 * são só dela.
 *
 * Era menor até aqui — Painel, Projetos, Aprovações, Calendário e
 * Organograma —, na premissa de que "a Direção não abre nem acompanha
 * pedido de campo". A premissa estava errada: o acesso da Direção é total,
 * e ela acompanha a operação junto com quem a executa. O banco sempre
 * concordou com isso (`solicitacoes` é de qualquer usuário ativo, e
 * `eh_gestor()` — que libera hotel e diária — já inclui a Direção); quem
 * discordava era só este menu, escondendo cinco telas que a pessoa tinha
 * direito de abrir.
 *
 * PROJETOS vem LOGO DEPOIS DO PAINEL, e não no fim junto com o
 * Organograma: sem projeto cadastrado ninguém abre solicitação, ninguém
 * lidera e ninguém aprova — é a primeira coisa que a Direção faz e a que
 * destrava todo o resto. Fica ao lado do Painel, que é onde ela chega.
 *
 * O ORGANOGRAMA continua por último: é cadastro de base, mexido de vez em
 * quando. As duas existem SÓ aqui — não são abas condicionais filtradas
 * mais abaixo, e é a RLS (supabase/04 e 08) que garante isso de verdade.
 */
const ORDEM_DIRECAO: readonly ChaveDeAba[] = [
  "painel",
  "direcao",
  "solicitacoes",
  "calendario",
  "aprovacoes",
  "logistica",
  "conferencia",
  "cadastros",
  "avarias",
  "organograma",
];

/**
 * @param lideraAlgumProjeto o que acende a aba de Aprovações. Quem não
 *   lidera nada não tem o que decidir lá — ver `ehLider()` em
 *   lib/papeis.ts, que é quem responde isso a partir de `projetos`.
 * @param podeVerPainel o que acende a aba de Painel. O Painel é a tela do
 *   valor consolidado, então ele é de quem responde por valor: líder,
 *   administrativo, financeiro e Direção. Quem não vê valor abriria uma
 *   tela de seis números vazios — ver `podeAbrirPainel()`.
 */
export function abasDoPapel(
  papel: Papel,
  lideraAlgumProjeto: boolean,
  podeVerPainel: boolean
): readonly Aba[] {
  const ordem = ehDirecao(papel) ? ORDEM_DIRECAO : ORDEM_PADRAO;
  return ordem
    .filter((chave) => chave !== "aprovacoes" || lideraAlgumProjeto)
    .filter((chave) => chave !== "painel" || podeVerPainel)
    // Cadastros (hotéis e valor da diária): do administrativo, que opera, e
    // da Direção. Fora do menu do técnico, do líder e do financeiro — e a
    // RLS acompanha, então não é só a aba que sumiu (ver supabase/06 e 07).
    .filter((chave) => chave !== "cadastros" || podeAbrirCadastros(papel))
    .map((chave) => ABAS[chave]);
}

/**
 * Onde o papel cai ao entrar. A Direção cai no Painel — não porque lhe
 * falte a lista de pedidos (ela tem), mas porque a pergunta que ela faz ao
 * entrar é a do todo, e não a do pedido seguinte. Todo o resto cai na
 * lista.
 */
export function abaInicial(papel: Papel): string {
  return ehDirecao(papel) ? "/painel" : "/solicitacoes";
}

/** Os números ao lado das abas. */
export interface ContadoresDoMenu {
  aprovacoes: number;
  logistica: number;
  conferencia: number;
  avarias: number;
}

