import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ProvedorDeAvisos } from "@/app/components/Avisos";

export const metadata: Metadata = {
  title: "Solicitação de Campo · Seteg",
  description:
    "Recurso financeiro e administrativo para a equipe em campo — veículo, hospedagem, diárias e equipamento, com entrega e devolução.",
  icons: { icon: "/images/favicon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Aplica o tema ANTES da primeira pintura.
 *
 * O tema mora no `localStorage`, que só existe no navegador — um Server
 * Component não tem como saber qual escolher. Sem este script, a página
 * sairia sempre no claro e piscaria para o escuro quando o React
 * hidratasse. Ele roda síncrono, no `<head>`, antes de qualquer pixel.
 *
 * O `try` existe porque `localStorage` lança em janela anônima com
 * cookies bloqueados, e um throw aqui abortaria o parse do documento.
 */
const SCRIPT_TEMA = `
try {
  var t = localStorage.getItem("campo_seteg_theme") || "light";
  document.documentElement.setAttribute("data-theme", t);
} catch (e) {
  document.documentElement.setAttribute("data-theme", "light");
}
`;

export default function LayoutRaiz({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="light">
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body>
        {/* As fontes (Satoshi) são servidas de /public — nenhum CDN
            externo, como na versão anterior. É o que mantém `font-src`
            e `style-src` restritos a 'self' na CSP. */}
        <ProvedorDeAvisos>{children}</ProvedorDeAvisos>
      </body>
    </html>
  );
}
