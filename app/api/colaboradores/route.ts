// POST /api/colaboradores — cadastra colaborador no organograma.
// EXCLUSIVO DA DIREÇÃO.
//
// A restrição está declarada uma vez, em ROTAS_RESTRITAS (lib/papeis.ts), e
// vale tanto para o middleware quanto para `autorizarApi` aqui — não há uma
// lista de papéis repetida nesta rota, livre para divergir da página.
//
// E ela não é a barreira final: quem barra de verdade é a política do banco
// ("colaboradores: só a Direção cadastra"). Se este código deixasse passar,
// o Postgres recusaria assim mesmo.

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { carregarColaboradores, carregarDados } from "@/lib/dados";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";
import { corpoJson } from "@/lib/validacao";
import { validarColaborador } from "@/app/api/colaboradores/validacao";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const autorizacao = await autorizarApi("/api/colaboradores");
  if (!autorizacao.ok) return autorizacao.resposta;

  const corpo = await corpoJson(request);
  if (!corpo) return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });

  // As duas listas que a validação precisa: os acessos ativos (para o
  // vínculo apontar para alguém que existe) e o organograma como está
  // (para não dar o mesmo acesso a duas pessoas).
  const [{ perfis }, { colaboradores }] = await Promise.all([
    carregarDados(autorizacao.usuario.accessToken),
    carregarColaboradores(autorizacao.usuario.accessToken),
  ]);

  const validacao = validarColaborador(corpo, perfis, colaboradores, null);
  if (!validacao.ok) return NextResponse.json({ error: validacao.erro }, { status: 400 });

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);
  const { data, error } = await sb
    .from("colaboradores")
    .insert(validacao.dados)
    .select("id")
    .single();

  if (error) {
    // `colaboradores_nome_unico` vira "Já existe um colaborador com este
    // nome" e `colaboradores_codigo_unico` vira "Esta matrícula já está em
    // uso" — ver lib/erros.ts.
    return NextResponse.json(
      { error: mensagemDeErro(error, "salvar o colaborador") },
      { status: statusDoErro(error) }
    );
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
