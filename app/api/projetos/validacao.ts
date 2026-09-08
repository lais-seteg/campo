// ═══════════════════════════════════════════════════════════════════════
//  VALIDAÇÃO DO CADASTRO DE PROJETOS
//
//  É o cadastro mais consequente do sistema: sem projeto ninguém abre
//  solicitação de campo, e é dele que sai QUEM APROVA cada uma.
//
//  Quatro regras que não são formalidade:
//
//   · LÍDER É PESSOA, não texto. `lider_id` aponta para `perfis` — texto
//     livre não aprova nada. O campo `lider` (o nome) é preenchido por
//     TRIGGER a partir do id; mandar os dois daqui faria eles divergirem
//     no dia em que alguém mudasse de nome. E a pessoa tem de estar NO
//     ORGANOGRAMA, ativa e com acesso ao sistema: até a v3 bastava existir
//     em `perfis`, o que fazia de qualquer acesso — inclusive de alguém
//     desativado — um candidato a aprovar campo.
//   · PROJETO SEM LÍDER trava campo para sempre: o pedido nasceria
//     esperando uma decisão que ninguém pode tomar. Por isso é exigido
//     aqui e no banco.
//   · O PRAZO é opcional, mas fim ANTES do início não passa: seria um
//     projeto que termina antes de existir, e o previsto do campo sairia
//     de um período impossível.
//   · GASTO PREVISTO é valor TOTAL do projeto, uma linha por categoria, e
//     a categoria não repete: a mesma categoria duas vezes faria o total
//     do projeto depender de qual das duas linhas alguém abriu.
//
//  O retorno vem em DUAS partes porque são duas tabelas: `dados` são as
//  colunas de `projetos`, `gastos` são as linhas de
//  `projeto_gastos_previstos`. Misturar as duas num objeto só faria o
//  PostgREST recusar o insert com "column gastos does not exist".
// ═══════════════════════════════════════════════════════════════════════

import type { LiderDisponivel, SituacaoProjeto } from "@/lib/tipos";
import { SITUACOES_PROJETO } from "@/lib/tipos";
import {
  TEXTO_LONGO,
  daLista,
  dataOpcional,
  dinheiro,
  lista,
  maiusculas,
  texto,
  textoOpcional,
  uuid,
} from "@/lib/validacao";

export interface CorpoDeProjeto {
  cliente: string;
  nome: string;
  lider_id: string;
  codigo_clockify: string | null;
  escopo: string;
  data_inicio: string | null;
  data_fim: string | null;
  observacao: string | null;
  situacao: SituacaoProjeto;
}

/** Uma linha de `projeto_gastos_previstos`, sem o `projeto_id` — que só a
 *  rota conhece (no cadastro novo ele nem existe ainda). */
export interface GastoPrevistoDoCorpo {
  categoria: string;
  valor: number;
  observacao: string | null;
}

export type ResultadoDeProjeto =
  | { ok: true; dados: CorpoDeProjeto; gastos: GastoPrevistoDoCorpo[] }
  | { ok: false; erro: string };

const MAX_ESCOPO = 60;
const MAX_GASTOS = 40;
const MAX_CATEGORIA = 80;

/**
 * @param lideres os candidatos a líder do organograma — o líder tem de ser
 *   um deles. Sem essa conferência, um `lider_id` qualquer passaria pela FK
 *   apenas por existir em `perfis`, inclusive o de alguém desativado ou o
 *   de quem nem está no organograma.
 * @param liderAtual o líder que o projeto JÁ TEM, na edição. Ele é aceito
 *   mesmo fora da lista, e isso é deliberado: se alguém sair do organograma
 *   (desativado, ou com o acesso desligado) enquanto lidera projeto em
 *   andamento, recusar aqui impediria a Direção de corrigir o prazo ou o
 *   gasto daquele projeto sem trocar de líder no mesmo movimento. A tela
 *   mostra o líder marcado como "fora do organograma", e trocar continua
 *   sendo escolha dela.
 */
