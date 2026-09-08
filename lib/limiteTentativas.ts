// ═══════════════════════════════════════════════════════════════════════
//  LIMITE DE TENTATIVAS DE LOGIN — em memória do processo.
//
//  Sem Redis e sem dependência nova, pensado para o estágio atual do
//  produto (um app Next.js atrás do Vercel, tráfego interno da Seteg).
//
//  ── POR QUE SÓ POR IP, E NÃO POR IP + USUÁRIO ──
//
//  O clockrview trava por IP + e-mail, porque lá a pessoa digita quem ela
//  é. Aqui não: o login é um campo só, e é a SENHA que diz quem é a pessoa
//  (`identificar_acesso()` no banco). Não existe identificador para compor
//  a chave — e usar a senha errada digitada como parte da chave seria
//  guardar tentativa de senha na memória do servidor, que é justamente o
//  que não se quer.
//
//  A contrapartida é conhecida: um IP travado trava todo mundo atrás
//  daquele IP. Num escritório com saída NAT única, cinco erros seguidos de
//  uma pessoa atrapalham as outras por 5 minutos. Aceitável para o tamanho
//  do time, e o preço de não ter como separar as tentativas.
//
//  ── ESTA NÃO É A ÚNICA TRAVA ──
//
//  `identificar_acesso()` no banco já tem a sua, por acesso e persistente,
//  e é ela que responde "aguarde N minutos". Esta aqui é anterior: freia a
//  força bruta ANTES de virar consulta ao banco, e cobre o caso de alguém
//  varrer senhas sem nunca acertar nenhum acesso — cenário em que a trava
//  do banco, que é por acesso identificado, não tem em quem pegar.
//
//  ── LIMITAÇÕES ASSUMIDAS ──
//
//   1. Reiniciar o processo (deploy, crash) zera todos os contadores.
//   2. Com várias instâncias, cada uma tem o seu estado. Numa função
//      serverless isso é a regra, não a exceção — o teto real de tentativas
//      é o limite daqui multiplicado pelo número de instâncias quentes.
//      Continua freando força bruta trivial, que é o objetivo.
//   3. `x-forwarded-for` pode ser forjado se não houver proxy confiável na
//      frente reescrevendo o cabeçalho. Na Vercel há; em execução local,
//      não — e localmente isso não importa.
// ═══════════════════════════════════════════════════════════════════════

const JANELA_MS = 5 * 60 * 1000; // 5 minutos para acumular tentativas
const MAX_TENTATIVAS = 8; // tentativas falhas seguidas antes de travar
const BLOQUEIO_MS = 5 * 60 * 1000; // duração da trava

interface Registro {
  falhas: number;
  primeiraFalhaEm: number;
  bloqueadoAte: number | null;
}

const registros = new Map<string, Registro>();

/** Limpeza oportunista, para o Map não crescer sem limite. */
function limparExpirados(agora: number): void {
  for (const [chave, r] of Array.from(registros)) {
    const bloqueioExpirado = !r.bloqueadoAte || r.bloqueadoAte < agora;
    const janelaExpirada = agora - r.primeiraFalhaEm > JANELA_MS;
    if (bloqueioExpirado && janelaExpirada) registros.delete(chave);
  }
}

/** Ver limitação (3) no cabeçalho: sem proxy confiável na frente, este
 *  valor pode ser forjado pelo próprio cliente. */
export function obterIpCliente(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff && xff.trim()) {
    return xff.split(",")[0]?.trim() || "desconhecido";
  }
  const real = request.headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  return "desconhecido";
}

export interface ResultadoLimite {
  bloqueado: boolean;
  /** Segundos até a trava acabar. Presente apenas quando bloqueado. */
  segundosRestantes?: number;
}

/** Consulta sem registrar nada. */
export function verificarLimite(ip: string): ResultadoLimite {
  const agora = Date.now();
  limparExpirados(agora);

  const registro = registros.get(ip);
  if (!registro || !registro.bloqueadoAte) return { bloqueado: false };
  if (registro.bloqueadoAte > agora) {
    return { bloqueado: true, segundosRestantes: Math.ceil((registro.bloqueadoAte - agora) / 1000) };
  }
  return { bloqueado: false };
}

export function registrarFalha(ip: string): void {
  const agora = Date.now();
  let registro = registros.get(ip);

  if (!registro || agora - registro.primeiraFalhaEm > JANELA_MS) {
    registro = { falhas: 0, primeiraFalhaEm: agora, bloqueadoAte: null };
  }

  registro.falhas += 1;
  if (registro.falhas >= MAX_TENTATIVAS) registro.bloqueadoAte = agora + BLOQUEIO_MS;
  registros.set(ip, registro);
}

/**
 * Acerto limpa o contador daquele IP: não se carrega "dívida" de erros
 * anteriores para penalizar um login legítimo depois. Uma trava já
 * disparada continua valendo até expirar — mas este caminho só é
 * alcançado quando não há trava ativa.
 */
export function registrarSucesso(ip: string): void {
  registros.delete(ip);
}
