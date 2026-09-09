// ═══════════════════════════════════════════════════════════════════════
//  O DETALHE DA SOLICITAÇÃO
//
//  Era um modal aceso por `abrirDetalhe(id)` a partir de cinco telas
//  diferentes, com o corpo montado por template string. Virou uma PÁGINA
//  com endereço próprio, e isso resolve três coisas de uma vez: dá para
//  mandar o link de um pedido para alguém, o botão Voltar do navegador
//  funciona, e as cinco telas passam a apontar para o mesmo lugar em vez
//  de cada uma reabrir o mesmo modal.
// ═══════════════════════════════════════════════════════════════════════

import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirSessao } from "@/lib/sessao";
import { carregarDados, carregarFilhasDaSolicitacao } from "@/lib/dados";
import { AcoesDaSolicitacao } from "@/app/(sistema)/solicitacoes/[id]/AcoesDaSolicitacao";
import { InformacoesDaSolicitacao } from "@/app/(sistema)/solicitacoes/[id]/InformacoesDaSolicitacao";
import { ehDirecao, podeAprovar, podeEditar, podeLiberarFolga, podeVerValores } from "@/lib/papeis";
import { formularioDeSolicitacao } from "@/app/(sistema)/solicitacoes/formulario/estado";

export const dynamic = "force-dynamic";

export default async function PaginaDeDetalhe({ params }: { params: { id: string } }) {
  const usuario = await exigirSessao();
  const dados = await carregarDados(usuario.accessToken);

  const s = dados.solicitacoes.find((x) => x.id === params.id);
  if (!s) notFound();

  // Só a página mostra o botão de liberar a folga: o popup de informações
  // é leitura, e a liberação é ação. Ver `InformacoesDaSolicitacao`.
  const liberarFolga = podeLiberarFolga(usuario.papel);

  // Assinatura e histórico vêm POR SOLICITAÇÃO, e não do carregamento
  // global: as assinaturas são PNG de até 400 mil caracteres e o histórico
  // cresce para sempre. Enquanto estavam na leitura global, abrir o
  // calendário carregava as duas coisas da empresa inteira. Ver
  // `carregarFilhasDaSolicitacao`.
  const { assinaturas, alteracoes } = await carregarFilhasDaSolicitacao(usuario.accessToken, s.id);

  // Previsto × real é dinheiro consolidado: vê quem responde por ele — o
  // líder deste projeto, administrativo, financeiro e Direção. Quem abre o
  // pedido continua vendo tudo o que PEDIU (despesas, diárias, hospedagem):
  // o que sai da tela é a comparação orçamentária, não o pedido dele.
  const verValores = podeVerValores(usuario, dados.projetos);

  return (
    <section className="secao active">
      <div className="sec-header">
        <h2>
          {s.codigo} · {s.cliente_projeto}
        </h2>
        <div className="sec-header-right">
          <Link className="btn btn-ghost btn-sm" href="/solicitacoes">
            ← Voltar
          </Link>
        </div>
      </div>

      {/* `pagina-rolavel` devolve a rolagem que o `.modal-body` dava quando
          isto era um modal — sem ela, `.secao{overflow:hidden}` corta tudo
          abaixo da primeira tela. Ver o bloco no fim de app/globals.css. */}
      <div className="lista-wrapper pagina-rolavel" style={{ padding: "1.2rem" }}>
        {/* O CORPO É O MESMO DO POPUP: `InformacoesDaSolicitacao`.
            O retrato do pedido não pode depender de por onde a
            pessoa entrou. Aqui ele vem com `liberarFolga`, porque
            esta é a tela onde ações fazem sentido. */}
        <InformacoesDaSolicitacao
          solicitacao={s}
          projetos={dados.projetos}
          catalogo={dados.catalogo}
          hoteis={dados.hoteis}
          perfis={dados.perfis}
          assinaturas={assinaturas}
          alteracoes={alteracoes}
          verValores={verValores}
          liberarFolga={liberarFolga}
        />

        <AcoesDaSolicitacao
          id={s.id}
          codigo={s.codigo}
          status={s.status}
          temEquipamento={s.equipamentos.length > 0}
          // Editar e acrescentar valem enquanto o pedido está andando.
          // Pedido finalizado, cancelado ou recusado é registro.
          podeEditar={podeEditar(s.status) && s.status !== "Recusada"}
          podeDecidir={podeAprovar(usuario.id, usuario.papel, s, dados.projetos)}
          catalogo={dados.catalogo}
          periodo={{ inicio: s.periodo_inicio, fim: s.periodo_fim }}
          // Para o popup do checklist montar a folha sem uma segunda ida ao
          // banco: a solicitação já está carregada aqui.
          solicitacao={s}
          // O formulário de edição abre em POPUP sobre este detalhe, e ele
          // não consulta banco: recebe os cadastros prontos. Só é montado
          // quando o pedido é editável — pedido encerrado não tem lápis.
          formulario={
            podeEditar(s.status) && s.status !== "Recusada"
              ? {
                  inicial: formularioDeSolicitacao(s),
                  projetos: dados.projetos,
                  hoteis: dados.hoteis,
                  diariasCadastradas: dados.diarias,
                  usuarioId: usuario.id,
                  solicitanteNome: s.solicitante_nome,
                  ehDirecao: ehDirecao(usuario.papel),
                  // Equipamento já entregue está com a equipe: a linha é a
                  // obrigação de devolver, e a edição não a toca.
                  equipamentosEntregues: s.equipamentos.filter((e) => e.entregue).length,
                }
              : null
          }
        />
      </div>
    </section>
  );
}
