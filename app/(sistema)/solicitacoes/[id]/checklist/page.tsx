// ═══════════════════════════════════════════════════════════════════════
//  CHECKLIST DE CAMPO — a página de link direto
//
//  O jeito NORMAL de abrir a folha é o POPUP (`ChecklistEmPopup`), que
//  monta sobre a tabela em que a pessoa já está, sem trocar de tela e sem
//  perder filtro, busca e rolagem. Esta página continua existindo para
//  quem chega pelo endereço — link colado num grupo, favorito, um "abrir em
//  nova aba".
//
//  As duas montam a MESMA `FolhaDoChecklist`: documento com duas cópias de
//  layout diverge na primeira alteração, e o que sai no papel passaria a
//  depender de por onde se entrou.
//
//  Imprimir usa o print do navegador: o `@media print` do CSS esconde tudo
//  que não está em #checklistFolha.
// ═══════════════════════════════════════════════════════════════════════

import { notFound } from "next/navigation";
import { exigirSessao } from "@/lib/sessao";
import { carregarDados, carregarFilhasDaSolicitacao, carregarSituacaoDasAssinaturas } from "@/lib/dados";
import { BotoesDoChecklist } from "@/app/(sistema)/solicitacoes/[id]/checklist/BotoesDoChecklist";
import { FolhaDoChecklist } from "@/app/(sistema)/solicitacoes/[id]/checklist/FolhaDoChecklist";

export const dynamic = "force-dynamic";

export default async function PaginaDeChecklist({ params }: { params: { id: string } }) {
  const usuario = await exigirSessao();
  const dados = await carregarDados(usuario.accessToken);

  const s = dados.solicitacoes.find((x) => x.id === params.id);
  if (!s) notFound();

  if (!s.equipamentos.length) {
    return (
      <section className="secao active">
        <div className="empty-state" style={{ padding: "3rem 1rem" }}>
          <strong>Esta solicitação não tem equipamento para conferir.</strong>
          <p>O checklist existe para acompanhar material que sai e volta.</p>
        </div>
      </section>
    );
  }

  // As assinaturas vêm por solicitação, e não do carregamento global: são
  // PNG de até 400 mil caracteres, e trazê-las na lista fazia toda tela do
  // sistema carregar toda assinatura da empresa. A situação delas vem do
  // banco porque a pergunta "qual papel EU assino?" depende de
  // `eh_administrativo()` e de estar na equipe — coisas que só ele sabe
  // sobre `auth.uid()`.
  const [{ assinaturas }, situacao] = await Promise.all([
    carregarFilhasDaSolicitacao(usuario.accessToken, s.id),
    carregarSituacaoDasAssinaturas(usuario.accessToken, s.id),
  ]);

  return (
    <section className="secao active">
      <div className="sec-header">
        <h2>Checklist · {s.codigo}</h2>
        <div className="sec-header-right">
          <BotoesDoChecklist voltarPara={`/solicitacoes/${s.id}`} />
        </div>
      </div>

      {/* O invólucro é só a rolagem: a folha é mais alta que a tela, e
          `.secao` é `overflow:hidden`. Na impressão ele não atrapalha — o
          @media print tira `#checklistFolha` do fluxo. */}
      <div className="pagina-rolavel">
        <FolhaDoChecklist
          solicitacao={s}
          catalogo={dados.catalogo}
          assinaturas={assinaturas}
          situacao={situacao}
        />
      </div>
    </section>
  );
}
