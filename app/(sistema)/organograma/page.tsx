// ═══════════════════════════════════════════════════════════════════════
//  ORGANOGRAMA · O CADASTRO DE COLABORADORES
//
//  O cadastro de gente que não existia. Antes havia duas listas, e nenhuma
//  das duas era um cadastro: `perfis` (quem ENTRA no sistema, com FK para
//  `auth.users`) e a constante `TECNICOS` em lib/listas.ts, dez nomes
//  chumbados no código, onde mudar a equipe exigia deploy.
//
//  É daqui que sai QUEM PODE LIDERAR projeto — e liderar é aprovar campo.
//  Ver `lideresDisponiveis()` em lib/consultas.ts.
//
//  EXCLUSIVO DA DIREÇÃO, inclusive para LER. `exigirPapel` aqui é a
//  checagem autoritativa: o middleware já barrou pela lista em
//  ROTAS_RESTRITAS, mas ele lê o papel do cookie, e só esta consulta sabe o
//  papel de agora. E nenhuma das duas é a barreira final — a política de
//  `colaboradores` (supabase/08_organograma.sql) é, e ela também fecha a
//  LEITURA, diferente de `hoteis`: cargo, setor, contato e vínculo da
//  empresa inteira não são dado de navegação.
// ═══════════════════════════════════════════════════════════════════════

import { exigirPapel } from "@/lib/sessao";
import { carregarColaboradores, carregarDados } from "@/lib/dados";
import { Organograma } from "@/app/(sistema)/organograma/Organograma";

export const dynamic = "force-dynamic";

export default async function PaginaDoOrganograma() {
  const usuario = await exigirPapel(["direcao"]);

  const [{ colaboradores, existe }, dados] = await Promise.all([
    carregarColaboradores(usuario.accessToken),
    carregarDados(usuario.accessToken),
  ]);

  // Quantos projetos cada líder lidera. A tela mostra a coluna, e é o
  // número que ela usa para avisar antes de tirar a autorização de alguém
  // ou excluí-lo. Contado aqui porque cruzar a lista de projetos dentro de
  // cada linha refaria a conta N vezes.
  const projetosPorLider = new Map<string, number>();
  for (const p of dados.projetos) {
    if (!p.lider_id) continue;
    projetosPorLider.set(p.lider_id, (projetosPorLider.get(p.lider_id) ?? 0) + 1);
  }

  // O ACESSO DO SISTEMA (`perfis`) NÃO VAI PARA A TELA. Ele não se edita no
  // formulário nem se lê no detalhe: os 32 colaboradores nasceram já
  // ligados ao acesso deles (ver o bloco 4 de supabase/08_organograma.sql),
  // e quem entrar sem acesso só precisa de um se for liderar projeto — caso
  // em que o banco recusa e a tela explica.
  return (
    <Organograma
      colaboradores={colaboradores}
      projetosPorLider={Object.fromEntries(projetosPorLider)}
      tabelaExiste={existe}
    />
  );
}
