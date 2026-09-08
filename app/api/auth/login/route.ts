// ═══════════════════════════════════════════════════════════════════════
//  POST /api/auth/login
//
//  O login continua sendo um campo só: a SENHA diz quem é a pessoa, e quem
//  compara é o banco (`identificar_acesso`). É o mesmo login do Controle de
//  Estoque — quem entra lá entra aqui.
//
//  O que mudou é onde isso acontece. Antes o navegador chamava
//  `identificar_acesso` e `signInWithPassword` direto no Supabase e o
//  supabase-js guardava os dois tokens no `localStorage`, ao alcance de
//  qualquer XSS. Agora a troca inteira acontece aqui, e o que volta para o
//  navegador é um cookie httpOnly — que JavaScript de página não lê.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from "next/server";
import { clienteAnonimo, clienteDoUsuario } from "@/lib/supabaseServidor";
import { COOKIE_SESSAO, assinarSessao, opcoesDoCookie } from "@/lib/token";
import { obterIpCliente, registrarFalha, registrarSucesso, verificarLimite } from "@/lib/limiteTentativas";
import { extrairTokens } from "@/lib/supabaseAuthEdge";
import { mensagemDeErro } from "@/lib/erros";
import { EM_PRODUCAO } from "@/lib/ambiente";
import type { Perfil } from "@/lib/tipos";
import { PAPEIS } from "@/lib/tipos";

export const dynamic = "force-dynamic";

/** Teto generoso, só para recusar cedo um corpo absurdo. Não é política de
 *  senha — quem define a senha é a Gestão, no cadastro de acesso. */
const SENHA_MAX = 200;

/** O que `identificar_acesso(p_senha)` devolve. Tipado defensivamente:
 *  a função mora no schema do Controle de Estoque, não neste repositório. */
interface RespostaIdentificacao {
  ok?: boolean;
  email?: string;
  motivo?: string;
  minutos?: number;
}

export async function POST(request: NextRequest) {
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const { senha } = (corpo as { senha?: unknown }) ?? {};

  // Tipo e tamanho ANTES de qualquer outra coisa: sem isso, um corpo
  // malformado só estouraria adiante, depois de já ter feito trabalho.
  if (typeof senha !== "string" || !senha) {
    return NextResponse.json({ error: "Informe a senha de acesso." }, { status: 400 });
  }
  if (senha.length > SENHA_MAX) {
    return NextResponse.json({ error: "Senha acima do tamanho máximo permitido." }, { status: 400 });
  }

  // Freio por IP, anterior ao banco — ver lib/limiteTentativas.ts para as
  // limitações assumidas e por que a chave aqui não pode incluir usuário.
  const ip = obterIpCliente(request);
  const limite = verificarLimite(ip);
  if (limite.bloqueado) {
    // Log estruturado, grep-ável: bloqueio de limite é o sinal mais forte
    // de força bruta — o próprio app já decidiu que aquele IP excedeu.
    console.warn(`[SEGURANCA] login_bloqueado ip=${ip}`);
    return NextResponse.json(
      {
        error: `Muitas tentativas seguidas. Aguarde ${limite.segundosRestantes} segundos e tente de novo.`,
      },
      { status: 429 }
    );
  }

  const sb = clienteAnonimo();

  try {
    const { data, error } = await sb.rpc("identificar_acesso", { p_senha: senha });
    if (error) throw error;

    const identificacao = (data ?? {}) as RespostaIdentificacao;

    if (!identificacao.ok || !identificacao.email) {
      registrarFalha(ip);

      // A trava do próprio banco, por acesso e persistente, é a que sabe
      // dizer quantos minutos faltam. Ela e o freio por IP acima cobrem
      // coisas diferentes: esta pega quem insiste num acesso conhecido,
      // aquela pega quem varre senhas sem acertar nenhum.
      if (identificacao.motivo === "bloqueado") {
        console.warn(`[SEGURANCA] login_bloqueado_pelo_banco ip=${ip}`);
        return NextResponse.json(
          {
            error: `Muitas tentativas seguidas. Aguarde ${identificacao.minutos ?? 5} minutos e tente de novo.`,
          },
          { status: 429 }
        );
      }

      console.warn(`[SEGURANCA] login_falhou motivo=senha_invalida ip=${ip}`);
      return NextResponse.json({ error: "Senha inválida. Tente novamente." }, { status: 401 });
    }

    const { data: sessao, error: erroLogin } = await sb.auth.signInWithPassword({
      email: identificacao.email,
      password: senha,
    });
    if (erroLogin || !sessao?.session) {
      // Chegar aqui é incomum: `identificar_acesso` acabou de confirmar a
      // senha. Significa divergência entre `perfis` e `auth.users` — vale
      // um log, não uma pista para quem está tentando entrar.
      registrarFalha(ip);
      console.error(`[SEGURANCA] login_inconsistente ip=${ip}`, erroLogin);
      return NextResponse.json({ error: "Senha inválida. Tente novamente." }, { status: 401 });
    }

    const tokens = extrairTokens(sessao.session);
    if (!tokens) {
      // NUNCA logar `sessao.session`: o objeto carrega o access_token e o
      // refresh_token da pessoa, e o log do servidor costuma ir parar em
      // lugares que a sessão não deveria alcançar (arquivo em disco,
      // agregador, terminal compartilhado numa apresentação). O que
      // interessa para diagnosticar é QUAIS campos faltaram, não o valor
      // deles.
      console.error(
        "[SEGURANCA] sessao_sem_tokens campos=%s",
        Object.keys(sessao.session ?? {}).join(",")
      );
      return NextResponse.json({ error: "Não foi possível iniciar a sessão." }, { status: 500 });
    }

    const perfil = await lerPerfil(tokens.accessToken, sessao.session.user.id);
    if (!perfil || !perfil.ativo) {
      return NextResponse.json(
        { error: "Este acesso está desativado. Procure a Gestão." },
        { status: 403 }
      );
    }

    registrarSucesso(ip);

    const cookie = await assinarSessao({
      id: perfil.id,
      usuario: perfil.usuario,
      nome: perfil.nome,
      papel: perfil.papel,
      cargo: perfil.cargo,
      ...tokens,
    });

    const resposta = NextResponse.json({ ok: true });
    resposta.cookies.set(COOKIE_SESSAO, cookie, opcoesDoCookie(EM_PRODUCAO));
    return resposta;
  } catch (erro) {
    console.error("[POST /api/auth/login]", erro);
    return NextResponse.json({ error: mensagemDeErro(erro, "entrar") }, { status: 500 });
  }
}

/** `select *` de propósito, herdado da versão anterior: coluna nova no
 *  banco compartilhado não pode derrubar o login de um site publicado. */
async function lerPerfil(accessToken: string, id: string): Promise<Perfil | null> {
  const sb = clienteDoUsuario(accessToken);
  const { data, error } = await sb.from("perfis").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;

  const perfil = data as Perfil;
  // Papel fora da lista conhecida seria um perfil de outro sistema (o
  // banco é compartilhado). Recusar é melhor do que deixar `undefined`
  // circular como papel e cair em algum `includes` mais adiante.
  if (!(PAPEIS as readonly string[]).includes(perfil.papel)) return null;
  return perfil;
}
