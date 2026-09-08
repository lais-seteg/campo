// ═══════════════════════════════════════════════════════════════════════
//  GRAVAÇÃO DOS GASTOS PREVISTOS — o que POST e PATCH têm em comum.
//
//  O gasto previsto é tabela filha (`projeto_gastos_previstos`), e a tela
//  o edita como um bloco: a Direção adiciona, muda e remove linhas e
//  salva o projeto inteiro. Então a gravação é REESCRITA — apaga as linhas
//  do projeto e insere as que voltaram — e não um diff linha por linha.
//
//  Reescrever é o certo aqui por dois motivos. O primeiro é que a tela não
//  manda id de linha: ela manda a lista como está agora. O segundo é que
//  diff exigiria decidir o que é "a mesma linha" — e a única identidade
//  natural é a categoria, que é exatamente o que a pessoa pode ter mudado.
//
//  ── ISTO NÃO É ATÔMICO, E DÁ PARA VIVER COM ISSO ──
//
//  Entre o delete e o insert existe um instante em que o projeto está sem
//  gasto previsto. Não há transação a partir do PostgREST, e o que está
//  em jogo é um orçamento de referência — não saldo de estoque, onde a
//  falta de transação furaria a reserva de material (por isso ali a
//  gravação é uma FUNÇÃO do banco, e aqui não precisa ser).
//
//  Se o insert falhar, a rota devolve o erro dizendo que os gastos não
//  foram gravados — em vez de responder "salvo" sobre um cadastro que
//  ficou pela metade.
// ═══════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from "@supabase/supabase-js";
import { tabelaNaoExiste } from "@/lib/erros";
import type { GastoPrevistoDoCorpo } from "@/app/api/projetos/validacao";

/**
 * Reescreve os gastos previstos do projeto.
 *
 * @returns `null` quando gravou, ou a mensagem de erro do banco. Não
 *   lança: quem chama já respondeu 201/200 pelo projeto em si e precisa
 *   decidir o que dizer sobre a parte que faltou.
 */
export async function gravarGastos(
  sb: SupabaseClient,
  projetoId: string,
  gastos: readonly GastoPrevistoDoCorpo[]
): Promise<string | null> {
  const { error: erroAoLimpar } = await sb
    .from("projeto_gastos_previstos")
    .delete()
    .eq("projeto_id", projetoId);

  // A tabela só existe depois de 05_ajustes_v3.sql. Sem ela o cadastro do
  // projeto continua funcionando SEM gasto previsto — é a mesma escolha
  // que o resto do sistema faz com as tabelas da v2, e o aviso de
  // estrutura na tela já diz o que está desligado.
  if (erroAoLimpar) {
    if (tabelaNaoExiste(erroAoLimpar)) return null;
    return erroAoLimpar.message;
  }

  if (!gastos.length) return null;

  const { error: erroAoInserir } = await sb
    .from("projeto_gastos_previstos")
    .insert(gastos.map((g) => ({ ...g, projeto_id: projetoId })));

  if (erroAoInserir) {
    if (tabelaNaoExiste(erroAoInserir)) return null;
    return erroAoInserir.message;
  }
  return null;
}
