// PATCH /api/avarias/[id] — fecha o registro de uma avaria.
//
// A avaria NASCE na devolução, com o custo estimado (ver
// .../conferencia/route.ts). Aqui ela é acompanhada até fechar, com o
// custo real — que é a coluna pela qual o relatório existe.
//
// A regra "Resolvida e Cobrada exigem custo real" é do banco
// (`solicitacao_avarias_custo_check`) e é repetida aqui de propósito:
// dita antes, ela vira uma frase que diz o que preencher; deixada só para
// o banco, viraria o nome de uma constraint na tela.
//
// Não se cria avaria por esta rota, e não se apaga: quem abre é a
// devolução, e apagar avaria esvaziaria o relatório justamente do que
// aconteceu.

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";
import {
  GRAVIDADES_AVARIA,
  PROVIDENCIAS_AVARIA,
  SITUACOES_AVARIA,
  SITUACOES_AVARIA_QUE_EXIGEM_CUSTO,
} from "@/lib/tipos";
import {
  TEXTO_LONGO,
  corpoJson,
  daLista,
  dinheiro,
  dinheiroOuNulo,
  maiusculas,
  texto,
  textoOpcional,
} from "@/lib/validacao";

export const dynamic = "force-dynamic";

interface Contexto {
  params: { id: string };
}

export async function PATCH(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/avarias/${params.id}`);
  if (!autorizacao.ok) return autorizacao.resposta;

  const corpo = await corpoJson(request);
  if (!corpo) return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });

  const descricao = texto(corpo.descricao, TEXTO_LONGO);
  if (!descricao) return NextResponse.json({ error: "Descreva a avaria." }, { status: 400 });

  const gravidade = daLista(corpo.gravidade, GRAVIDADES_AVARIA);
  if (!gravidade) return NextResponse.json({ error: "Gravidade inválida." }, { status: 400 });

  const providencia = daLista(corpo.providencia, PROVIDENCIAS_AVARIA);
  if (!providencia) return NextResponse.json({ error: "Providência inválida." }, { status: 400 });

  const situacao = daLista(corpo.situacao, SITUACOES_AVARIA);
  if (!situacao) return NextResponse.json({ error: "Situação inválida." }, { status: 400 });

  const custoEstimado = dinheiro(corpo.custo_estimado);
  if (custoEstimado === null) {
    return NextResponse.json({ error: "Custo estimado inválido." }, { status: 400 });
  }

  const custoReal = dinheiroOuNulo(corpo.custo_real);
  if (custoReal === false) return NextResponse.json({ error: "Custo real inválido." }, { status: 400 });

  if (SITUACOES_AVARIA_QUE_EXIGEM_CUSTO.includes(situacao) && custoReal === null) {
    return NextResponse.json(
      { error: `Avaria ${situacao.toLowerCase()} exige o custo real.` },
      { status: 400 }
    );
  }

  const opcionais = {
    causa: textoOpcional(corpo.causa, TEXTO_LONGO),
    responsavel: textoOpcional(corpo.responsavel),
    fornecedor: textoOpcional(corpo.fornecedor),
    nota_fiscal: textoOpcional(corpo.nota_fiscal, 60),
  };
  for (const [campo, valor] of Object.entries(opcionais)) {
    if (valor === false) return NextResponse.json({ error: `Campo ${campo} acima do tamanho permitido.` }, { status: 400 });
  }

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);
  const { error } = await sb
    .from("solicitacao_avarias")
    .update({
      descricao: maiusculas(descricao),
      gravidade,
      providencia,
      situacao,
      causa: opcionais.causa ? maiusculas(opcionais.causa) : null,
      responsavel: opcionais.responsavel ? maiusculas(opcionais.responsavel) : null,
      custo_estimado: custoEstimado,
      custo_real: custoReal,
      fornecedor: opcionais.fornecedor ? maiusculas(opcionais.fornecedor) : null,
      // Nota fiscal NÃO vai para caixa alta: é um identificador literal.
      nota_fiscal: opcionais.nota_fiscal || null,
    })
    .eq("id", params.id);

  if (error) {
    return NextResponse.json(
      { error: mensagemDeErro(error, "salvar a avaria") },
      { status: statusDoErro(error) }
    );
  }
  return NextResponse.json({ ok: true });
}
