// ═══════════════════════════════════════════════════════════════════════
//  POST /api/solicitacoes/[id]/ajustes — o ajuste do campo em andamento.
//
//  Corpo: { tipo: "material" | "hospedagem" | "diaria" | "despesa",
//           motivo?, ... }
//
//  ── POR QUE NÃO É A EDIÇÃO DO PEDIDO ──
//
//  Campo em andamento pede coisas: material que faltou, uma diária a mais
//  porque estendeu, um táxi que ninguém previu. Isso se fazia editando o
//  pedido, e a edição é o lugar errado por três razões.
//
//  A primeira é que ela APAGA e reescreve as filhas (`limparFilhas`): um
//  acréscimo feito hoje desaparecia na próxima correção de qualquer outro
//  campo do formulário. Pior num pedido do tipo Administrativo, que nem
//  envia diárias — ali o acréscimo era apagado e nunca reescrito.
//
//  A segunda é o HISTÓRICO. Editar registra "campo X mudou de A para B";
//  acrescentar é outro acontecimento — "entrou uma diária de 4 dias, e foi
//  por isto". `solicitacao_alteracoes` sempre soube a diferença: o `tipo`
//  dela aceita 'Acréscimo' desde a v2, e era o único que nunca era usado
//  fora do equipamento.
//
//  A terceira é o MOTIVO. Uma linha de custo que aparece sem explicação é
//  o que trava a prestação de contas seis meses depois. Aqui o motivo entra
//  na frase do histórico, junto do número.
//
//  ── A REGRA NÃO MORA AQUI ──
//
//  Quem confere permissão, estado do pedido, disponibilidade de material
//  nas datas e quem registra no histórico são as funções do banco
//  (`acrescentar_*_solicitacao`, supabase/17). Esta rota valida a FORMA do
//  corpo e traduz o erro numa frase. Duplicar a regra daqui criaria duas
//  versões livres para divergir — e a do banco vale para qualquer caminho
//  que chegue nele.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";
import { GRUPOS_DESPESA, VINCULOS } from "@/lib/tipos";

export const dynamic = "force-dynamic";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const VALOR_MAX = 99_999_999.99;
const MOTIVO_MAX = 500;

