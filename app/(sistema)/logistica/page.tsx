// ═══════════════════════════════════════════════════════════════════════
//  LOGÍSTICA — o que falta fechar, e o que já foi fechado
//
//  Era "Aprovações". Não se aprova mais nada aqui: o administrativo
//  CONFIRMA o que fechou — locadora e valor real do transporte, hotel de
//  cada cidade e a reserva do material nas datas do campo. É a confirmação
//  que move a solicitação de `Aprovada` para `Logística confirmada`.
//
//  Só entra o que o LÍDER JÁ APROVOU: fechar hotel e carro de um campo que
//  ele ainda não validou é gastar antes da hora.
//
//  ── CONFIRMAR NÃO É SUMIR ──
//
//  A tela mostrava só a FILA — o que estava `Aprovada`. Confirmar a
//  logística tirava o pedido daqui, e com ele ia embora a única tela que
//  mostra qual pousada foi fechada e para que datas. Quem precisasse
//  telefonar para o hotel na véspera do campo tinha de procurar o pedido na
//  aba Solicitações e abrir o olho, pedido por pedido.
//
//  Isso confundia DUAS coisas: "o que ainda me dá trabalho" e "o que eu já
//  fechei". A primeira é uma fila, e fila esvazia. A segunda é uma AGENDA —
//  ela não some, é consultada.
//
//  Então são dois blocos na mesma tela, com a mesma tabela e a mesma coluna
//  de Hospedagem. Em cima o que falta; embaixo o que já está fechado, para
//  ver a casa, o período e o número da reserva.
//
//  ── ATÉ QUANDO FICA ──
//
//  Enquanto o campo não termina: `Logística confirmada` e `Em campo`.
//  Pedido finalizado, cancelado ou recusado sai — a logística dele virou
//  história e mora no olho, junto do resto do pedido. Uma agenda que guarda
//  tudo para sempre deixa de ser agenda.
// ═══════════════════════════════════════════════════════════════════════

import { exigirSessao } from "@/lib/sessao";
import { carregarDados } from "@/lib/dados";
import { CabecalhoDeSecao } from "@/app/components/Tabela";
import { TabelaDeFila, type ColunaDeFila } from "@/app/components/TabelaDeFila";
import { DetalheEmPopup } from "@/app/(sistema)/solicitacoes/[id]/DetalheEmPopup";
import { FecharLogistica } from "@/app/(sistema)/logistica/FecharLogistica";
import { porStatus } from "@/lib/consultas";
import { podeFecharLogistica, podeVerValores } from "@/lib/papeis";

export const dynamic = "force-dynamic";

// Aqui não se decide gasto, se EXECUTA: fechar carro, hotel e material. As
// perguntas são para onde, para quando, quantas pessoas — e agora ONDE
// DORMEM, que é a coluna que faltava para a tela responder sozinha.
//
// Sem Solicitante e sem Previsto × Real de propósito: quem confirma
// logística não escolhe pelo nome de quem pediu nem autoriza o valor. Os
// dois estão no olho, para quando a pergunta for sobre um pedido só.
//
// Sem Status: cada bloco já é um status só, e a coluna seria a mesma palavra
// repetida em todas as linhas.
const COLUNAS: readonly ColunaDeFila[] = [
  "codigo",
  "cliente",
  "escopo",
  "destino",
  "periodo",
  "equipe",
  "hospedagem",
];

export default async function PaginaDeLogistica() {
  const usuario = await exigirSessao();
  const dados = await carregarDados(usuario.accessToken);

  const aConfirmar = porStatus(dados.solicitacoes, "Aprovada");
  // `Em campo` entra: o material já saiu, mas a equipe está no hotel AGORA
  // e é justamente quando alguém liga perguntando da reserva.
  const confirmadas = dados.solicitacoes.filter(
    (s) => s.status === "Logística confirmada" || s.status === "Em campo"
  );
  const aguardandoLider = porStatus(dados.solicitacoes, "Aguardando aprovação").length;

  const verValores = podeVerValores(usuario, dados.projetos);

  return (
    <section className="secao active">
      <CabecalhoDeSecao titulo="Logística" direita="Veículo, hospedagem e material reservado" />

      <div className="secao-bloco">
      <h3 className="secao-subtitulo">A confirmar</h3>
      <TabelaDeFila
        fila={aConfirmar}
        colunas={COLUNAS}
        hoteis={dados.hoteis}
        verValores={verValores}
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
              verValores={verValores}
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
      </div>

      <div className="secao-bloco">
      <h3 className="secao-subtitulo">Já confirmada</h3>
      <TabelaDeFila
        fila={confirmadas}
        colunas={COLUNAS}
        hoteis={dados.hoteis}
        verValores={verValores}
        acoes={(s) => (
          <>
            <DetalheEmPopup
              solicitacao={s}
              projetos={dados.projetos}
              catalogo={dados.catalogo}
              hoteis={dados.hoteis}
              perfis={dados.perfis}
              verValores={verValores}
            />
            {/* O mesmo painel, para AJUSTAR o que foi fechado — o hotel
                mudou, a diária veio outra, chegou o número da reserva.
                Reconfirmar não reescreve o status nem carimba uma segunda
                data: quem cuida disso é a rota.

                Só aparece onde a rota aceita. Com o pedido `Em campo` ela
                responde 409 (`podeFecharLogistica`), e um botão que sempre
                dá erro é pior que botão nenhum — ali fica só o olho. */}
            {podeFecharLogistica(s.status) ? (
              <FecharLogistica
                solicitacao={s}
                hoteis={dados.hoteis}
                catalogo={dados.catalogo}
                jaConfirmada
              />
            ) : null}
          </>
        )}
        vazio="Nenhuma logística confirmada em campo aberto."
      />
      </div>
    </section>
  );
}
