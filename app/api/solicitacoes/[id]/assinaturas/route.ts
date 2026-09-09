// ═══════════════════════════════════════════════════════════════════════
//  POST /api/solicitacoes/[id]/assinaturas
//
//  Corpo: { momento: "Retirada" | "Devolução", imagem, nome? }
//
//  ── UMA PESSOA, UMA ASSINATURA ──
//
//  Note o que NÃO está no corpo: o PAPEL. Quem assina não escolhe em que
//  linha assina — `assinar_conferencia()` deduz isso de quem está logado:
//  administrativo (ou Direção) assina a linha do administrativo; quem abriu
//  o pedido ou está na equipe do campo assina a de quem recebe o material.
//
//  Deixar o cliente mandar o papel permitiria a uma só pessoa assinar as
//  duas linhas, que é exatamente o que este desenho existe para impedir.
//  Antes as duas assinaturas eram desenhadas no mesmo aparelho, na mesma
//  transação: provavam que alguém desenhou dois traços, não quem eram.
//
//  A assinatura ENTRA E NÃO SAI: uma por momento e papel, sem update e sem
//  delete. Reenvio bate na chave única e ouve "já foi registrada" — é o
//  comportamento desejado, assinatura que se reescreve não prova nada.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";
import { MOMENTOS_ASSINATURA, type MomentoAssinatura } from "@/lib/tipos";

export const dynamic = "force-dynamic";

/** O mesmo limite da rota de conferência e da coluna no banco: 400 KB de
 *  base64 é muito mais do que um traço de 600×200 precisa, e é o que impede
 *  a assinatura virar upload de foto. */
const IMAGEM_MIN = 200;
const IMAGEM_MAX = 400_000;
const PREFIXO_PNG = "data:image/png;base64,";
const NOME_MAX = 120;

interface Contexto {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/solicitacoes/${params.id}/assinaturas`);
  if (!autorizacao.ok) return autorizacao.resposta;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const c = (corpo ?? {}) as Record<string, unknown>;

  const momento = c.momento as MomentoAssinatura;
  if (!MOMENTOS_ASSINATURA.includes(momento)) {
    return NextResponse.json(
      { error: "Momento inválido. Use Retirada ou Devolução." },
      { status: 400 }
    );
  }

  const imagem = typeof c.imagem === "string" ? c.imagem : "";
  if (!imagem.startsWith(PREFIXO_PNG) || imagem.length < IMAGEM_MIN) {
    return NextResponse.json(
      { error: "Desenhe a assinatura no quadro antes de confirmar." },
      { status: 400 }
    );
  }
  if (imagem.length > IMAGEM_MAX) {
    return NextResponse.json(
      { error: "A assinatura ficou grande demais. Limpe o quadro e assine de novo." },
      { status: 400 }
    );
  }

  const nome = typeof c.nome === "string" ? c.nome.trim() : "";
  if (nome.length > NOME_MAX) {
    return NextResponse.json({ error: "Nome longo demais." }, { status: 400 });
  }

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);

  try {
    // `p_nome` vazio faz a função usar o nome do próprio acesso, que é a
    // resposta certa quando a pessoa assina por si.
    const { error } = await sb.rpc("assinar_conferencia", {
      p_solicitacao: params.id,
      p_momento: momento,
      p_imagem: imagem,
      p_nome: nome || null,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true, momento });
  } catch (erro) {
    console.error(`[POST /api/solicitacoes/${params.id}/assinaturas]`, erro);
    return NextResponse.json(
      { error: mensagemDeErro(erro, "registrar a assinatura") },
      { status: statusDoErro(erro) }
    );
  }
}
