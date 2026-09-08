// ═══════════════════════════════════════════════════════════════════════
//  POST /api/solicitacoes — abre uma solicitação de campo.
//
//  O que NÃO é enviado daqui, e por quê:
//
//   · `codigo`  — vem de sequence no banco (SC-0001), como o EST-0001 do
//     estoque. Dois pedidos simultâneos não recebem o mesmo número.
//   · `status`  — o trigger decide. Quem pede sendo o próprio líder do
//     projeto não espera por si mesmo: nasce `Aprovada`. Mandar status
//     daqui seria uma suposição que o banco ignoraria.
//   · `solicitante_id` / `solicitante_nome` — carimbados por trigger a
//     partir de `auth.uid()`. É o que impede alguém abrir pedido em nome
//     de outra pessoa.
//   · totais, desvio, status de curso e identificação de SST — calculados
//     por trigger.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { carregarDados } from "@/lib/dados";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";
import { validarSolicitacao } from "@/app/api/solicitacoes/validacao";
import {
  cabecalhoDe,
  desfazerSolicitacaoNova,
  gravarFilhas,
  reservarMaterial,
} from "@/app/api/solicitacoes/persistencia";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const autorizacao = await autorizarApi("/api/solicitacoes");
  if (!autorizacao.ok) return autorizacao.resposta;
  const { usuario } = autorizacao;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const sb = clienteDoUsuario(usuario.accessToken);

  // Os projetos são lidos do banco, e não aceitos do corpo: é o cadastro
  // que diz se o projeto existe, está ativo e TEM LÍDER — e é o líder que
  // define quem aprova. Confiar no que o cliente mandou aqui deixaria
  // abrir campo em projeto inativo ou sem quem decidisse.
  const dados = await carregarDados(usuario.accessToken);

  const validacao = validarSolicitacao(corpo, dados.projetos);
  if (!validacao.ok) {
    return NextResponse.json({ error: validacao.erro }, { status: 400 });
  }

  let id: string | null = null;

  try {
    const { data, error } = await sb
      .from("solicitacoes")
      .insert(cabecalhoDe(validacao.dados))
      .select("id")
      .single();
    if (error) throw error;
    id = data.id as string;

    const v2Completa = await gravarFilhas(sb, id, validacao.dados);

    const reservados = validacao.dados.equipamentos.length ? await reservarMaterial(sb, id) : 0;

    // O status REAL vem do banco — o trigger é que sabe se quem pediu
    // lidera o projeto. Suposição daqui contaria a história errada para
    // quem acabou de enviar.
    const { data: gravada } = await sb
      .from("solicitacoes")
      .select("codigo,status")
      .eq("id", id)
      .maybeSingle();

    return NextResponse.json(
      {
        id,
        codigo: gravada?.codigo ?? null,
        status: gravada?.status ?? null,
        reservados,
        v2Completa,
      },
      { status: 201 }
    );
  } catch (erro) {
    // A reserva é o único passo que pode falhar DEPOIS de a solicitação já
    // existir. Deixar o pedido de pé sem material reservado seria pior do
    // que não ter criado nada — ver `desfazerSolicitacaoNova`.
    if (id) {
      await desfazerSolicitacaoNova(sb, id, mensagemDeErro(erro, "reservar o material"));
    }
    console.error("[POST /api/solicitacoes]", erro);
    return NextResponse.json(
      { error: mensagemDeErro(erro, "registrar a solicitação") },
      { status: statusDoErro(erro) }
    );
  }
}
