// ═══════════════════════════════════════════════════════════════════════
//  CONFERÊNCIA DE EQUIPAMENTOS
//
//  O quadro CONFERÊNCIA do formulário em papel: entrega dos equipamentos
//  (ENT. + TESTE, com assinatura das duas partes) e, na volta, devolução
//  (DEV. + TESTE + AVARIA?).
//
//  É aqui que a integração com o Controle de Estoque acontece, e o
//  formulário deixa claro o formato: equipamento de campo é EMPRÉSTIMO,
//  não consumo. Registrar a entrega dá SAÍDA; a devolução dá ENTRADA.
//
//  Entra na fila tudo que tem equipamento, JÁ FOI APROVADO e não terminou:
//  antes da entrega (para registrar a saída) e depois dela (para registrar
//  a volta). Campo urgente não espera o hotel para levar o medidor, mas
//  espera o líder — o banco recusa a entrega antes disso.
// ═══════════════════════════════════════════════════════════════════════

import Link from "next/link";
import { exigirSessao } from "@/lib/sessao";
import { carregarDados } from "@/lib/dados";
import { CabecalhoDeSecao } from "@/app/components/Tabela";
import { TabelaDeFila } from "@/app/components/TabelaDeFila";
import { RegistrarConferencia } from "@/app/(sistema)/conferencia/RegistrarConferencia";
import { ChecklistEmPopup } from "@/app/(sistema)/solicitacoes/[id]/checklist/ChecklistEmPopup";
import { solicitacoesParaConferencia } from "@/lib/consultas";
import { podeVerValores } from "@/lib/papeis";
import { Icone } from "@/app/components/Icone";

export const dynamic = "force-dynamic";

export default async function PaginaDeConferencia() {
  const usuario = await exigirSessao();
  const dados = await carregarDados(usuario.accessToken);

  const fila = solicitacoesParaConferencia(dados.solicitacoes);

  return (
    <section className="secao active">
      <CabecalhoDeSecao titulo="Conferência de equipamentos" direita="Entrega e devolução do que sai para campo" />

      {/* AQUI a coluna de Status entra: a fila mistura "Aprovada",
          "Logística confirmada" e "Em campo", e é justamente ela que diz se
          o pedido está SAINDO (registrar entrega) ou VOLTANDO (registrar
          devolução). Nas outras duas filas o status é constante. */}
      <TabelaDeFila
        fila={fila}
        verValores={podeVerValores(usuario, dados.projetos)}
        mostrarStatus
        acoes={(s) => (
          <>
            <Link className="btn-icon" href={`/solicitacoes/${s.id}`} title="Ver">
              <Icone nome="olho" />
            </Link>
            {/* O checklist abre em POPUP sobre esta fila: é aqui que se
                confere, se assina e se registra, e sair da tela custaria o
                filtro e a rolagem de quem está trabalhando na lista. */}
            <ChecklistEmPopup solicitacao={s} catalogo={dados.catalogo} />
            <RegistrarConferencia
              solicitacao={s}
              catalogo={dados.catalogo}
              nomeDoAdministrativo={usuario.nome}
            />
          </>
        )}
        vazio={
          dados.estrutura.base
            ? "Nenhum equipamento aguardando conferência."
            : "Estrutura do banco pendente."
        }
      />
    </section>
  );
}