interface Contexto {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/solicitacoes/${params.id}/ajustes`);
  if (!autorizacao.ok) return autorizacao.resposta;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }
  const c = (corpo as Record<string, unknown>) ?? {};

  const motivo = texto(c.motivo, MOTIVO_MAX);

  // Cada tipo monta a chamada da SUA função. `funcao` e `argumentos` juntos
  // num lugar só para o `catch` e a resposta serem os mesmos nos três —
  // três blocos try/catch iguais é onde um deles fica diferente por
  // descuido.
  let funcao: string;
  let argumentos: Record<string, unknown>;

  switch (c.tipo) {
    case "material": {
      const itemId = typeof c.item_id === "string" && RE_UUID.test(c.item_id) ? c.item_id : null;
      if (!itemId) return NextResponse.json({ error: "Escolha o equipamento." }, { status: 400 });

      const qtd = Number(c.quantidade);
      if (!Number.isInteger(qtd) || qtd < 1 || qtd > 100_000) {
        return NextResponse.json({ error: "A quantidade precisa ser maior que zero." }, { status: 400 });
      }

      funcao = "acrescentar_equipamento_solicitacao";
      argumentos = {
        p_solicitacao: params.id,
        p_item: itemId,
        p_quantidade: qtd,
        p_descricao: null,
        p_motivo: motivo,
      };
      break;
    }

    case "hospedagem": {
      const cidade = texto(c.cidade, 200);
      if (!cidade) return NextResponse.json({ error: "Informe a cidade." }, { status: 400 });

      const hotel = typeof c.hotel_id === "string" && RE_UUID.test(c.hotel_id) ? c.hotel_id : null;

      // As datas são OPCIONAIS aqui e a função herda o período do campo
      // quando faltam — que é o caso normal, dorme-se lá enquanto o campo
      // dura. Exigi-las obrigaria a redigitar o que o pedido já sabe.
      // `dataISO` e não `data`: o `const { data } = await sb.rpc(...)` lá
      // embaixo é do mesmo escopo e sombreia o nome.
      const entrada = dataISO(c.entrada);
      const saida = dataISO(c.saida);
      if (entrada === false || saida === false) {
        return NextResponse.json({ error: "Data de hospedagem inválida." }, { status: 400 });
      }

      const diaria = dinheiro(c.diaria ?? 0);
      if (diaria === null) return NextResponse.json({ error: "Valor da diária inválido." }, { status: 400 });

      funcao = "acrescentar_hospedagem_solicitacao";
      argumentos = {
        p_solicitacao: params.id,
        p_cidade: cidade,
        p_hospedes: texto(c.hospedes, 500),
        p_hotel: hotel,
        p_entrada: entrada,
        p_saida: saida,
        p_diaria: diaria,
        p_motivo: motivo,
      };
      break;
    }

    case "diaria": {
      const colaborador = texto(c.colaborador, 200);
      if (!colaborador) {
        return NextResponse.json({ error: "Informe quem recebe a diária." }, { status: 400 });
      }

      const vinculo = daLista(c.vinculo, VINCULOS);
      if (!vinculo) return NextResponse.json({ error: "Vínculo inválido." }, { status: 400 });

      const tipoDiaria = texto(c.tipo_diaria, 200);
      if (!tipoDiaria) return NextResponse.json({ error: "Escolha o tipo da diária." }, { status: 400 });

      const dias = Number(c.dias);
      if (!Number.isInteger(dias) || dias < 1 || dias > 366) {
        return NextResponse.json({ error: "Informe quantos dias, de 1 a 366." }, { status: 400 });
      }

      const valor = dinheiro(c.valor_unitario);
      if (valor === null || valor <= 0) {
        return NextResponse.json({ error: "Informe o valor da diária." }, { status: 400 });
      }

      funcao = "acrescentar_diaria_solicitacao";
      argumentos = {
        p_solicitacao: params.id,
        p_colaborador: colaborador,
        p_vinculo: vinculo,
        p_tipo_diaria: tipoDiaria,
        p_dias: dias,
        p_valor_unitario: valor,
        p_dados_bancarios: texto(c.dados_bancarios, 500),
        p_motivo: motivo,
      };
      break;
    }

    case "despesa": {
      const grupo = daLista(c.grupo, GRUPOS_DESPESA);
      if (!grupo) return NextResponse.json({ error: "Escolha o grupo da despesa." }, { status: 400 });

      // A descrição é obrigatória aqui e não é no formulário, de propósito:
      // no formulário a despesa nasce dentro de um bloco que já diz do que
      // se trata; um acréscimo solto sem descrição é um número que ninguém
      // vai saber explicar depois.
      const descricao = texto(c.descricao, 500);
      if (!descricao) {
        return NextResponse.json({ error: "Descreva a despesa." }, { status: 400 });
      }

      const valor = dinheiro(c.valor);
      if (valor === null || valor <= 0) {
        return NextResponse.json({ error: "Informe o valor da despesa." }, { status: 400 });
      }

      funcao = "acrescentar_despesa_solicitacao";
      argumentos = {
        p_solicitacao: params.id,
        p_grupo: grupo,
        p_descricao: descricao,
        p_valor: valor,
        p_motivo: motivo,
      };
      break;
    }

    default:
      return NextResponse.json(
        { error: "Diga o que está sendo acrescentado: material, hospedagem, diária ou despesa." },
        { status: 400 }
      );
  }

  const sb = clienteDoUsuario(autorizacao.usuario.accessToken);
  const { data, error } = await sb.rpc(funcao, argumentos);

  if (error) {
    console.error(`[POST /api/solicitacoes/${params.id}/ajustes] ${funcao}`, error);
    return NextResponse.json(
      { error: mensagemDeErro(error, "acrescentar ao pedido") },
      { status: statusDoErro(error) }
    );
  }

  return NextResponse.json({ ok: true, id: data ?? null }, { status: 201 });
}

function texto(valor: unknown, max: number): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  if (!limpo || limpo.length > max) return null;
  return limpo;
}

function dinheiro(valor: unknown): number | null {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > VALOR_MAX) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Data opcional em ISO. Três respostas, e a do meio é a que importa:
 * `null` = não vem (a função do banco herda o período do campo),
 * a string = veio válida, `false` = veio ERRADA.
 *
 * Sem o `false`, uma data malformada viraria `null` e o pedido ganharia
 * silenciosamente as datas do campo em vez de recusar o que se digitou.
 */
function dataISO(valor: unknown): string | null | false {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor !== "string" || !RE_DATA.test(valor)) return false;
  return valor;
}

function daLista<T extends string>(valor: unknown, lista: readonly T[]): T | null {
  return typeof valor === "string" && (lista as readonly string[]).includes(valor) ? (valor as T) : null;
}