export function validarProjeto(
  corpo: Record<string, unknown>,
  lideres: readonly LiderDisponivel[],
  liderAtual: string | null = null
): ResultadoDeProjeto {
  const cliente = texto(corpo.cliente);
  if (!cliente) return { ok: false, erro: "Informe o cliente." };

  const nome = texto(corpo.nome);
  if (!nome) return { ok: false, erro: "Informe o nome do projeto." };

  const liderId = uuid(corpo.lider_id);
  if (!liderId) {
    return {
      ok: false,
      erro: "Escolha o líder do projeto — é ele quem aprova o campo, e texto livre não aprova nada.",
    };
  }
  const candidato =
    liderId === liderAtual || lideres.some((l) => l.perfil_id === liderId);
  if (!candidato) {
    return {
      ok: false,
      erro:
        "O líder escolhido não é um colaborador ativo do organograma com acesso ao sistema. " +
        "Cadastre-o na aba Organograma — e lembre que liderar é aprovar campo, então ele precisa " +
        "de acesso para entrar na lista.",
    };
  }

  // O escopo é digitado um item por linha na tela (o contrato o lista
  // assim), mas no banco continua numa coluna de texto separado por
  // vírgula: é como os projetos antigos estão gravados, e é isso que a
  // busca da aba e a exportação leem.
  const escopoCru = lista(corpo.escopo, MAX_ESCOPO);
  if (!escopoCru) {
    return { ok: false, erro: `Informe no máximo ${MAX_ESCOPO} itens de escopo.` };
  }
  const escopo: string[] = [];
  for (const bruto of escopoCru) {
    const item = texto(bruto);
    if (!item) continue;
    escopo.push(maiusculas(item));
  }
  if (!escopo.length) {
    return { ok: false, erro: "Informe ao menos um item de escopo." };
  }

  // ── O prazo ──
  const inicio = dataOpcional(corpo.data_inicio);
  if (inicio === false) return { ok: false, erro: "Data de início inválida." };
  const fim = dataOpcional(corpo.data_fim);
  if (fim === false) return { ok: false, erro: "Data de fim inválida." };
  if (inicio && fim && fim < inicio) {
    return { ok: false, erro: "A data de fim do projeto é anterior à de início." };
  }

  const situacao = daLista(corpo.situacao, SITUACOES_PROJETO);
  if (!situacao) {
    return { ok: false, erro: `Situação inválida. Use ${SITUACOES_PROJETO.join(", ")}.` };
  }

  const gastos = validarGastos(corpo.gastos);
  if (!gastos.ok) return { ok: false, erro: gastos.erro };

  const clockify = textoOpcional(corpo.codigo_clockify, 60);
  if (clockify === false) return { ok: false, erro: "Código Clockify acima do tamanho permitido." };

  const observacao = textoOpcional(corpo.observacao, TEXTO_LONGO);
  if (observacao === false) return { ok: false, erro: "Observação acima do tamanho permitido." };

  return {
    ok: true,
    dados: {
      cliente: maiusculas(cliente),
      nome: maiusculas(nome),
      lider_id: liderId,
      codigo_clockify: clockify,
      escopo: escopo.join(", "),
      data_inicio: inicio,
      data_fim: fim,
      observacao,
      situacao,
      // `ativo` NÃO é enviado: no banco ele é derivado de `situacao` por
      // trigger. Mandar os dois é a mesma armadilha de `lider` × `lider_id`.
    },
    gastos: gastos.linhas,
  };
}

type ResultadoDeGastos = { ok: true; linhas: GastoPrevistoDoCorpo[] } | { ok: false; erro: string };

/**
 * As linhas de gasto previsto. Linha em branco é DESCARTADA em silêncio —
 * a tela abre com uma linha vazia por conveniência, e sair sem preencher
 * não é erro. Linha com categoria e valor inválido, sim: aí alguém digitou
 * algo que não é dinheiro, e gravar zero calado seria mentir sobre o
 * orçamento do projeto.
 */
function validarGastos(bruto: unknown): ResultadoDeGastos {
  // Ausente = a tela não mandou gasto nenhum. Diferente de lista vazia
  // (mandou, e não tem nenhum) só na intenção; aqui as duas dão o mesmo.
  if (bruto === null || bruto === undefined) return { ok: true, linhas: [] };

  const cru = lista(bruto, MAX_GASTOS);
  if (!cru) return { ok: false, erro: `Informe no máximo ${MAX_GASTOS} gastos previstos.` };

  const linhas: GastoPrevistoDoCorpo[] = [];
  const vistas = new Set<string>();

  for (const item of cru) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, erro: "Linha de gasto previsto malformada." };
    }
    const linha = item as Record<string, unknown>;

    const categoria = texto(linha.categoria, MAX_CATEGORIA);
    const valor = dinheiro(linha.valor);

    // Linha inteiramente vazia: descarta.
    if (!categoria && !valor) continue;

    if (!categoria) {
      return { ok: false, erro: "Há um gasto previsto com valor e sem categoria. Diga do que é o gasto." };
    }
    if (valor === null) {
      return { ok: false, erro: `Valor inválido no gasto "${categoria}".` };
    }

    // A unicidade também está no banco (projeto_gastos_categoria_unica).
    // Barrar aqui é o que dá uma mensagem que diz QUAL categoria repetiu,
    // em vez do erro cru da constraint.
    const chave = categoria.toLowerCase();
    if (vistas.has(chave)) {
      return { ok: false, erro: `A categoria "${categoria}" aparece duas vezes nos gastos previstos.` };
    }
    vistas.add(chave);

    const observacao = textoOpcional(linha.observacao, TEXTO_LONGO);
    if (observacao === false) {
      return { ok: false, erro: `Observação acima do tamanho permitido no gasto "${categoria}".` };
    }

    linhas.push({ categoria, valor, observacao });
  }

  return { ok: true, linhas };
}
