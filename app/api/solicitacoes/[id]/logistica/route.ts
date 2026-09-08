// ═══════════════════════════════════════════════════════════════════════
//  POST /api/solicitacoes/[id]/logistica
//
//  Corpo: { confirmar: boolean, transporte: {...}, hospedagens: [...], observacao }
//
//  O administrativo fecha o que foi CONTRATADO: locadora e valor real do
//  transporte, hotel de cada cidade com a diária real, e a reserva do
//  material nas datas. Confirmar move a solicitação de `Aprovada` para
//  `Logística confirmada`.
//
//  Isto NÃO é autorização de gasto — essa saiu do fluxo. É a confirmação
//  de que o que precisava ser fechado, foi. E só entra aqui o que o líder
//  JÁ APROVOU: fechar hotel e carro de um campo que ele ainda não validou
//  é gastar antes da hora.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/sessao";
import { clienteDoUsuario } from "@/lib/supabaseServidor";
import { carregarSolicitacao } from "@/lib/dados";
import { mensagemDeErro, statusDoErro, tabelaNaoExiste } from "@/lib/erros";
import { podeFecharLogistica } from "@/lib/papeis";
import { LOCADORAS, type Locadora } from "@/lib/tipos";

export const dynamic = "force-dynamic";

const VALOR_MAX = 99_999_999.99;
const TEXTO_MAX = 2000;

interface Contexto {
  params: { id: string };
}

interface HospedagemDaLogistica {
  id: string;
  hotel_id: string | null;
  diaria_real: number;
  reserva_codigo: string | null;
}

export async function POST(request: NextRequest, { params }: Contexto) {
  const autorizacao = await autorizarApi(`/api/solicitacoes/${params.id}/logistica`);
  if (!autorizacao.ok) return autorizacao.resposta;
  const { usuario } = autorizacao;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }
  const c = (corpo as Record<string, unknown>) ?? {};
  const confirmar = c.confirmar === true;

  const sb = clienteDoUsuario(usuario.accessToken);
  const solicitacao = await carregarSolicitacao(usuario.accessToken, params.id);
  if (!solicitacao) return NextResponse.json({ error: "Solicitação não encontrada." }, { status: 404 });

  if (!podeFecharLogistica(solicitacao.status)) {
    return NextResponse.json(
      {
        error:
          solicitacao.status === "Aguardando aprovação"
            ? `A solicitação ${solicitacao.codigo} ainda espera a aprovação do líder — fechar hotel e carro antes disso é gastar antes da hora.`
            : `A solicitação ${solicitacao.codigo} está ${solicitacao.status} e não está em fase de logística.`,
      },
      { status: 409 }
    );
  }

  // ── Transporte ──
  const locadoraCrua = c.transporte_locadora;
  const locadora: Locadora | null =
    typeof locadoraCrua === "string" && (LOCADORAS as readonly string[]).includes(locadoraCrua)
      ? (locadoraCrua as Locadora)
      : null;
  if (locadoraCrua && !locadora) {
    return NextResponse.json({ error: "Locadora inválida. Escolha uma da lista." }, { status: 400 });
  }

  let locadoraOutra: string | null = null;
  if (locadora === "Outros") {
    const informada = textoOuNulo(c.transporte_locadora_outra, 200);
    if (!informada) return NextResponse.json({ error: 'Diga qual é a locadora.' }, { status: 400 });
    locadoraOutra = informada.toUpperCase();
  }

  const realVeiculo = dinheiro(c.real_veiculo);
  if (realVeiculo === null) {
    return NextResponse.json({ error: "Valor real do transporte inválido." }, { status: 400 });
  }

  // ── Hospedagens ──
  const hospedagens = validarHospedagens(c.hospedagens, solicitacao.hospedagens.map((h) => h.id));
  if (typeof hospedagens === "string") {
    return NextResponse.json({ error: hospedagens }, { status: 400 });
  }

  const cabecalho: Record<string, unknown> = {
    transporte_modalidade: textoOuNulo(c.transporte_modalidade, 60),
    transporte_locadora: locadora,
    transporte_locadora_outra: locadoraOutra,
    transporte_contrato: textoOuNulo(c.transporte_contrato, 60),
    transporte_placa: textoOuNulo(c.transporte_placa, 10)?.toUpperCase() ?? null,
    real_veiculo: realVeiculo,
    logistica_obs: textoOuNulo(c.logistica_obs, TEXTO_MAX),
  };

  // O real de hospedagem SAI DAS LINHAS: dias × diária real. Somar aqui,
  // em vez de pedir digitado, evita o total divergir do detalhe. E zerar
  // as diárias zera o real — se só gravasse valor positivo, apagar uma
  // diária lançada por engano não teria efeito nenhum.
  if (hospedagens.length) {
    const diasPorLinha = new Map(solicitacao.hospedagens.map((h) => [h.id, Number(h.dias) || 0]));
    cabecalho.real_hospedagem = hospedagens.reduce(
      (total, h) => total + (diasPorLinha.get(h.id) ?? 0) * h.diaria_real,
      0
    );
  }

  try {
    for (const h of hospedagens) {
      const { error } = await sb
        .from("solicitacao_hospedagens")
        .update({
          hotel_id: h.hotel_id,
          diaria_real: h.diaria_real || null,
          reserva_codigo: h.reserva_codigo,
        })
        .eq("id", h.id);
      if (error) throw error;
    }

    // Confirmar tenta GARANTIR a reserva antes de mudar o status: dizer
    // "logística confirmada" com material não reservado seria confirmar o
    // que não está fechado.
    if (confirmar && solicitacao.equipamentos.length) {
      const { error } = await sb.rpc("reservar_equipamentos_solicitacao", {
        p_solicitacao: params.id,
      });
      if (error && !tabelaNaoExiste(error)) throw error;
    }

    // `Logística confirmada` só a partir de `Aprovada`: reconfirmar algo
    // que já está confirmado não deve reescrever o status nem carimbar
    // uma segunda data no histórico.
    if (confirmar && solicitacao.status === "Aprovada") {
      cabecalho.status = "Logística confirmada";
    }

    const { error } = await sb.from("solicitacoes").update(cabecalho).eq("id", params.id);
    if (error) throw error;

    return NextResponse.json({ ok: true, confirmada: confirmar });
  } catch (erro) {
    console.error(`[POST /api/solicitacoes/${params.id}/logistica]`, erro);
    return NextResponse.json(
      { error: mensagemDeErro(erro, confirmar ? "confirmar a logística" : "salvar a logística") },
      { status: statusDoErro(erro) }
    );
  }
}

