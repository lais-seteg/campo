"use client";

// ═══════════════════════════════════════════════════════════════════════
//  BARRA LATERAL — a navegação, o tema e o sair.
//
//  As classes (.sidebar, .sidebar-btn, .nav-badge, .theme-toggle) são as
//  mesmas do Controle de Estoque: os dois sistemas têm de continuar
//  parecidos, porque é a mesma leitura pelas mesmas pessoas.
//
//  Quem decide quais abas aparecem é lib/navegacao.ts, e a decisão chega
//  pronta do servidor — o cliente não recalcula permissão. A aba ativa sai
//  do `usePathname()`, e não de um `STATE.secaoAtiva` global: quem manda
//  na tela agora é a URL, o que também devolveu voltar/avançar do
//  navegador e link direto para uma tela, coisas que a versão de aba única
//  não tinha.
// ═══════════════════════════════════════════════════════════════════════

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Icone } from "@/app/components/Icone";
import { useAvisos } from "@/app/components/Avisos";
import type { Aba, ContadoresDoMenu } from "@/lib/navegacao";

const CHAVE_TEMA = "campo_seteg_theme";

interface Props {
  nome: string;
  cargo: string;
  abas: readonly Aba[];
  contadores: ContadoresDoMenu;
}

export function BarraLateral({ nome, cargo, abas, contadores }: Props) {
  const caminho = usePathname();

  return (
    <aside className="sidebar" id="sidebar">
      <div className="sidebar-logo">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG de /public,
            sem otimização a fazer; `next/image` só somaria um wrapper. */}
        <img src="/images/logo-seteg.svg" alt="Seteg" />
        <span className="sidebar-brand-sub">Solicitação de Campo</span>
      </div>

      <nav className="sidebar-nav">
        {abas.map((aba) => {
          const quantidade = aba.contador ? contadores[aba.contador] : 0;
          // `startsWith` porque /solicitacoes/nova e /solicitacoes/<id>
          // continuam sendo a aba Solicitações.
          const ativa = caminho === aba.href || caminho.startsWith(`${aba.href}/`);
          return (
            <Link
              key={aba.chave}
              href={aba.href}
              className={`sidebar-btn${ativa ? " active" : ""}`}
              aria-current={ativa ? "page" : undefined}
              // Em tela estreita o rótulo some e fica só o ícone (ver
              // `.sidebar-btn-label` em globals.css). O `title` é o que
              // devolve o nome da aba no passar do mouse, e o
              // `aria-label` é o que o leitor de tela anuncia — sem os
              // dois, a aba viraria um desenho sem nome.
              title={aba.rotulo}
              aria-label={aba.rotulo}
            >
              <Icone nome={aba.icone} />
              <span className="sidebar-btn-label">{aba.rotulo}</span>
              {quantidade > 0 ? <span className="nav-badge">{quantidade}</span> : null}
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <span className="sidebar-footer-label">
          <strong>{nome}</strong>
          <em>{cargo}</em>
        </span>
        <AlternadorDeTema />
        <BotaoSair />
      </div>
    </aside>
  );
}

function AlternadorDeTema() {
  // Começa em "light" e é corrigido no primeiro efeito. O valor real está
  // no <html data-theme>, escrito pelo script do layout antes da primeira
  // pintura — ler `localStorage` durante a renderização faria o HTML do
  // servidor divergir do cliente e a hidratação reclamaria.
  const [tema, setTema] = useState<"light" | "dark">("light");

  useEffect(() => {
    const atual = document.documentElement.getAttribute("data-theme");
    setTema(atual === "dark" ? "dark" : "light");
  }, []);

  const alternar = useCallback(() => {
    const proximo = tema === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", proximo);
    try {
      localStorage.setItem(CHAVE_TEMA, proximo);
    } catch {
      // Janela anônima com armazenamento bloqueado: o tema vale para esta
      // sessão e não é lembrado. Melhor do que não alternar.
    }
    setTema(proximo);
  }, [tema]);

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={alternar}
      title="Alternar tema claro/escuro"
      aria-label="Alternar tema claro/escuro"
    >
      <div className="theme-toggle-slider">
        {tema === "light" ? <IconeSol /> : <IconeLua />}
      </div>
    </button>
  );
}

function BotaoSair() {
  const roteador = useRouter();
  const { avisar } = useAvisos();
  const [saindo, setSaindo] = useState(false);

  const sair = useCallback(async () => {
    setSaindo(true);
    try {
      // POST, não GET: com sameSite=lax um GET de terceiro deslogaria a
      // pessoa sem que ela pedisse (ver app/api/auth/logout/route.ts).
      const resposta = await fetch("/api/auth/logout", { method: "POST" });
      if (!resposta.ok) throw new Error("logout");
      // `replace` e não `push`: voltar no navegador não pode reabrir a
      // tela de dentro do sistema depois de sair.
      roteador.replace("/login");
      // O layout de dentro é um Server Component com os dados carregados;
      // sem o refresh, o cache do roteador ainda os teria em memória.
      roteador.refresh();
    } catch {
      setSaindo(false);
      avisar("Não foi possível sair. Tente novamente.", "erro");
    }
  }, [roteador, avisar]);

  return (
    <button className="btn-sair" type="button" onClick={sair} disabled={saindo} title="Sair" aria-label="Sair">
      <Icone nome="sair" tamanho={19} />
    </button>
  );
}

function IconeSol() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </g>
    </svg>
  );
}

function IconeLua() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
