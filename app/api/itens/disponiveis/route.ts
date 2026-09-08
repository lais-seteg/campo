// GET /api/itens/disponiveis?inicio=&fim=&ignorar=
//
// O catálogo visto PELAS DATAS do campo. Não é o saldo do estoque: é o
// saldo menos o que já está comprometido com outros campos no mesmo
// período. Um medidor que está na prateleira hoje pode já estar preso a
// outro campo na semana que vem.
//
// `ignorar` é a solicitação em edição: o material que ELA já reservou não
// pode aparecer como indisponível para ela mesma — senão editar o
// telefone de um pedido faria o próprio equipamento dele parecer tomado.
//
// Item em manutenção aparece na lista com disponível ZERO, em vez de
// sumir: quem está pedindo precisa saber por que não pode levar.

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { carregarDisponibilidade } from "@/lib/dados";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";
import { data, uuidOpcional } from "@/lib/validacao";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const autorizacao = await autorizarApi("/api/itens/disponiveis");
  if (!autorizacao.ok) return autorizacao.resposta;

  const busca = request.nextUrl.searchParams;
  const inicio = data(busca.get("inicio"));
  const fim = data(busca.get("fim"));
  if (!inicio || !fim) {
    return NextResponse.json(
      { error: "Informe o período do campo para calcular a disponibilidade." },
      { status: 400 }
    );
  }
  if (fim < inicio) {
    return NextResponse.json({ error: "O fim do período não pode ser antes do início." }, { status: 400 });
  }

  const ignorar = uuidOpcional(busca.get("ignorar"));
  if (ignorar === false) {
    return NextResponse.json({ error: "Solicitação a ignorar inválida." }, { status: 400 });
  }

  try {
    const itens = await carregarDisponibilidade(autorizacao.usuario.accessToken, inicio, fim, ignorar);
    return NextResponse.json({ inicio, fim, itens });
  } catch (erro) {
    return NextResponse.json(
      { error: mensagemDeErro(erro, "calcular a disponibilidade do material") },
      { status: statusDoErro(erro) }
    );
  }
}
