// ═══════════════════════════════════════════════════════════════════════
//  DIREÇÃO · PROJETOS E LÍDERES
//
//  O cadastro mais consequente do sistema: sem projeto ninguém abre
//  solicitação de campo, e é dele que sai QUEM APROVA cada uma.
//
//  EXCLUSIVO DA DIREÇÃO. `exigirPapel` aqui é a checagem autoritativa —
//  o middleware já barrou pela lista em ROTAS_RESTRITAS, mas ele lê o
//  papel do cookie, e só esta consulta sabe o papel de agora. E nenhuma
//  das duas é a barreira final: a política do banco ("projetos: só a
//  Direção cadastra") é.
// ═══════════════════════════════════════════════════════════════════════

import { exigirPapel } from "@/lib/sessao";
import { carregarColaboradores, carregarDados } from "@/lib/dados";
import { lideresDisponiveis } from "@/lib/consultas";
import { CadastroDeProjetos } from "@/app/(sistema)/direcao/CadastroDeProjetos";

export const dynamic = "force-dynamic";

export default async function PaginaDaDirecao() {
  const usuario = await exigirPapel(["direcao"]);

  // O organograma entra aqui porque é dele que sai QUEM PODE SER LÍDER.
  // Antes esta tela usava `dados.perfis` — todos os acessos do sistema — e
  // oferecia técnico por técnico como candidato a aprovar campo.
  const [dados, { colaboradores }] = await Promise.all([
    carregarDados(usuario.accessToken),
    carregarColaboradores(usuario.accessToken),
  ]);

  // Quantos campos cada projeto tem, e quantos esperam decisão do líder.
  // Contado aqui porque a tabela mostra as duas colunas, e cruzar a lista
  // inteira dentro de cada linha da tela seria refazer a conta N vezes.
  const campos = new Map<string, number>();
  const aAprovar = new Map<string, number>();
  for (const s of dados.solicitacoes) {
    if (!s.projeto_id) continue;
    campos.set(s.projeto_id, (campos.get(s.projeto_id) ?? 0) + 1);
    if (s.status === "Aguardando aprovação") {
      aAprovar.set(s.projeto_id, (aAprovar.get(s.projeto_id) ?? 0) + 1);
    }
  }

  return (
    <CadastroDeProjetos
      projetos={dados.projetos}
      gastosPrevistos={dados.gastosPrevistos}
      lideresDisponiveis={lideresDisponiveis(colaboradores)}
      campos={Object.fromEntries(campos)}
      aAprovar={Object.fromEntries(aAprovar)}
      v2Ativa={dados.estrutura.v2}
    />
  );
}
