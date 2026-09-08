// ═══════════════════════════════════════════════════════════════════════
//  CADASTROS
//
//  Duas listas na mesma aba, porque as duas existem pelo mesmo motivo:
//  alimentar o PREVISTO de um campo sem ninguém precisar lembrar de cor
//  quanto custa. Hotel guarda a diária combinada com a casa; a tabela de
//  diárias guarda o valor de referência da alimentação.
//
//  Projetos NÃO estão aqui: viraram a aba Projetos, porque só a Direção
//  cadastra projeto e líder.
// ═══════════════════════════════════════════════════════════════════════

import { exigirPapel } from "@/lib/sessao";
import { carregarDados } from "@/lib/dados";
import { TelaDeCadastros } from "@/app/(sistema)/cadastros/TelaDeCadastros";

export const dynamic = "force-dynamic";

export default async function PaginaDeCadastros() {
  // DO ADMINISTRATIVO (que opera o cadastro) E DA GESTÃO (que supervisiona).
  //
  // `exigirPapel` aqui é a checagem autoritativa — o middleware já barrou
  // pela lista em ROTAS_RESTRITAS, mas ele lê o papel do cookie, e só esta
  // consulta sabe o papel de agora. E nenhuma das duas é a barreira final:
  // as políticas de `hoteis` e `diaria_valores` são (supabase/06 e 07).
  const usuario = await exigirPapel(["administrativo", "gestor", "direcao"]);
  const dados = await carregarDados(usuario.accessToken);

  // Quantas solicitações usam cada casa — a tela mostra o número ANTES de
  // perguntar se é para excluir, porque excluir desfaz o vínculo e o
  // histórico do gasto fica sem a casa.
  const usosPorHotel = new Map<string, number>();
  for (const s of dados.solicitacoes) {
    for (const h of s.hospedagens) {
      if (!h.hotel_id) continue;
      usosPorHotel.set(h.hotel_id, (usosPorHotel.get(h.hotel_id) ?? 0) + 1);
    }
  }

  return (
    <TelaDeCadastros
      hoteis={dados.hoteis}
      diarias={dados.diarias}
      usosPorHotel={Object.fromEntries(usosPorHotel)}
      // Sempre `true`: a página inteira já é restrita a administrativo e
      // Gestão, então quem chegou até aqui pode gravar. Antes esta linha
      // separava "vê" de "administra", porque a aba era de todos e só a
      // Gestão excluía; agora as duas coisas são a mesma pessoa.
      podeAdministrar
      v2Ativa={dados.estrutura.v2}
    />
  );
}
