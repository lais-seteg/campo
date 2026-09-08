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

import Link from "next/link";
import { exigirSessao } from "@/lib/sessao";
import { carregarDados } from "@/lib/dados";
import { CabecalhoDeSecao } from "@/app/components/Tabela";
import { TabelaDeFila } from "@/app/components/TabelaDeFila";
import { DecisaoDoLider } from "@/app/(sistema)/aprovacoes/DecisaoDoLider";
import { solicitacoesParaAprovar } from "@/lib/consultas";
import { ehDirecao, ehLider, podeVerValores } from "@/lib/papeis";
import { Icone } from "@/app/components/Icone";

export const dynamic = "force-dynamic";

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

      {/* Sem coluna de Status: aqui todo pedido está "Aguardando aprovação"
          por definição da fila — a coluna seria a mesma palavra repetida. */}
      <TabelaDeFila
        fila={fila}
        verValores={podeVerValores(usuario, dados.projetos)}
        acoes={(s) => (
          <>
            <Link className="btn-icon" href={`/solicitacoes/${s.id}`} title="Ver">
              <Icone nome="olho" />
            </Link>
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
