// PATCH  /api/hoteis/[id] — edita o cadastro
// DELETE /api/hoteis/[id] — exclui
//
// Hotel usado em pedido antigo NÃO deveria ser apagado: a hospedagem
// perderia o vínculo e o histórico do gasto ficaria sem a casa. O caminho
// certo é marcar como inativo — preserva a história e tira a casa da lista
// de quem vai reservar.
//
// Quem pode excluir é só a Gestão, e quem decide isso é a RLS de `hoteis`.
// A rota não repete a regra: ela conta quantas solicitações usam a casa e
// EXIGE a confirmação explícita (`?confirmar=1`), para o clique não ser
// acidental. A tela mostra o número antes de perguntar.

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";
import { corpoJson } from "@/lib/validacao";
import { validarHotel } from "@/app/api/hoteis/validacao";

export const dynamic = "force-dynamic";

interface Contexto {
  params: { id: string };
}

export async function PATCH(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/hoteis/${params.id}`);
  if (!autorizacao.ok) return autorizacao.resposta;

  const corpo = await corpoJson(request);
  if (!corpo) return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });

  const validacao = validarHotel(corpo);
  if (!validacao.ok) return NextResponse.json({ error: validacao.erro }, { status: 400 });

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);
  const { error } = await sb.from("hoteis").update(validacao.dados).eq("id", params.id);

  if (error) {
    return NextResponse.json(
      { error: mensagemDeErro(error, "salvar o hotel") },
      { status: statusDoErro(error) }
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/hoteis/${params.id}`);
  if (!autorizacao.ok) return autorizacao.resposta;

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);

  // Quantas hospedagens apontam para esta casa. `head: true` traz só a
  // contagem — não há por que puxar as linhas para contá-las aqui.
  const { count } = await sb
    .from("solicitacao_hospedagens")
    .select("id", { count: "exact", head: true })
    .eq("hotel_id", params.id);

  const usos = count ?? 0;
  const confirmado = request.nextUrl.searchParams.get("confirmar") === "1";

  if (usos > 0 && !confirmado) {
    return NextResponse.json(
      {
        error: `Esta casa está em ${usos} solicitação(ões). Excluir desfaz esse vínculo e o histórico do gasto fica sem ela — o melhor é marcar como inativa.`,
        usos,
        precisaConfirmar: true,
      },
      { status: 409 }
    );
  }

  const { error } = await sb.from("hoteis").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json(
      { error: mensagemDeErro(error, "excluir o hotel") },
      { status: statusDoErro(error) }
    );
  }
  return NextResponse.json({ ok: true });
}
