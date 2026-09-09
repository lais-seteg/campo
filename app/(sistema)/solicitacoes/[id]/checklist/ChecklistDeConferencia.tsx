"use client";

// ═══════════════════════════════════════════════════════════════════════
//  O CHECKLIST QUE SE PREENCHE NA TELA
//
//  A folha deixou de ser só impressão. Aqui se marca item por item, se
//  descreve a avaria, cada um assina o seu lado e se registra — e é o
//  registro que move o estoque.
//
//  ── VIVO, E NÃO CONGELADO ──
//
//  A Ordem de Compra do SGC (que este checklist imita) é um documento
//  CONGELADO: emitida uma vez, o HTML editado é salvo, e a partir dali ela
//  é papel. Aqui não pode ser assim — a folha é validada duas vezes e os
//  quadradinhos dela são o que dá baixa no estoque. Documento congelado
//  passaria a mentir sobre o material: um X escrito à mão no HTML não baixa
//  nada.
//
//  Então a ESTRUTURA é gerada e viva, e o que se edita livremente são as
//  OBSERVAÇÕES — em texto, o que dispensa o sanitizador de HTML que a OC
//  precisou ter.
//
//  ── AS MARCAS SÃO ENCENADAS ATÉ O REGISTRO ──
//
//  Clicar num quadradinho não grava nada sozinho. As marcas ficam na tela
//  até "Registrar", que manda tudo numa transação — a mesma de sempre
//  (`registrar_entrega_solicitacao` / `..._devolucao_...`). Gravar clique
//  por clique deixaria o estoque a meio caminho quando a conexão caísse, e
//  foi justamente disso que a v3 fugiu.
//
//  ── ASSINAR É OUTRO ATO, E É AGORA ──
//
//  A assinatura NÃO espera o registro: ela é gravada na hora, sozinha, por
//  quem está logado. É o contrário da ordem antiga (registrava e assinava),
//  e é o que permite o administrativo assinar do acesso dele e o solicitante
//  do dele — o registro depois exige as duas.
// ═══════════════════════════════════════════════════════════════════════

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useAvisos } from "@/app/components/Avisos";
import { CampoMascarado } from "@/app/components/Campos";
import { Assinatura, type ControleDaAssinatura } from "@/app/components/Assinatura";
import { mensagemDoErro, patch, post } from "@/app/components/api";
import { dataBRparaISO, dataISOparaBR, formatarNumeroBR, hojeISO, parseMoeda } from "@/lib/formato";
import {
  GRAVIDADES_AVARIA,
  PROVIDENCIAS_AVARIA,
  type GravidadeAvaria,
  type Item,
  type MomentoAssinatura,
  type ProvidenciaAvaria,
  type SolicitacaoDeLista,
} from "@/lib/tipos";

/** O que `situacao_das_assinaturas()` devolve por momento. */
export interface SituacaoDaAssinatura {
  momento: MomentoAssinatura;
  adm_assinada: boolean;
  prestador_assinada: boolean;
  /** O papel que EU posso assinar, ou null se não sou parte deste pedido. */
  eu_assino: "Administrativo" | "Prestador" | null;
}

interface Linha {
  id: string;
  nome: string;
  quantidade: number;
  marcado: boolean;
  teste: boolean;
  avaria: boolean;
  observacao: string;
  gravidade: GravidadeAvaria;
  custo: string;
  providencia: ProvidenciaAvaria;
  fornecedor: string;
}

