// ═══════════════════════════════════════════════════════════════════════
//  VARIÁVEIS DE AMBIENTE — lidas uma vez, validadas na hora.
//
//  Sem fallback e sem valor embutido: se falta configuração, é melhor
//  quebrar o boot de forma explícita do que subir um app que assina
//  sessão com chave vazia ou que consulta um banco que ninguém pediu.
//
//  ── O QUE MUDOU EM RELAÇÃO À VERSÃO ESTÁTICA ──
//
//  Nenhuma destas variáveis tem prefixo NEXT_PUBLIC_, e isso é o ponto.
//  Antes, `config.js` e `env.js` eram carregados PELO NAVEGADOR: a URL e a
//  chave publishable do Supabase estavam à vista (aceitável — a segurança
//  vem da RLS) e a chave do Clockify também (não aceitável — ela viajava
//  no cabeçalho X-Api-Key de uma requisição feita pelo navegador e
//  aparecia para quem abrisse o DevTools). Agora quem fala com os dois
//  serviços é o servidor, e nada disto chega ao bundle do cliente.
//
//  Este arquivo é importado pelo middleware, que roda em Edge Runtime —
//  por isso ele não pode encostar em nada de Node.
// ═══════════════════════════════════════════════════════════════════════

function obrigatoria(nome: string, valor: string | undefined, porque: string): string {
  if (!valor || !valor.trim()) {
    throw new Error(
      `${nome} não está definida. Configure a variável de ambiente ${nome} ` +
        `(veja .env.example) antes de iniciar a aplicação — ${porque}`
    );
  }
  return valor.trim();
}

/** URL do projeto Supabase (o MESMO do Controle de Estoque). */
export const SUPABASE_URL = obrigatoria(
  "SUPABASE_URL",
  process.env.SUPABASE_URL,
  "sem ela não há banco de dados."
);

/**
 * Chave PUBLISHABLE (`sb_publishable_…`). Continua sendo a chave certa
 * mesmo agora que o acesso é pelo servidor: é ela que faz a requisição
 * passar pela RLS com a identidade do usuário logado.
 *
 * A chave SECRET / service_role NUNCA entra aqui. Ela ignora toda a RLS —
 * seria trocar o modelo de segurança inteiro do banco compartilhado por
 * "confie no código do servidor".
 */
export const SUPABASE_ANON_KEY = obrigatoria(
  "SUPABASE_ANON_KEY",
  process.env.SUPABASE_ANON_KEY,
  "sem ela nenhuma consulta é autorizada."
);

/**
 * Segredo que assina o cookie de sessão (HS256). Gere com:
 *   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
 *
 * Sem ele, qualquer um que lesse o código-fonte forjaria um cookie de
 * qualquer papel, Direção inclusive.
 */
export const SESSION_SECRET = obrigatoria(
  "SESSION_SECRET",
  process.env.SESSION_SECRET,
  "sem ele não é seguro assinar sessões."
);

/**
 * Clockify — OPCIONAL, e de propósito. Sem a chave, o campo Código
 * Clockify fica sem as sugestões e a tela diz o motivo; o código continua
 * podendo ser digitado à mão e nada mais no sistema depende disso.
 * Derrubar o boot por causa de um autocompletar seria desproporcional.
 */
export const CLOCKIFY_API_KEY = (process.env.CLOCKIFY_API_KEY ?? "").trim();

/** Só se a conta tiver mais de um workspace. Em branco, usa o primeiro. */
export const CLOCKIFY_WORKSPACE_ID = (process.env.CLOCKIFY_WORKSPACE_ID ?? "").trim();

export const EM_PRODUCAO = process.env.NODE_ENV === "production";
