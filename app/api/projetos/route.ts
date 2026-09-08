// POST /api/projetos — cadastra projeto e líder. EXCLUSIVO DA DIREÇÃO.
//
// A restrição está declarada uma vez, em ROTAS_RESTRITAS (lib/papeis.ts), e
// vale tanto para o middleware quanto para `autorizarApi` aqui — não há
// uma lista de papéis repetida nesta rota, livre para divergir da página.
//
// E ela ainda não é a barreira final: quem barra de verdade é a política
// do banco ("projetos: só a Direção cadastra"). Se este código deixasse
// passar, o Postgres recusaria assim mesmo.

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { carregarColaboradores } from "@/lib/dados";
import { lideresDisponiveis } from "@/lib/consultas";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";
import { corpoJson } from "@/lib/validacao";
import { validarProjeto } from "@/app/api/projetos/validacao";
import { gravarGastos } from "@/app/api/projetos/persistencia";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const autorizacao = await autorizarApi("/api/projetos");
  if (!autorizacao.ok) return autorizacao.resposta;

  const corpo = await corpoJson(request);
  if (!corpo) return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });

  // Quem pode ser líder sai do ORGANOGRAMA, não de `perfis` inteira — ver
  // `lideresDisponiveis()`. Projeto NOVO não tem líder anterior a
  // preservar, então o terceiro argumento fica no padrão.
  const { colaboradores } = await carregarColaboradores(autorizacao.usuario.accessToken);
  const validacao = validarProjeto(corpo, lideresDisponiveis(colaboradores));
  if (!validacao.ok) return NextResponse.json({ error: validacao.erro }, { status: 400 });

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);
  const { data, error } = await sb.from("projetos").insert(validacao.dados).select("id").single();

  if (error) {
    // `projetos_unico` (cliente + nome) vira "Já existe este projeto para
    // este cliente" — ver lib/erros.ts. O mesmo projeto do mesmo cliente
    // duas vezes faria o previsto de um campo sair de um cadastro e o do
    // campo seguinte do outro.
    return NextResponse.json(
      { error: mensagemDeErro(error, "salvar o projeto") },
      { status: statusDoErro(error) }
    );
  }

  // Os gastos previstos são tabela filha, e vão depois: o `projeto_id`
  // deles só existe agora.
  //
  // Falhar aqui NÃO é um 4xx/5xx: o projeto foi cadastrado, e responder
  // erro faria a tela dizer que nada aconteceu sobre um projeto que já
  // existe — a Direção cadastraria de novo e bateria no `projetos_unico`.
  // Vai como `aviso`, que a tela mostra em amarelo.
  const erroDosGastos = await gravarGastos(sb, data.id, validacao.gastos);

  return NextResponse.json(
    {
      id: data.id,
      aviso: erroDosGastos
        ? `O projeto foi cadastrado, mas os gastos previstos não foram gravados (${erroDosGastos}). Edite o projeto e salve os gastos de novo.`
        : undefined,
    },
    { status: 201 }
  );
}
