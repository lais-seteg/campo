// Relatório de avarias.
//
// O papel tinha uma coluna "AVARIA?" e um espaço para observação. Quem
// paga o conserto precisa do custo: quanto se estimou, quanto se gastou e
// se ficou resolvido.
//
// A avaria NASCE na devolução (ver a conferência) e é acompanhada aqui até
// fechar. Não se cria nem se apaga avaria por esta tela.

import { exigirSessao } from "@/lib/sessao";
import { carregarDados } from "@/lib/dados";
import { RelatorioDeAvarias } from "@/app/(sistema)/avarias/RelatorioDeAvarias";

export const dynamic = "force-dynamic";

export default async function PaginaDeAvarias() {
  const usuario = await exigirSessao();
  const dados = await carregarDados(usuario.accessToken);

  return <RelatorioDeAvarias avarias={dados.avarias} v2Ativa={dados.estrutura.v2} />;
}
