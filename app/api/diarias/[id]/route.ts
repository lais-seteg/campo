// PATCH /api/diarias/[id] — muda o VALOR DE REFERÊNCIA de uma diária.
//
// Só a Gestão (e a Direção, que pode tudo que a Gestão pode) — declarado
// em ROTAS_RESTRITAS, e a RLS de `diaria_valores` cobra o mesmo.
//
// O valor mora em tabela e não no código por dois motivos: mudar a diária
// é decisão administrativa e não deploy, e o valor de referência precisa
// estar ao lado do valor efetivamente pago para a diferença aparecer.
//
// Só o VALOR muda. `tipo_diaria`, `vinculo` e `pernoite` são a identidade
// da linha — os nomes vêm da planilha, e trocar um deles não é "corrigir o
// valor", é criar outra diária. Diárias JÁ LANÇADAS guardam o valor com
// que foram lançadas (a solicitação copia `valor_unitario`), então isto
// vale para as próximas e não reescreve o passado.

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";
import { corpoJson, dinheiro } from "@/lib/validacao";

export const dynamic = "force-dynamic";

interface Contexto {
  params: { id: string };
}

export async function PATCH(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/diarias/${params.id}`);
  if (!autorizacao.ok) return autorizacao.resposta;

  const corpo = await corpoJson(request);
  if (!corpo) return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });

  const valor = dinheiro(corpo.valor);
  if (valor === null) return NextResponse.json({ error: "Valor inválido." }, { status: 400 });
  if (valor <= 0) return NextResponse.json({ error: "Informe o valor da diária." }, { status: 400 });

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);
  const { error } = await sb
    .from("diaria_valores")
    .update({ valor, atualizado_em: new Date().toISOString() })
    .eq("id", params.id);

  if (error) {
    return NextResponse.json(
      { error: mensagemDeErro(error, "atualizar o valor da diária") },
      { status: statusDoErro(error) }
    );
  }
  return NextResponse.json({ ok: true });
}
