// Abrir uma solicitação nova.
//
// A tela pede os cadastros (projetos, hotéis, catálogo, valores de diária)
// porque é deles que saem as listas e a sugestão de previsto. Tudo chega
// pronto do servidor — o formulário não consulta banco.

import { exigirSessao } from "@/lib/sessao";
import { carregarDados } from "@/lib/dados";
import { FormularioDeSolicitacao } from "@/app/(sistema)/solicitacoes/formulario/FormularioDeSolicitacao";
import { formularioVazio } from "@/app/(sistema)/solicitacoes/formulario/estado";
import { ehDirecao } from "@/lib/papeis";

export const dynamic = "force-dynamic";

export default async function PaginaDeNovaSolicitacao() {
  const usuario = await exigirSessao();
  const dados = await carregarDados(usuario.accessToken);

  return (
    <FormularioDeSolicitacao
      solicitacaoId={null}
      codigo={null}
      inicial={formularioVazio()}
      projetos={dados.projetos}
      hoteis={dados.hoteis}
      catalogo={dados.catalogo}
      diariasCadastradas={dados.diarias}
      usuarioId={usuario.id}
      solicitanteNome={usuario.nome}
      ehDirecao={ehDirecao(usuario.papel)}
      equipamentosEntregues={0}
    />
  );
}
