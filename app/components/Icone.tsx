// ═══════════════════════════════════════════════════════════════════════
//  ÍCONES — mesmo estilo do Controle de Estoque: traço, viewBox 24×24,
//  `currentColor`, sem preenchimento.
//
//  Continua sem biblioteca de ícones e sem CDN, como na versão anterior:
//  meia dúzia de `<path>` não justifica abrir a CSP nem somar um pacote.
//  A diferença é que agora o desenho é um componente tipado em vez de uma
//  string de HTML concatenada — o nome errado vira erro de compilação, e
//  não um ícone que simplesmente não aparece.
//
//  Este arquivo NÃO é "use client": é só marcação, renderiza no servidor
//  e não vai para o bundle do navegador.
// ═══════════════════════════════════════════════════════════════════════

import type { SVGProps } from "react";

const DESENHOS = {
  solicitacoes: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </>
  ),
  calendario: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  ),
  aprovacoes: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </>
  ),
  logistica: (
    <>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </>
  ),
  caminhao: (
    <>
      <rect x="1" y="7" width="15" height="12" rx="1" />
      <path d="M16 11h3.5l2.5 3.5V19h-6" />
      <circle cx="5.5" cy="19.5" r="1.5" />
      <circle cx="17.5" cy="19.5" r="1.5" />
    </>
  ),
  cadastros: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 21v-6h6v6" />
      <line x1="9" y1="10" x2="9.01" y2="10" />
      <line x1="15" y1="10" x2="15.01" y2="10" />
    </>
  ),
  avaria: (
    <>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  painel: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>
  ),
  direcao: <path d="M12 2l3 6 6 .9-4.5 4.3 1.1 6.3L12 16.6 6.4 19.5l1.1-6.3L3 8.9 9 8z" />,
  olho: (
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  olhoFechado: (
    <>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </>
  ),
  lixeira: (
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  checklist: (
    <>
      <path d="M9 11l2 2 4-4" />
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  editar: <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />,
  seta: (
    <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </>
  ),
  cadeado: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  sair: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </>
  ),
  equipe: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  cama: (
    <>
      <path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8" />
      <path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4" />
      <line x1="2" y1="16" x2="22" y2="16" />
    </>
  ),
  caixa: (
    <>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </>
  ),
  dinheiro: (
    <>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  talher: (
    <>
      <path d="M3 2v7c0 1.1.9 2 2 2h1a2 2 0 0 0 2-2V2" />
      <line x1="5.5" y1="11" x2="5.5" y2="22" />
      <path d="M17 2c-1.7 0-3 2.2-3 5s1.3 5 3 5 3-2.2 3-5-1.3-5-3-5z" />
      <line x1="17" y1="12" x2="17" y2="22" />
    </>
  ),
  escudo: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </>
  ),
  grafico: (
    <>
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </>
  ),
  relogio: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  /**
   * A CHAVE INGLESA — o ajuste do campo em andamento.
   *
   * Ferramenta e não "+": o "+" diz "adicionar mais um", e o que se faz
   * aqui é CONSERTAR o pedido enquanto o campo acontece — a diária que
   * faltou porque estendeu, o material que quebrou, o táxi que ninguém
   * previu. Chave inglesa é o desenho universal de "mexer no que já está
   * montado", e é o gesto certo: o pedido está de pé e continua de pé.
   */
  ferramenta: (
    <path d="M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.8 2.8 0 0 1-4-4L15.7 7.3M14.7 6.3l2.6-2.6a4 4 0 0 1 3 8.6" />
  ),
} as const;

export type NomeDeIcone = keyof typeof DESENHOS;

interface Props extends Omit<SVGProps<SVGSVGElement>, "children"> {
  nome: NomeDeIcone;
  tamanho?: number;
}

export function Icone({ nome, tamanho = 16, ...resto }: Props) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      // `aria-hidden` porque todo ícone aqui acompanha um rótulo em texto.
      // Ícone sem rótulo tem `title`/`aria-label` no botão que o contém.
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, verticalAlign: -3, ...resto.style }}
      {...resto}
    >
      {DESENHOS[nome]}
    </svg>
  );
}
