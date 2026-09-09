// ═══════════════════════════════════════════════════════════════════════
//  POST /api/solicitacoes/[id]/conferencia
//
//  Corpo: { modo: "entrega" | "devolucao", data, adm, prestador,
//           itens: [...], assinaturas: { administrativo, prestador } }
//
//  ── É AQUI QUE O CAMPO MEXE NO ESTOQUE ──
//
//  Equipamento de campo é EMPRÉSTIMO, não consumo — o formulário em papel
//  já dizia isso ao ter entrega e devolução. A entrega dá Saída no
//  estoque; a devolução dá Entrada e abre as avarias.
//
//  Quem faz é o banco, numa transação só (`registrar_entrega_solicitacao`
//  e `registrar_devolucao_solicitacao`). Antes isto eram N chamadas do
//  navegador — marcar cada item, atualizar o cabeçalho e baixar o estoque
//  — e perder a conexão no meio deixava metade registrado. Aqui é tudo ou
//  nada, e continua sendo: esta rota não replica a lógica, ela a chama.
//
//  ── A ASSINATURA SAIU DAQUI ──
//
//  Esta rota já recebeu as duas assinaturas no mesmo corpo e as gravava
//  depois de registrar. Não mais: cada pessoa assina no PRÓPRIO acesso, em
//  `POST /api/solicitacoes/[id]/assinaturas` (ver supabase/14).
//
//  A ordem se inverteu, e é a ordem certa: assina-se ANTES, e o registro
//  exige as duas assinaturas do momento já presentes — quem cobra isso é
//  `exigir_assinaturas()` dentro da própria função que move o estoque, e
//  não esta rota, porque a regra tem de valer para qualquer caminho que
//  chegue ao banco.
//
//  Antes, as duas assinaturas eram desenhadas no mesmo aparelho, na mesma
//  transação: provavam que alguém desenhou dois traços, não quem eram.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { carregarSolicitacao } from "@/lib/dados";
import { mensagemDeErro, statusDoErro } from "@/lib/erros";
import { podeRegistrarDevolucao, podeRegistrarEntrega } from "@/lib/papeis";
import { GRAVIDADES_AVARIA, PROVIDENCIAS_AVARIA } from "@/lib/tipos";
import type { GravidadeAvaria, ProvidenciaAvaria } from "@/lib/tipos";

export const dynamic = "force-dynamic";

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const VALOR_MAX = 99_999_999.99;

interface Contexto {
  params: { id: string };
}

interface ItemDaEntrega {
  id: string;
  entregue: boolean;
  teste: boolean;
}

interface ItemDaDevolucao {
  id: string;
  devolvido: boolean;
  teste: boolean;
  avaria: boolean;
  avaria_obs: string;
  avaria_custo: number;
  avaria_gravidade: GravidadeAvaria | null;
  avaria_providencia: ProvidenciaAvaria | null;
  avaria_fornecedor: string;
}

