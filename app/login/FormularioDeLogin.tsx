"use client";

// ═══════════════════════════════════════════════════════════════════════
//  O FORMULÁRIO DE LOGIN
//
//  Um campo só, como no Controle de Estoque. A diferença em relação à
//  versão anterior é para onde ele manda a senha: antes, direto para o
//  Supabase, do navegador; agora, para /api/auth/login, que faz a troca no
//  servidor e devolve um cookie httpOnly (ver app/api/auth/login/route.ts).
//
//  É um `<form>` de verdade, com `onSubmit`, e não um botão com listener
//  de clique mais um `keydown` de Enter à parte: o Enter passa a funcionar
//  de graça, e o navegador oferece salvar a senha no gerenciador.
// ═══════════════════════════════════════════════════════════════════════

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

export function FormularioDeLogin({ sessaoInvalida }: { sessaoInvalida: boolean }) {
  const roteador = useRouter();
  const campo = useRef<HTMLInputElement>(null);

  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const [erro, setErro] = useState<string | null>(
    sessaoInvalida ? "Sua sessão expirou. Entre de novo." : null
  );

  useEffect(() => {
    campo.current?.focus();
  }, []);

  async function entrar(evento: FormEvent) {
    evento.preventDefault();
    if (!senha || entrando) return;

    setEntrando(true);
    setErro(null);

    try {
      const resposta = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha }),
      });

      const corpo: unknown = await resposta.json().catch(() => null);

      if (!resposta.ok) {
        // A rota já devolve a frase pronta (inclusive a do bloqueio por
        // tentativas, com os minutos). O cliente não monta mensagem a
        // partir de código de erro — ver lib/erros.ts.
        const mensagem =
          corpo && typeof corpo === "object" && typeof (corpo as { error?: unknown }).error === "string"
            ? (corpo as { error: string }).error
            : "Não foi possível entrar. Tente novamente.";
        setErro(mensagem);
        setSenha("");
        campo.current?.focus();
        return;
      }

      // A senha sai da memória do componente assim que serve.
      setSenha("");
      // `replace` para o botão Voltar não trazer a tela de login de volta
      // já autenticado; `refresh` para o layout do sistema (Server
      // Component) ser renderizado com a sessão nova.
      roteador.replace("/solicitacoes");
      roteador.refresh();
    } catch {
      setErro("Sem conexão com o servidor. Verifique a internet e tente de novo.");
      setEntrando(false);
      return;
    }

    // Não faz `setEntrando(false)` no caminho de sucesso: a navegação já
    // está a caminho, e reabilitar o botão só convidaria a um segundo
    // envio enquanto a tela troca.
  }

  return (
    <form className="lp-fields" onSubmit={entrar} noValidate>
      <label className="lp-field">
        <span className="lp-field-label">Senha</span>
        <div className="lp-field-control">
          <svg
            className="lp-field-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <input
            ref={campo}
            type={mostrarSenha ? "text" : "password"}
            placeholder="Digite sua senha"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            disabled={entrando}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? "loginErro" : undefined}
          />
          <button
            type="button"
            className="lp-toggle-eye"
            onClick={() => setMostrarSenha((v) => !v)}
            aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
            tabIndex={-1}
          >
            {mostrarSenha ? <OlhoFechado /> : <OlhoAberto />}
          </button>
        </div>
      </label>

      {erro ? (
        <p id="loginErro" className="lp-error" role="alert">
          {erro}
        </p>
      ) : null}

      <button type="submit" className="lp-btn-submit" disabled={entrando || !senha}>
        {entrando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

function OlhoAberto() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function OlhoFechado() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
