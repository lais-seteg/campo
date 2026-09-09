// ═══════════════════════════════════════════════════════════════════════
//  A FILA DO LÍDER
//
//  Não é a aprovação da Gestão que foi retirada: aquela autorizava gasto.
//  Esta responde outra pergunta, de outra pessoa — "este campo é do escopo
//  do MEU projeto?".
//
//  Só aparece o que ESTA pessoa tem para decidir: pedidos esperando nos
//  projetos que ela lidera. A Direção vê todos, porque é ela que destrava
//  campo de líder ausente.
//
//  Quem pede sendo o próprio líder não aparece aqui: o pedido já nasce
//  aprovado, porque ninguém espera por si mesmo.
// ═══════════════════════════════════════════════════════════════════════

import { exigirSessao } from "@/lib/sessao";
import { carregarDados } from "@/lib/dados";
import { CabecalhoDeSecao } from "@/app/components/Tabela";
import { TabelaDeFila, type ColunaDeFila } from "@/app/components/TabelaDeFila";
import { DetalheEmPopup } from "@/app/(sistema)/solicitacoes/[id]/DetalheEmPopup";
import { DecisaoDoLider } from "@/app/(sistema)/aprovacoes/DecisaoDoLider";
import { solicitacoesParaAprovar } from "@/lib/consultas";
import { ehDirecao, ehLider, podeVerValores } from "@/lib/papeis";

export const dynamic = "force-dynamic";

// O líder decide se AUTORIZA o campo. Para isso ele precisa de quem pede,
// para onde, para quando, com quem, quanto custa e se tem SST — e é
// exatamente esta lista.
//
// Sem Status: aqui todo pedido está "Aguardando aprovação" por definição da
// fila, e a coluna seria a mesma palavra repetida em todas as linhas.
const COLUNAS: readonly ColunaDeFila[] = [
  "codigo",
  "cliente",
  "escopo",
  "solicitante",
  "destino",
  "periodo",
  "equipe",
  "valores",
  "sst",
];

export default async function PaginaDeAprovacoes() {
  const usuario = await exigirSessao();
  const dados = await carregarDados(usuario.accessToken);

  const fila = solicitacoesParaAprovar(
    dados.solicitacoes,
    usuario.id,
    usuario.papel,
    dados.projetos
  );
  const direcao = ehDirecao(usuario.papel);
  const lidera = ehLider(usuario.id, usuario.papel, dados.projetos);

  return (
    <section className="secao active">
      <CabecalhoDeSecao
        titulo="Aprovações do líder"
        direita={
          direcao
            ? "Todos os campos aguardando o líder — a Direção também aprova"
            : "Campos aguardando sua decisão como líder"
        }
      />

      <TabelaDeFila
        fila={fila}
        colunas={COLUNAS}
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
            <DecisaoDoLider id={s.id} codigo={s.codigo} />
          </>
        )}
        vazio={
          !dados.estrutura.base
            ? "Estrutura do banco pendente."
            : lidera
              ? "Nada aguardando sua decisão."
              : "Você não lidera nenhum projeto."
        }
      />
    </section>
  );
}