function textoOuNulo(valor: unknown, max: number): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  if (!limpo) return null;
  return limpo.slice(0, max);
}

function dinheiro(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return 0;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > VALOR_MAX) return null;
  return Math.round(n * 100) / 100;
}

/**
 * As linhas enviadas têm de ser as linhas DESTA solicitação. Sem essa
 * conferência, um `id` de hospedagem de outro pedido passaria adiante e o
 * update mexeria no campo de outra pessoa — a RLS permite (todo usuário
 * ativo grava nas filhas), então quem tem de barrar é esta rota.
 */
function validarHospedagens(valor: unknown, idsPermitidos: readonly string[]): HospedagemDaLogistica[] | string {
  if (valor === null || valor === undefined) return [];
  if (!Array.isArray(valor)) return "Lista de hospedagens inválida.";
  if (valor.length > idsPermitidos.length) return "Lista de hospedagens inválida.";

  const linhas: HospedagemDaLogistica[] = [];
  for (const bruta of valor) {
    if (typeof bruta !== "object" || bruta === null) return "Linha de hospedagem inválida.";
    const l = bruta as Record<string, unknown>;

    const id = typeof l.id === "string" ? l.id : "";
    if (!idsPermitidos.includes(id)) {
      return "Uma das hospedagens enviadas não pertence a esta solicitação.";
    }

    const diaria = dinheiro(l.diaria_real);
    if (diaria === null) return "Valor de diária inválido numa das hospedagens.";

    linhas.push({
      id,
      hotel_id: typeof l.hotel_id === "string" && l.hotel_id ? l.hotel_id : null,
      diaria_real: diaria,
      reserva_codigo: textoOuNulo(l.reserva_codigo, 100),
    });
  }
  return linhas;
}
