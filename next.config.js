// ═══════════════════════════════════════════════════════════════════════
//  Cabeçalhos de segurança — a CSP calibrada para o que o app REALMENTE
//  usa hoje, e não uma lista copiada.
//
//  A mudança mais importante em relação ao vercel.json da versão estática:
//  `connect-src` voltou a ser só 'self'. Antes o navegador falava direto
//  com o Supabase e com api.clockify.me, e as duas origens precisavam
//  estar liberadas — o que também significava que a chave do Clockify
//  viajava no cabeçalho de uma requisição feita pelo navegador e aparecia
//  para quem abrisse o DevTools. Agora quem fala com os dois é o servidor
//  (lib/supabaseServidor.ts e lib/clockify.ts); o navegador só fala com o
//  próprio app. A chave saiu do alcance do cliente de verdade, não só do
//  repositório.
//
//  Fontes (Satoshi) e ícones são servidos de /public — nenhum CDN externo,
//  então nada de font-src/style-src apontando para fora.
// ═══════════════════════════════════════════════════════════════════════

const emProducao = process.env.NODE_ENV === "production";

// 'unsafe-inline' em script-src: o Next injeta scripts inline próprios
// (bootstrap do runtime, __NEXT_DATA__, flight data do App Router) sem
// nonce configurado. 'unsafe-eval' é exclusivo de desenvolvimento — o
// HMR/fast refresh do webpack depende de eval; o bundle de produção não.
const scriptSrc = ["'self'", "'unsafe-inline'"];
if (!emProducao) scriptSrc.push("'unsafe-eval'");

// `frame-ancestors 'none'` em produção (RNF: o app não deve ser
// embutível). Em desenvolvimento fica 'self' porque o painel de preview
// de alguns editores embute a página num iframe — bloqueado, ele lê como
// "não carregou" e entra em reload infinito.
const diretivasCsp = [
  "default-src 'self'",
  `script-src ${scriptSrc.join(" ")}`,
  // React inline styles (style={{...}}) chegam como atributo `style`, que
  // é coberto por 'unsafe-inline' — o CSS do app é um arquivo só,
  // servido de 'self'.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  // data:/blob: por causa da assinatura desenhada em <canvas>, que vira um
  // PNG em data URL antes de subir (ver app/conferencia/Assinatura.tsx).
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  emProducao ? "frame-ancestors 'none'" : "frame-ancestors 'self'",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: false },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          ...(emProducao ? [{ key: "X-Frame-Options", value: "DENY" }] : []),
          // HSTS só em produção: em http://localhost forçaria o navegador a
          // tentar HTTPS numa porta sem certificado. Sem `preload` de
          // propósito — entrar na lista dos navegadores é praticamente
          // irreversível. Sem `includeSubDomains` porque não há confirmação
          // de que todo subdomínio de setegce.com serve HTTPS.
          ...(emProducao ? [{ key: "Strict-Transport-Security", value: "max-age=15552000" }] : []),
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Content-Security-Policy", value: diretivasCsp.join("; ") },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
