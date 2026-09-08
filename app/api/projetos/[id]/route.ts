// PATCH  /api/projetos/[id] — edita o cadastro. EXCLUSIVO DA DIREÇÃO.
// DELETE /api/projetos/[id] — exclui.        EXCLUSIVO DA DIREÇÃO.
//
// ── EXCLUIR PROJETO USADO APAGA HISTÓRIA ──
//
// Não é só perder o rótulo: `solicitacoes.projeto_id` é `on delete set
// null`, então as solicitações antigas perdem o vínculo — e com ele o
// registro de DE QUEM ERA A APROVAÇÃO. O caminho certo é mudar a SITUAÇÃO
// para Stand By, Cancelado ou Finalizado: preserva a história e tira o
// projeto da lista de quem vai pedir.
//
// Por isso a exclusão de um projeto em uso exige `?confirmar=1`: a
// resposta 409 traz quantas solicitações serão afetadas, e a tela mostra
// esse número antes de perguntar.

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { carregarColaboradores, carregarDados } from "@/lib/dados";
import { lideresDisponiveis } from "@/lib/consultas";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";
import { corpoJson } from "@/lib/validacao";
import { validarProjeto } from "@/app/api/projetos/validacao";
import { gravarGastos } from "@/app/api/projetos/persistencia";

export const dynamic = "force-dynamic";

interface Contexto {
  params: { id: string };
}

export async function PATCH(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/projetos/${params.id}`);
  if (!autorizacao.ok) return autorizacao.resposta;

  const corpo = await corpoJson(request);
  if (!corpo) return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });

  // Quem pode ser líder sai do ORGANOGRAMA. O líder ATUAL deste projeto
  // entra como exceção: se ele saiu da lista (desativado, ou com o acesso
  // desligado) enquanto lidera campo em andamento, recusar aqui impediria a
  // Direção de mexer no prazo ou no gasto do projeto sem trocar de líder no
  // mesmo movimento.
  const [{ projetos }, { colaboradores }] = await Promise.all([
    carregarDados(autorizacao.usuario.accessToken),
    carregarColaboradores(autorizacao.usuario.accessToken),
  ]);
  const liderAtual = projetos.find((p) => p.id === params.id)?.lider_id ?? null;

  const validacao = validarProjeto(corpo, lideresDisponiveis(colaboradores), liderAtual);
  if (!validacao.ok) return NextResponse.json({ error: validacao.erro }, { status: 400 });

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);
  const { error } = await sb.from("projetos").update(validacao.dados).eq("id", params.id);

  if (error) {
    return NextResponse.json(
      { error: mensagemDeErro(error, "salvar o projeto") },
      { status: statusDoErro(error) }
    );
  }

  // Os gastos previstos são REESCRITOS (ver persistencia.ts): a tela edita
  // o bloco inteiro e manda a lista como ela está agora.
  const erroDosGastos = await gravarGastos(sb, params.id, validacao.gastos);

  return NextResponse.json({
    ok: true,
    aviso: erroDosGastos
      ? `O projeto foi salvo, mas os gastos previstos não foram gravados (${erroDosGastos}). Tente salvar de novo.`
      : undefined,
  });
}

export async function DELETE(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/projetos/${params.id}`);
  if (!autorizacao.ok) return autorizacao.resposta;

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);

  const { count } = await sb
    .from("solicitacoes")
    .select("id", { count: "exact", head: true })
    .eq("projeto_id", params.id);

  const usos = count ?? 0;
  const confirmado = request.nextUrl.searchParams.get("confirmar") === "1";

  if (usos > 0 && !confirmado) {
    return NextResponse.json(
      {
        error: `Este projeto está em ${usos} solicitação(ões). Excluir desfaz esse vínculo e apaga de quem era a aprovação — o melhor é pôr a situação em Stand By, Cancelado ou Finalizado.`,
        usos,
        precisaConfirmar: true,
      },
      { status: 409 }
    );
  }

  const { error } = await sb.from("projetos").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json(
      { error: mensagemDeErro(error, "excluir o projeto") },
      { status: statusDoErro(error) }
    );
  }
  return NextResponse.json({ ok: true });
}
