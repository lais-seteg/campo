// A lista de solicitações — a tela inicial de quem não é Direção.
//
// O Server Component busca; o Client Component filtra, pagina e exporta.
// A divisão é essa em todas as telas: o que precisa do banco fica no
// servidor, o que precisa de teclado fica no cliente.

import { exigirSessao } from "@/lib/sessao";
import { carregarDados } from "@/lib/dados";
import { ListaDeSolicitacoes } from "@/app/(sistema)/solicitacoes/ListaDeSolicitacoes";
import { porStatus } from "@/lib/consultas";
import { ehDirecao, podeVerValores } from "@/lib/papeis";

export const dynamic = "force-dynamic";

export default async function PaginaDeSolicitacoes() {
  const usuario = await exigirSessao();
  const dados = await carregarDados(usuario.accessToken);

  return (
    <ListaDeSolicitacoes
      solicitacoes={dados.solicitacoes}
      estrutura={dados.estrutura}
      // O resumo da barra de filtros mostra estes três números — contados
      // aqui, no servidor, sobre a lista INTEIRA. Contar no cliente daria
      // o número da página filtrada, que responde outra pergunta.
      aguardandoLider={porStatus(dados.solicitacoes, "Aguardando aprovação").length}
      comLogisticaAFechar={porStatus(dados.solicitacoes, "Aprovada").length}
      emCampo={porStatus(dados.solicitacoes, "Em campo").length}
      // Para o atalho de conferência direto da lista — o mesmo que o
      // `abrirConferenciaAuto` da versão anterior fazia.
      catalogo={dados.catalogo}
      nomeDoAdministrativo={usuario.nome}
      // O formulário de solicitação virou POPUP sobre esta lista. Ele não
      // consulta banco — recebe os cadastros prontos, e é daqui que eles
      // saem agora. É a mesma lista que a página /solicitacoes/nova
      // montava; ela continua existindo para quem chegar pela URL.
      projetos={dados.projetos}
      hoteis={dados.hoteis}
      diariasCadastradas={dados.diarias}
      usuarioId={usuario.id}
      solicitanteNome={usuario.nome}
      ehDirecao={ehDirecao(usuario.papel)}
      // Previsto, Real e Curso são dinheiro consolidado: saem da tabela, do
      // filtro e do CSV para quem não responde por ele. O pedido continua
      // inteiro na tela — quem abre campo precisa ver o campo.
      verValores={podeVerValores(usuario, dados.projetos)}
    />
  );
}