export function ChecklistDeConferencia({
  solicitacao: s,
  catalogo,
  assinaturas,
  podeConferir,
}: {
  solicitacao: SolicitacaoDeLista;
  catalogo: Item[];
  assinaturas: readonly SituacaoDaAssinatura[];
  /** O status permite conferir? Fora da janela, a folha é só leitura. */
  podeConferir: boolean;
}) {
  const roteador = useRouter();
  const { avisar } = useAvisos();

  // Sem entrega registrada, o que falta é a retirada. Com ela, a devolução.
  // É a ordem física dos fatos: oferecer as duas convidaria a registrar a
  // volta de algo que não saiu.
  const entrega = !s.entrega_data;
  const momento: MomentoAssinatura = entrega ? "Retirada" : "Devolução";
  const encerrado = !!s.devolucao_data;

  const [data, setData] = useState(() => dataISOparaBR(hojeISO()));
  const [ocupado, setOcupado] = useState(false);

  const itemPorId = new Map(catalogo.map((i) => [i.id, i]));
  const [linhas, setLinhas] = useState<Linha[]>(() =>
    s.equipamentos.map((e) => {
      const item = e.item_id ? itemPorId.get(e.item_id) : undefined;
      const avariaAberta = s.avarias.find((a) => a.solicitacao_equipamento_id === e.id);
      return {
        id: e.id,
        nome: item ? `${item.produto} · ${item.codigo}` : (e.descricao ?? "Item fora do catálogo"),
        quantidade: e.quantidade,
        marcado: entrega ? e.entregue : e.devolvido,
        teste: entrega ? e.teste_entrega : e.teste_devolucao,
        avaria: e.avaria,
        observacao: e.avaria_obs ?? "",
        gravidade: avariaAberta?.gravidade ?? "Leve",
        custo: avariaAberta ? formatarNumeroBR(avariaAberta.custo_estimado) : "",
        providencia: avariaAberta?.providencia ?? "Em análise",
        fornecedor: avariaAberta?.fornecedor ?? "",
      };
    })
  );

  function trocar(indice: number, mudanca: Partial<Linha>) {
    setLinhas((atual) => atual.map((l, i) => (i === indice ? { ...l, ...mudanca } : l)));
  }

  /** Marcar todos de uma vez: numa retirada de doze itens, conferidos e
   *  testados, doze pares de cliques é onde alguém desiste de conferir. */
  function marcarTodos() {
    setLinhas((atual) => atual.map((l) => ({ ...l, marcado: true, teste: true })));
  }

  async function registrar() {
    const dataIso = dataBRparaISO(data);
    if (!dataIso) {
      avisar("Informe a data.", "erro");
      return;
    }
    setOcupado(true);
    try {
      const r = await post<{
        baixados: number;
        devolvidos: number;
        avarias: number;
        pendentes: string[];
      }>(`/api/solicitacoes/${s.id}/conferencia`, {
        modo: entrega ? "entrega" : "devolucao",
        data: dataIso,
        // Os nomes vão como reserva: a função prefere os das assinaturas,
        // para o cabeçalho impresso nunca divergir de quem assinou.
        adm: s.entrega_adm ?? "",
        prestador: s.equipe.find((e) => e.lider)?.colaborador ?? "",
        itens: linhas.map((l) =>
          entrega
            ? { id: l.id, entregue: l.marcado, teste: l.teste }
            : {
                id: l.id,
                devolvido: l.marcado,
                teste: l.teste,
                avaria: l.avaria,
                avaria_obs: l.observacao,
                avaria_custo: parseMoeda(l.custo),
                avaria_gravidade: l.gravidade,
                avaria_providencia: l.providencia,
                avaria_fornecedor: l.fornecedor,
              }
        ),
      });

      if (!entrega && r.pendentes.length) {
        avisar(`Faltou voltar: ${r.pendentes.join(", ")}. A solicitação segue em campo.`, "erro");
      } else if (entrega) {
        avisar(`Retirada registrada · ${r.baixados} item(ns) com saída no estoque.`, "ok");
      } else {
        avisar(
          `Devolução registrada · ${r.devolvidos} item(ns) de volta${r.avarias ? ` · ${r.avarias} avaria(s)` : ""}.`,
          "ok"
        );
      }
      roteador.refresh();
    } catch (erro) {
      avisar(mensagemDoErro(erro, "registrar a conferência"), "erro");
    } finally {
      setOcupado(false);
    }
  }

  const situacao = assinaturas.find((a) => a.momento === momento);
  const faltamAssinaturas = !situacao?.adm_assinada || !situacao?.prestador_assinada;

  return (
    <>
      <div className="chk-acoes chk-sem-print">
        <div className="chk-acoes-linha">
          <strong>{encerrado ? "Conferência encerrada" : `Conferir ${momento.toLowerCase()}`}</strong>
          {!encerrado && podeConferir ? (
            <>
              <span className="chk-acoes-data">
                Data
                <CampoMascarado mascara="data" valor={data} aoMudar={setData} placeholder="dd/mm/aaaa" />
              </span>
              <button className="btn btn-ghost btn-sm" type="button" onClick={marcarTodos}>
                Marcar todos
              </button>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={registrar}
                disabled={ocupado || faltamAssinaturas}
                title={
                  faltamAssinaturas
                    ? "Faltam assinaturas: cada um assina no próprio acesso, abaixo"
                    : undefined
                }
              >
                {ocupado ? "Registrando…" : `Registrar ${momento.toLowerCase()}`}
              </button>
            </>
          ) : null}
        </div>
        {!encerrado && podeConferir ? (
          <p className="modal-hint" style={{ margin: 0 }}>
            {entrega
              ? "Registrar a retirada dá SAÍDA dos itens no Controle de Estoque, vinculada a esta solicitação."
              : "Registrar a devolução dá ENTRADA no estoque. Informar o fornecedor do reparo numa avaria abre a manutenção do bem lá — sem fornecedor, o item volta disponível e a avaria fica no relatório aguardando encaminhamento."}
            {faltamAssinaturas
              ? " O botão só libera quando as duas assinaturas deste momento existirem."
              : ""}
          </p>
        ) : null}
      </div>

      <table className="chk-itens">
        <thead>
          <tr>
            <th rowSpan={2}>#</th>
            <th rowSpan={2}>Equipamento</th>
            <th rowSpan={2}>Qtd.</th>
            <th colSpan={2}>Retirada</th>
            <th colSpan={3}>Devolução</th>
            <th rowSpan={2}>Observação</th>
          </tr>
          <tr>
            <th>Conf.</th>
            <th>Teste</th>
            <th>Conf.</th>
            <th>Teste</th>
            <th>Avaria</th>
          </tr>
        </thead>
        <tbody>
          {s.equipamentos.map((e, i) => {
            const l = linhas[i];
            const editavel = !encerrado && podeConferir;
            return (
              <tr key={e.id}>
                <td className="chk-num">{String(i + 1).padStart(2, "0")}</td>
                <td className="chk-item">{l?.nome ?? "—"}</td>
                <td>{e.quantidade}</td>
                {/* Só os quadradinhos DO MOMENTO são clicáveis. Na devolução,
                    os da retirada são história: reabri-los deixaria alterar
                    o que já deu baixa no estoque. */}
                <td>
                  <MarcaEditavel
                    marcado={entrega ? (l?.marcado ?? false) : e.entregue}
                    editavel={editavel && entrega}
                    aoMudar={(v) => trocar(i, { marcado: v })}
                  />
                </td>
                <td>
                  <MarcaEditavel
                    marcado={entrega ? (l?.teste ?? false) : e.teste_entrega}
                    editavel={editavel && entrega}
                    aoMudar={(v) => trocar(i, { teste: v })}
                  />
                </td>
                <td>
                  <MarcaEditavel
                    marcado={entrega ? e.devolvido : (l?.marcado ?? false)}
                    editavel={editavel && !entrega}
                    aoMudar={(v) => trocar(i, { marcado: v })}
                  />
                </td>
                <td>
                  <MarcaEditavel
                    marcado={entrega ? e.teste_devolucao : (l?.teste ?? false)}
                    editavel={editavel && !entrega}
                    aoMudar={(v) => trocar(i, { teste: v })}
                  />
                </td>
                <td>
                  <MarcaEditavel
                    marcado={entrega ? e.avaria : (l?.avaria ?? false)}
                    editavel={editavel && !entrega}
                    aoMudar={(v) => trocar(i, { avaria: v })}
                  />
                </td>
                <td className="chk-obs">
                  {editavel && !entrega ? (
                    <input
                      className="form-control chk-obs-campo"
                      placeholder={l?.avaria ? "Descreva a avaria" : "—"}
                      value={l?.observacao ?? ""}
                      onChange={(ev) => trocar(i, { observacao: ev.target.value })}
                    />
                  ) : (
                    (e.avaria_obs ?? "")
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ── A AVARIA, ITEM A ITEM ──
          Só aparece na devolução e só para o item marcado com avaria: antes
          de sair não há o que avariar, e um painel por item apareceria doze
          vezes vazio. */}
      {!encerrado && podeConferir && !entrega && linhas.some((l) => l.avaria) ? (
        <div className="chk-avarias chk-sem-print">
          <div className="modal-subtitle">Avaria</div>
          {linhas.map((l, i) =>
            l.avaria ? (
              <div className="chk-avaria-linha" key={l.id}>
                <strong>{l.nome}</strong>
                <select
                  className="form-control"
                  value={l.gravidade}
                  aria-label={`Gravidade da avaria de ${l.nome}`}
                  onChange={(e) => trocar(i, { gravidade: e.target.value as GravidadeAvaria })}
                >
                  {GRAVIDADES_AVARIA.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
                <select
                  className="form-control"
                  value={l.providencia}
                  aria-label={`Providência da avaria de ${l.nome}`}
                  onChange={(e) => trocar(i, { providencia: e.target.value as ProvidenciaAvaria })}
                >
                  {PROVIDENCIAS_AVARIA.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
                <CampoMascarado
                  mascara="moeda"
                  valor={l.custo}
                  aoMudar={(v) => trocar(i, { custo: v })}
                  placeholder="Custo estimado"
                />
                <input
                  className="form-control"
                  placeholder="Fornecedor do reparo (abre manutenção)"
                  value={l.fornecedor}
                  onChange={(e) => trocar(i, { fornecedor: e.target.value })}
                />
              </div>
            ) : null
          )}
        </div>
      ) : null}
    </>
  );
}

/** O quadradinho: X quando marcado, vazio quando não. Editável, vira botão
 *  — mesmo desenho, para a folha impressa continuar idêntica. */
function MarcaEditavel({
  marcado,
  editavel,
  aoMudar,
}: {
  marcado: boolean;
  editavel: boolean;
  aoMudar: (v: boolean) => void;
}) {
  if (!editavel) {
    return marcado ? <span className="chk-box chk-box-on">X</span> : <span className="chk-box" />;
  }
  return (
    <button
      type="button"
      className={`chk-box chk-box-btn${marcado ? " chk-box-on" : ""}`}
      aria-pressed={marcado}
      aria-label={marcado ? "Desmarcar" : "Marcar"}
      onClick={() => aoMudar(!marcado)}
    >
      {marcado ? "X" : ""}
    </button>
  );
}

/**
 * O bloco de uma assinatura: mostra a que já existe, ou o quadro para
 * assinar — e só para quem pode assinar AQUELE papel.
 *
 * Quem decide o papel é o banco (`assinar_conferencia`), a partir de quem
 * está logado. Este componente não manda papel nenhum: se mandasse, uma
 * pessoa poderia assinar as duas linhas, que é o que este desenho evita.
 */
export function AssinarNoChecklist({
  solicitacaoId,
  momento,
  papel,
  jaAssinada,
  euAssino,
  bloqueado,
  motivoDoBloqueio,
}: {
  solicitacaoId: string;
  momento: MomentoAssinatura;
  papel: "Administrativo" | "Prestador";
  jaAssinada: boolean;
  euAssino: "Administrativo" | "Prestador" | null;
  bloqueado: boolean;
  motivoDoBloqueio?: string;
}) {
  const roteador = useRouter();
  const { avisar } = useAvisos();
  const quadro = useRef<ControleDaAssinatura>(null);
  const [ocupado, setOcupado] = useState(false);

  if (jaAssinada || euAssino !== papel) return null;

  if (bloqueado) {
    return <p className="chk-assinar-aviso chk-sem-print">{motivoDoBloqueio}</p>;
  }

  async function assinar() {
    const imagem = quadro.current?.capturar() ?? null;
    if (!imagem) {
      avisar("Desenhe a assinatura no quadro antes de confirmar.", "erro");
      return;
    }
    setOcupado(true);
    try {
      await post(`/api/solicitacoes/${solicitacaoId}/assinaturas`, { momento, imagem });
      avisar(`Assinatura de ${momento.toLowerCase()} registrada.`, "ok");
      roteador.refresh();
    } catch (erro) {
      avisar(mensagemDoErro(erro, "assinar"), "erro");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="chk-assinar chk-sem-print">
      <Assinatura ref={quadro} rotulo={`Assine aqui · ${papel}`} />
      <button className="btn btn-primary btn-sm" type="button" onClick={assinar} disabled={ocupado}>
        {ocupado ? "Registrando…" : "Confirmar assinatura"}
      </button>
      <span className="chk-assinar-nota">
        Entra e não sai: registrada, não é reescrita pelo sistema.
      </span>
    </div>
  );
}

/**
 * A área editável da folha. Salva sob demanda, e não a cada tecla: o
 * pedido é uma linha de banco, não um documento colaborativo, e gravar por
 * caractere transformaria uma frase em cinquenta escritas.
 */
export function ObservacoesDoChecklist({
  solicitacaoId,
  inicial,
  editavel,
}: {
  solicitacaoId: string;
  inicial: string;
  editavel: boolean;
}) {
  const roteador = useRouter();
  const { avisar } = useAvisos();
  const [texto, setTexto] = useState(inicial);
  const [ocupado, setOcupado] = useState(false);
  const sujo = texto !== inicial;

  async function salvar() {
    setOcupado(true);
    try {
      await patch(`/api/solicitacoes/${solicitacaoId}/checklist`, { observacoes: texto });
      avisar("Observações salvas.", "ok");
      roteador.refresh();
    } catch (erro) {
      avisar(mensagemDoErro(erro, "salvar as observações"), "erro");
    } finally {
      setOcupado(false);
    }
  }

  // Sem texto e sem poder editar, o bloco não tem por que ocupar a folha.
  if (!editavel && !texto.trim()) return null;

  return (
    <div className="chk-observacoes">
      <strong>Observações</strong>
      {editavel ? (
        <>
          <textarea
            className="form-control chk-sem-print"
            rows={3}
            placeholder="O que o formulário não previu: o tripé foi sem a bolsa, o cliente exige crachá na portaria…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          {/* O texto salvo aparece na impressão; a caixa de edição, não. */}
          <p className="chk-observacoes-impresso">{texto}</p>
          <button
            className="btn btn-ghost btn-sm chk-sem-print"
            type="button"
            onClick={salvar}
            disabled={ocupado || !sujo}
          >
            {ocupado ? "Salvando…" : sujo ? "Salvar observações" : "Salvo"}
          </button>
        </>
      ) : (
        <p className="chk-observacoes-impresso">{texto}</p>
      )}
    </div>
  );
}
