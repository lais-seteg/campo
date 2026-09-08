// PATCH  /api/colaboradores/[id] — edita o cadastro no organograma
// DELETE /api/colaboradores/[id] — exclui
//
// EXCLUSIVO DA DIREÇÃO, pela lista em ROTAS_RESTRITAS e pela política de
// `colaboradores` — que é a barreira de verdade.
//
// ── POR QUE EXCLUIR PEDE CONFIRMAÇÃO ──
//
// Excluir quem LIDERA projeto não quebra a aprovação: `projetos.lider_id`
// aponta para `perfis`, não para cá, e continua valendo. Quebra a EDIÇÃO do
// projeto — o líder atual desaparece da lista de candidatos, e salvar o
// cadastro de novo passaria a exigir escolher outra pessoa. A rota conta
// quantos projetos a pessoa lidera e exige `?confirmar=1`, para o clique
// não ser acidente. A tela mostra o número antes de perguntar.
//
// O caminho certo para quem saiu da empresa é marcar como INATIVO: preserva
// a história e tira a pessoa das listas de escolha.

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { carregarColaboradores, carregarDados } from "@/lib/dados";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";
import { corpoJson } from "@/lib/validacao";
import { validarColaborador } from "@/app/api/colaboradores/validacao";

export const dynamic = "force-dynamic";

interface Contexto {
  params: { id: string };
}

export async function PATCH(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/colaboradores/${params.id}`);
  if (!autorizacao.ok) return autorizacao.resposta;

  const corpo = await corpoJson(request);
  if (!corpo) return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });

  const [{ perfis }, { colaboradores }] = await Promise.all([
    carregarDados(autorizacao.usuario.accessToken),
    carregarColaboradores(autorizacao.usuario.accessToken),
  ]);

  // `params.id` como `idAtual`: sem ele, salvar um colaborador sem trocar
  // nada acusaria "este acesso já é de <ele mesmo>".
  const validacao = validarColaborador(corpo, perfis, colaboradores, params.id);
  if (!validacao.ok) return NextResponse.json({ error: validacao.erro }, { status: 400 });

  // ── TIRAR DA LISTA DE LÍDERES QUEM JÁ LIDERA ──
  //
  // Desativar a pessoa, ou desligar o acesso dela, não desfaz a aprovação
  // dos campos em curso (a RLS lê `projetos.lider_id`, não o organograma),
  // mas tira ela da lista de candidatos — e aí o projeto dela não pode mais
  // ser salvo sem trocar de líder. Recusa aqui, com o número, em vez de
  // deixar o problema aparecer na tela de projetos depois.
  //
  // São só essas duas condições porque estar no organograma já basta para
  // ser candidato: não há mais autorização por pessoa a retirar.
  const antes = colaboradores.find((c) => c.id === params.id);
  const deixaDeSerCandidato =
    !!antes?.perfil_id &&
    antes.ativo &&
    (!validacao.dados.ativo || validacao.dados.perfil_id !== antes.perfil_id);

  if (deixaDeSerCandidato) {
    const sbContagem = clienteDoUsuario(autorizacao.usuario.accessToken);
    const { count } = await sbContagem
      .from("projetos")
      .select("id", { count: "exact", head: true })
      .eq("lider_id", antes.perfil_id);

    const lidera = count ?? 0;
    if (lidera > 0 && request.nextUrl.searchParams.get("confirmar") !== "1") {
      return NextResponse.json(
        {
          error:
            `${antes.nome} lidera ${lidera} projeto(s). Os campos em curso continuam sendo aprovados por ` +
            `ela, mas esses projetos não poderão mais ser salvos sem trocar de líder.`,
          lidera,
          precisaConfirmar: true,
        },
        { status: 409 }
      );
    }
  }

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);
  const { error } = await sb.from("colaboradores").update(validacao.dados).eq("id", params.id);

  if (error) {
    return NextResponse.json(
      { error: mensagemDeErro(error, "salvar o colaborador") },
      { status: statusDoErro(error) }
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/colaboradores/${params.id}`);
  if (!autorizacao.ok) return autorizacao.resposta;

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);

  const { colaboradores } = await carregarColaboradores(autorizacao.usuario.accessToken);
  const colaborador = colaboradores.find((c) => c.id === params.id);
  if (!colaborador) {
    return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  }

  // Quantos projetos esta pessoa lidera. Só faz sentido perguntar de quem
  // tem acesso — sem `perfil_id` ela nunca foi líder de nada.
  let lidera = 0;
  if (colaborador.perfil_id) {
    const { count } = await sb
      .from("projetos")
      .select("id", { count: "exact", head: true })
      .eq("lider_id", colaborador.perfil_id);
    lidera = count ?? 0;
  }

  const confirmado = request.nextUrl.searchParams.get("confirmar") === "1";

  if (lidera > 0 && !confirmado) {
    return NextResponse.json(
      {
        error:
          `${colaborador.nome} lidera ${lidera} projeto(s). A aprovação desses campos continua ` +
          `funcionando, mas ela sai da lista de líderes e esses projetos não poderão mais ser ` +
          `salvos sem trocar de líder — o melhor é marcar como inativa.`,
        lidera,
        precisaConfirmar: true,
      },
      { status: 409 }
    );
  }

  const { error } = await sb.from("colaboradores").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json(
      { error: mensagemDeErro(error, "excluir o colaborador") },
      { status: statusDoErro(error) }
    );
  }
  return NextResponse.json({ ok: true });
}
