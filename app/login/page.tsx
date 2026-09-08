// ═══════════════════════════════════════════════════════════════════════
//  TELA DE LOGIN
//
//  Mesma tela do Controle de Estoque, com o mesmo campo único: a SENHA é
//  o que identifica a pessoa. Quem já entra lá entra aqui com a mesma
//  senha — é o mesmo `identificar_acesso()`, no mesmo banco.
//
//  Esta página fica FORA do grupo `(sistema)`: sem barra lateral e sem
//  exigir sessão.
// ═══════════════════════════════════════════════════════════════════════

import { FormularioDeLogin } from "@/app/login/FormularioDeLogin";
import { LimpezaDeSessao } from "@/app/login/LimpezaDeSessao";

export const dynamic = "force-dynamic";

export default function PaginaDeLogin({
  searchParams,
}: {
  searchParams: { sessao?: string };
}) {
  // `?sessao=invalida` significa que havia um cookie assinado, mas o BANCO
  // o rejeitou (acesso desativado, perfil apagado). Ver o comentário em
  // lib/sessao.ts::exigirSessao — é este parâmetro que impede o
  // pingue-pongue com o middleware.
  const sessaoInvalida = searchParams.sessao === "invalida";

  return (
    <div className="login-screen">
      {sessaoInvalida ? <LimpezaDeSessao /> : null}

      <div className="lp-brand">
        <svg className="lp-bracket lp-bracket-tl" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M0 0 L14 0 M0 0 L0 14" stroke="#ff8200" strokeWidth="1.5" fill="none" />
        </svg>
        <svg className="lp-bracket lp-bracket-bl" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M0 0 L14 0 M0 0 L0 14" stroke="#ff8200" strokeWidth="1.5" fill="none" />
        </svg>
        <div className="lp-brand-line" />

        <div className="lp-brand-center">
          <div className="lp-eyebrow">
            <span className="lp-eyebrow-bar" />
            Módulo corporativo
          </div>

          <div className="lp-logo-wrap">
            <div className="lp-logo-halo-orange" />
            <div className="lp-logo-halo-blue" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="lp-logo-img" src="/images/LOGO.png" alt="Seteg" />
          </div>

          <h1 className="lp-tagline">Solicitação de Campo.</h1>
          <p className="lp-description">
            Recurso financeiro e administrativo para a equipe em campo —<br />
            veículo, hospedagem, diárias e equipamento, com entrega e devolução.
          </p>

          <div className="lp-module-tag">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="15" y2="17" />
            </svg>
            SOLICITAÇÃO DE CAMPO
          </div>
        </div>

        <div className="lp-brand-bottom">
          <div className="lp-contacts">
            <a href="tel:+558521305263">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              +55 (85) 2130-5263
            </a>
            <span className="lp-contacts-divider" />
            <a href="mailto:contato@setegce.com">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              contato@setegce.com
            </a>
          </div>
        </div>
      </div>

      <div className="lp-form">
        <svg className="lp-bracket lp-bracket-tr" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M0 0 L14 0 M0 0 L0 14" stroke="#ff8200" strokeWidth="1.5" fill="none" />
        </svg>
        <svg className="lp-bracket lp-bracket-br" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M0 0 L14 0 M0 0 L0 14" stroke="#ff8200" strokeWidth="1.5" fill="none" />
        </svg>

        <div className="lp-form-center">
          <div className="lp-form-inner">
            <h1 className="lp-form-title">Acesse sua conta</h1>
            <p className="lp-form-subtitle">
              A senha é o que identifica quem está entrando.
              <br />É a mesma do Controle de Estoque.
            </p>

            <FormularioDeLogin sessaoInvalida={sessaoInvalida} />

            <div className="lp-trust">
              <span>
                <svg
                  className="i-green"
                  width="12"
                  height="12"
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
                Conexão criptografada
              </span>
              <span>© 2026 Seteg</span>
            </div>

            <div className="lp-first-access">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 5a1.25 1.25 0 1 1 0 2.5A1.25 1.25 0 0 1 12 7zm1 10a1 1 0 0 1-2 0v-5a1 1 0 0 1 2 0z" />
              </svg>
              <div>
                <div className="lp-first-access-title">Primeiro acesso?</div>
                <div className="lp-first-access-text">
                  Solicite sua senha à <a href="mailto:contato@setegce.com">Gestão</a>.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
