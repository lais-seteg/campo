"use client";

// ═══════════════════════════════════════════════════════════════════════
//  AS INFORMAÇÕES DO PEDIDO EM POPUP
//
//  O olho das tabelas abre um modal sobre a tela em que a pessoa já está —
//  o mesmo desenho do `modalInfoEquipamento` do Controle de Estoque
//  ("Informações do Equipamento") e dos outros sistemas da pasta.
//
//  ── E A PÁGINA CONTINUA ──
//
//  `/solicitacoes/[id]` não foi embora, e não é por indecisão. Ela foi
//  criada de propósito quando isto era só um modal, e comprou três coisas
//  que o popup não dá: link de um pedido que se manda para alguém, botão
//  Voltar do navegador funcionando, e um endereço único para as cinco telas
//  apontarem. Perder isso para ganhar consistência visual seria uma troca
//  ruim.
//
//  Então: popup ao clicar na tabela (que é o gesto de todo dia), página ao
//  abrir o endereço. O corpo é o MESMO `InformacoesDaSolicitacao` nos dois
//  — o retrato do pedido não pode depender de por onde se entrou.
//
//  ── AÇÕES NÃO ENTRAM AQUI ──
//
//  Editar, cancelar, aprovar e acrescentar equipamento continuam na linha
//  da tabela e no rodapé da página. É o padrão do estoque (a janela de
//  informações mostra, não mexe) e evita modal dentro de modal, que é onde
//  o foco e a tecla Esc se perdem.
// ═══════════════════════════════════════════════════════════════════════

import Link from "next/link";
import { useCallback, useState } from "react";
import { Modal } from "@/app/components/Modal";
import { Icone } from "@/app/components/Icone";
import { useAvisos } from "@/app/components/Avisos";
import { InformacoesDaSolicitacao } from "@/app/(sistema)/solicitacoes/[id]/InformacoesDaSolicitacao";
import { get, mensagemDoErro } from "@/app/components/api";
import type {
  Hotel,
  Item,
  Perfil,
  Projeto,
  SolicitacaoAlteracao,
  SolicitacaoAssinatura,
  SolicitacaoDeLista,
} from "@/lib/tipos";

interface Carga {
  assinaturas: SolicitacaoAssinatura[];
  alteracoes: SolicitacaoAlteracao[];
}

export function DetalheEmPopup({
  solicitacao: s,
  projetos,
  catalogo,
  hoteis,
  perfis,
  verValores,
}: {
  solicitacao: SolicitacaoDeLista;
  projetos: readonly Projeto[];
  catalogo: readonly Item[];
  hoteis: readonly Hotel[];
  perfis: readonly Perfil[];
  verValores: boolean;
}) {
  const { avisar } = useAvisos();
  const [aberto, setAberto] = useState(false);
  const [carga, setCarga] = useState<Carga | null>(null);
  const [carregando, setCarregando] = useState(false);

  const abrir = useCallback(async () => {
    setAberto(true);
    // Recarrega a cada abertura: entre uma e outra alguém pode ter aprovado,
    // assinado ou editado, e um histórico em cache mostraria o pedido de
    // antes — justamente o que se veio conferir.
    setCarregando(true);
    try {
      setCarga(await get<Carga>(`/api/solicitacoes/${s.id}/detalhe`));
    } catch (erro) {
      avisar(mensagemDoErro(erro, "abrir as informações"), "erro");
    } finally {
      setCarregando(false);
    }
  }, [s.id, avisar]);

  return (
    <>
      <button
        className="btn-icon"
        type="button"
        title="Ver informações"
        aria-label="Ver informações"
        onClick={abrir}
      >
        <Icone nome="olho" />
      </button>

      <Modal
        titulo={`${s.codigo} · ${s.cliente_projeto || "sem projeto"}`}
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        rodape={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setAberto(false)}>
              Fechar
            </button>
            {/* A ponte para onde as AÇÕES vivem. Sem ela, quem abriu o popup
                e decidiu editar teria de fechar, procurar a linha de novo e
                achar outro botão. */}
            <Link className="btn btn-primary" href={`/solicitacoes/${s.id}`}>
              Abrir e editar
            </Link>
          </>
        }
      >
        {carregando && !carga ? (
          <p className="modal-hint">Carregando as informações…</p>
        ) : carga ? (
          <InformacoesDaSolicitacao
            solicitacao={s}
            projetos={projetos}
            catalogo={catalogo}
            hoteis={hoteis}
            perfis={perfis}
            assinaturas={carga.assinaturas}
            alteracoes={carga.alteracoes}
            verValores={verValores}
            // Sem botão de liberar folga: aqui é a janela de INFORMAÇÕES.
            // A liberação é ação, e mora no detalhe do pedido.
          />
        ) : (
          <p className="modal-hint">Não foi possível carregar as informações.</p>
        )}
      </Modal>
    </>
  );
}
