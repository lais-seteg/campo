"use client";

import { useMemo, useState } from "react";
import { CabecalhoDeSecao } from "@/app/components/Tabela";
import { ListaDeHoteis } from "@/app/(sistema)/cadastros/ListaDeHoteis";
import { ListaDeDiarias } from "@/app/(sistema)/cadastros/ListaDeDiarias";
import type { DiariaValor, Hotel } from "@/lib/tipos";

type Aba = "hoteis" | "diarias";

interface Props {
  hoteis: Hotel[];
  diarias: DiariaValor[];
  usosPorHotel: Record<string, number>;
  podeAdministrar: boolean;
  v2Ativa: boolean;
}

export function TelaDeCadastros({ hoteis, diarias, usosPorHotel, podeAdministrar, v2Ativa }: Props) {
  const [aba, setAba] = useState<Aba>("hoteis");

  // A aba é estado local e não rota: são duas listas do mesmo assunto, e
  // dar endereço próprio a cada uma só encheria o histórico do navegador
  // de idas e vindas que ninguém quer refazer.
  const abas = useMemo(
    () =>
      [
        { chave: "hoteis" as const, rotulo: "Hotéis e pousadas" },
        { chave: "diarias" as const, rotulo: "Valor da diária" },
      ] satisfies readonly { chave: Aba; rotulo: string }[],
    []
  );

  // ── AS ABAS VIAJAM PARA DENTRO DA BARRA DE FILTROS ──
  //
  // Antes elas eram uma faixa própria acima da lista: uma linha inteira da
  // altura da tela gasta com dois botões. Agora vão como `abas` para a
  // lista, que as põe no começo da MESMA linha dos filtros — e a altura que
  // sobra é toda da tabela, que é o que se veio ver aqui.
  //
  // Passar JSX pronto (e não a lista de abas) é o que mantém a decisão de
  // "qual aba está ativa" aqui, num lugar só, em vez de duplicada nas duas
  // listas.
  const controleDeAbas = (
    <div className="cad-abas">
      {abas.map((a) => (
        <button
          className={`cad-aba${aba === a.chave ? " active" : ""}`}
          key={a.chave}
          type="button"
          onClick={() => setAba(a.chave)}
        >
          {a.rotulo}
        </button>
      ))}
    </div>
  );

  return (
    <section className="secao active">
      <CabecalhoDeSecao titulo="Cadastros" direita="Hotéis por município e o valor de referência da diária" />

      {aba === "hoteis" ? (
        <ListaDeHoteis
          hoteis={hoteis}
          usosPorHotel={usosPorHotel}
          podeExcluir={podeAdministrar}
          v2Ativa={v2Ativa}
          abas={controleDeAbas}
        />
      ) : (
        <ListaDeDiarias
          diarias={diarias}
          podeEditar={podeAdministrar}
          v2Ativa={v2Ativa}
          abas={controleDeAbas}
        />
      )}
    </section>
  );
}
