// Editar uma solicitação existente.
//
// Não se edita o que TERMINOU: pedido Finalizado ou Cancelado é registro,
// e reescrever registro apaga a história em vez de corrigi-la. Recusado
// também fica de fora — o líder já decidiu, e o caminho é abrir outro
// pedido, não reescrever o que ele recusou.
//
// A checagem é feita aqui E na rota PATCH: esta evita a tela abrir para
// nada, aquela é a que vale.

import { notFound, redirect } from "next/navigation";
import { exigirSessao } from "@/lib/sessao";
import { carregarDados } from "@/lib/dados";
import { FormularioDeSolicitacao } from "@/app/(sistema)/solicitacoes/formulario/FormularioDeSolicitacao";
import { formularioDeSolicitacao } from "@/app/(sistema)/solicitacoes/formulario/estado";
import { ehDirecao, podeEditar } from "@/lib/papeis";

export const dynamic = "force-dynamic";

export default async function PaginaDeEdicao({ params }: { params: { id: string } }) {
  const usuario = await exigirSessao();
  const dados = await carregarDados(usuario.accessToken);

  const s = dados.solicitacoes.find((x) => x.id === params.id);
  if (!s) notFound();

  if (!podeEditar(s.status) || s.status === "Recusada") {
    redirect(`/solicitacoes/${s.id}`);
  }

  return (
    <FormularioDeSolicitacao
      solicitacaoId={s.id}
      codigo={s.codigo}
      inicial={formularioDeSolicitacao(s)}
      projetos={dados.projetos}
      hoteis={dados.hoteis}
      catalogo={dados.catalogo}
      diariasCadastradas={dados.diarias}
      usuarioId={usuario.id}
      solicitanteNome={s.solicitante_nome}
      ehDirecao={ehDirecao(usuario.papel)}
      // Equipamento já entregue está fisicamente com a equipe: a linha é a
      // obrigação de devolver, e a edição não a toca. A tela diz quantos
      // ficaram de fora, em vez de deixar parecer que sumiram.
      equipamentosEntregues={s.equipamentos.filter((e) => e.entregue).length}
    />
  );
}