export async function POST(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/solicitacoes/${params.id}/conferencia`);
  if (!autorizacao.ok) return autorizacao.resposta;
  const { usuario } = autorizacao;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }
  const c = (corpo as Record<string, unknown>) ?? {};

  const entrega = c.modo === "entrega";
  if (c.modo !== "entrega" && c.modo !== "devolucao") {
    return NextResponse.json({ error: "Informe se é entrega ou devolução." }, { status: 400 });
  }

  const data = typeof c.data === "string" && RE_DATA.test(c.data) ? c.data : null;
  const adm = texto(c.adm, 200);
  const prestador = texto(c.prestador, 200);
  if (!data || !adm || !prestador) {
    return NextResponse.json({ error: "Preencha a data e os dois nomes." }, { status: 400 });
  }

  // Nenhuma assinatura vem no corpo. Elas já estão no banco, cada uma posta
  // por quem assinou, e é `exigir_assinaturas()` que recusa o registro se
  // faltar alguma — com a frase dizendo qual falta.
  const solicitacao = await carregarSolicitacao(usuario.accessToken, params.id);
  if (!solicitacao) return NextResponse.json({ error: "Solicitação não encontrada." }, { status: 404 });

  // Equipamento não sai antes da aprovação. O banco recusa também — aqui
  // a frase diz o que está faltando.
  if (entrega && !podeRegistrarEntrega(solicitacao.status)) {
    return NextResponse.json(
      {
        error:
          solicitacao.status === "Aguardando aprovação"
            ? `Equipamento não sai antes da aprovação: a solicitação ${solicitacao.codigo} ainda espera o líder.`
            : `A solicitação ${solicitacao.codigo} está ${solicitacao.status} e não aceita registro de entrega.`,
      },
      { status: 409 }
    );
  }
  if (!entrega && !podeRegistrarDevolucao(solicitacao.status)) {
    return NextResponse.json(
      { error: `A solicitação ${solicitacao.codigo} não está em campo — registre a entrega antes da devolução.` },
      { status: 409 }
    );
  }

  const idsPermitidos = solicitacao.equipamentos.map((e) => e.id);
  const itens = entrega
    ? validarItensDaEntrega(c.itens, idsPermitidos)
    : validarItensDaDevolucao(c.itens, idsPermitidos);
  if (typeof itens === "string") return NextResponse.json({ error: itens }, { status: 400 });

  const sb = clienteDoUsuario(usuario.accessToken);

  try {
    // `p_adm` e `p_prestador` seguem no contrato como reserva, mas a função
    // prefere os nomes das ASSINATURAS: assim o cabeçalho impresso nunca diz
    // um nome diferente de quem assinou.
    const { data: resultado, error } = await sb.rpc(
      entrega ? "registrar_entrega_solicitacao" : "registrar_devolucao_solicitacao",
      { p_solicitacao: params.id, p_data: data, p_adm: adm, p_prestador: prestador, p_itens: itens }
    );
    if (error) throw error;

    const r = (resultado ?? {}) as {
      baixados?: number;
      devolvidos?: number;
      avarias?: number;
      pendentes?: string[];
    };

    return NextResponse.json({
      ok: true,
      entrega,
      baixados: r.baixados ?? 0,
      devolvidos: r.devolvidos ?? 0,
      avarias: r.avarias ?? 0,
      // Item que não voltou MANTÉM a solicitação em campo: o status só vai
      // para Finalizada quando todos os equipamentos foram conferidos de
      // volta. A tela precisa dizer o que ficou faltando.
      pendentes: r.pendentes ?? [],
    });
  } catch (erro) {
    console.error(`[POST /api/solicitacoes/${params.id}/conferencia]`, erro);
    return NextResponse.json(
      { error: mensagemDeErro(erro, "registrar a conferência") },
      { status: statusDoErro(erro) }
    );
  }
}

function texto(valor: unknown, max: number): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  if (!limpo || limpo.length > max) return null;
  return limpo;
}

function dinheiro(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return 0;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > VALOR_MAX) return null;
  return Math.round(n * 100) / 100;
}

function idsDaLista(valor: unknown, idsPermitidos: readonly string[]): Record<string, unknown>[] | string {
  if (!Array.isArray(valor)) return "Lista de equipamentos inválida.";
  if (valor.length > idsPermitidos.length) return "Lista de equipamentos inválida.";

  const linhas: Record<string, unknown>[] = [];
  for (const bruta of valor) {
    if (typeof bruta !== "object" || bruta === null) return "Linha de equipamento inválida.";
    const l = bruta as Record<string, unknown>;
    // O item enviado tem de ser um item DESTA solicitação. A RLS permite a
    // qualquer usuário ativo gravar nas filhas, então quem barra um id de
    // outro pedido é esta rota.
    if (typeof l.id !== "string" || !idsPermitidos.includes(l.id)) {
      return "Um dos equipamentos enviados não pertence a esta solicitação.";
    }
    linhas.push(l);
  }
  return linhas;
}

function validarItensDaEntrega(valor: unknown, ids: readonly string[]): ItemDaEntrega[] | string {
  const linhas = idsDaLista(valor, ids);
  if (typeof linhas === "string") return linhas;
  return linhas.map((l) => ({
    id: l.id as string,
    entregue: l.entregue === true,
    teste: l.teste === true,
  }));
}

function validarItensDaDevolucao(valor: unknown, ids: readonly string[]): ItemDaDevolucao[] | string {
  const linhas = idsDaLista(valor, ids);
  if (typeof linhas === "string") return linhas;

  const itens: ItemDaDevolucao[] = [];
  for (const l of linhas) {
    const avaria = l.avaria === true;
    const devolvido = l.devolvido === true;

    // Item marcado como avariado que não foi devolvido é contradição: ele
    // não voltou, então ninguém viu a avaria na conferência.
    if (avaria && !devolvido) {
      return "Item marcado com avaria precisa estar marcado como devolvido.";
    }

    const observacao = avaria ? texto(l.avaria_obs, 2000) : null;
    // Avaria sem descrição não ajuda ninguém a cobrar conserto nem a abrir
    // manutenção depois.
    if (avaria && !observacao) return "Descreva a avaria de cada item marcado.";

    const custo = dinheiro(l.avaria_custo);
    if (custo === null) return "Custo estimado de avaria inválido.";

    const gravidade = daLista(l.avaria_gravidade, GRAVIDADES_AVARIA);
    if (avaria && l.avaria_gravidade && !gravidade) return "Gravidade de avaria inválida.";
    const providencia = daLista(l.avaria_providencia, PROVIDENCIAS_AVARIA);
    if (avaria && l.avaria_providencia && !providencia) return "Providência de avaria inválida.";

    itens.push({
      id: l.id as string,
      devolvido,
      teste: l.teste === true,
      avaria,
      avaria_obs: observacao ?? "",
      avaria_custo: custo,
      avaria_gravidade: gravidade,
      avaria_providencia: providencia,
      // O fornecedor do reparo é o que decide se a manutenção do bem é
      // aberta no Controle de Estoque: lá, `em_manutencao` exige
      // fornecedor E justificativa, e inventar um fornecedor só para
      // satisfazer a restrição seria falsear o registro.
      avaria_fornecedor: texto(l.avaria_fornecedor, 200) ?? "",
    });
  }
  return itens;
}

function daLista<T extends string>(valor: unknown, lista: readonly T[]): T | null {
  return typeof valor === "string" && (lista as readonly string[]).includes(valor) ? (valor as T) : null;
}
