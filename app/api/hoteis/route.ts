// POST /api/hoteis — cadastra hotel ou pousada.
//
// Cadastrar é de qualquer usuário ativo (a RLS de `hoteis` permite);
// EXCLUIR é só da Gestão, e isso é decidido lá, não aqui — ver
// app/api/hoteis/[id]/route.ts.

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";
import { corpoJson } from "@/lib/validacao";
import { validarHotel } from "@/app/api/hoteis/validacao";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const autorizacao = await autorizarApi("/api/hoteis");
  if (!autorizacao.ok) return autorizacao.resposta;

  const corpo = await corpoJson(request);
  if (!corpo) return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });

  const validacao = validarHotel(corpo);
  if (!validacao.ok) return NextResponse.json({ error: validacao.erro }, { status: 400 });

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);
  const { data, error } = await sb.from("hoteis").insert(validacao.dados).select("id").single();

  if (error) {
    // `hoteis_unico` (nome + município + UF) vira "Já existe um hotel com
    // este nome neste município" — ver lib/erros.ts.
    return NextResponse.json(
      { error: mensagemDeErro(error, "salvar o hotel") },
      { status: statusDoErro(error) }
    );
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
