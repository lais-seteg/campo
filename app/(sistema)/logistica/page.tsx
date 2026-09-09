// ═══════════════════════════════════════════════════════════════════════
//  LOGÍSTICA A CONFIRMAR
//
//  Era "Aprovações". Não se aprova mais nada aqui: o administrativo
//  CONFIRMA o que fechou — locadora e valor real do transporte, hotel de
//  cada cidade e a reserva do material nas datas do campo. É a confirmação
//  que move a solicitação de `Aprovada` para `Logística confirmada`.
//
//  Só entra o que o LÍDER JÁ APROVOU: fechar hotel e carro de um campo que
//  ele ainda não validou é gastar antes da hora.
// ═══════════════════════════════════════════════════════════════════════

import { exigirSessao } from "@/lib/sessao";
import { carregarDados } from "@/lib/dados";
import { CabecalhoDeSecao } from "@/app/components/Tabela";
import { TabelaDeFila } from "@/app/components/TabelaDeFila";
import { DetalheEmPopup } from "@/app/(sistema)/solicitacoes/[id]/DetalheEmPopup";
import { FecharLogistica } from "@/app/(sistema)/logistica/FecharLogistica";
import { porStatus } from "@/lib/consultas";
import { podeVerValores } from "@/lib/papeis";

export const dynamic = "force-dynamic";

export default async function PaginaDeLogistica() {
  const usuario = await exigirSessao();
  const dados = await carregarDados(usuario.accessToken);

  const fila = porStatus(dados.solicitacoes, "Aprovada");
  const aguardandoLider = porStatus(dados.solicitacoes, "Aguardando aprovação").length;

  return (
    <section className="secao active">
      <CabecalhoDeSecao titulo="Logística a confirmar" direita="Veículo, hospedagem e material reservado" />

      {/* Sem coluna de Status: a fila é exatamente o que está "Aprovada". A
          coluna que importa aqui é "Contém" — é ela que diz se falta
          fechar veículo, hotel ou material. */}
      <TabelaDeFila
        fila={fila}
        verValores={podeVerValores(usuario, dados.projetos)}
        acoes={(s) => (
          <>
            {/* As informações abrem em POPUP sobre a fila — o mesmo
                padrão do "Informações do Equipamento" do Controle de
                Estoque. A página do pedido continua no endereço, para
                link direto e para as ações. */}
            <DetalheEmPopup
              solicitacao={s}
              projetos={dados.projetos}
              catalogo={dados.catalogo}
              hoteis={dados.hoteis}
              perfis={dados.perfis}
              verValores={podeVerValores(usuario, dados.projetos)}
            />
            <FecharLogistica solicitacao={s} hoteis={dados.hoteis} catalogo={dados.catalogo} />
          </>
        )}
        vazio={
          dados.estrutura.base
            ? `Nenhuma logística pendente.${aguardandoLider ? ` ${aguardandoLider} pedido(s) ainda esperando o líder.` : ""}`
            : "Estrutura do banco pendente."
        }
      />
    </section>
  );
}
