"use client";

// ═══════════════════════════════════════════════════════════════════════
//  REGISTRAR ENTREGA OU DEVOLUÇÃO
//
//  O modo é decidido pelo estado do pedido, não pela pessoa: sem
//  `entrega_data`, o que falta é a entrega; com ela, é a devolução. Era
//  assim na versão anterior (`abrirConferenciaAuto`) e continua — é a
//  ordem física dos fatos, e oferecer as duas opções convidaria a
//  registrar a volta de algo que não saiu.
//
//  ── DUAS ASSINATURAS, OBRIGATÓRIAS ──
//
//  É a assinatura desenhada que faz o checklist valer como documento; nome
//  digitado sozinho prova pouco. E ela ENTRA E NÃO SAI: uma por momento e
//  papel, sem update e sem delete pelo aplicativo.
// ═══════════════════════════════════════════════════════════════════════

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/app/components/Modal";
import { useAvisos } from "@/app/components/Avisos";
import { CampoMascarado, Caixa } from "@/app/components/Campos";
import { Icone } from "@/app/components/Icone";
import { mensagemDoErro, post } from "@/app/components/api";
import { dataBRparaISO, dataISOparaBR, formatarNumeroBR, hojeISO, parseMoeda } from "@/lib/formato";
import {
  GRAVIDADES_AVARIA,
  PROVIDENCIAS_AVARIA,
  type GravidadeAvaria,
  type Item,
  type ProvidenciaAvaria,
  type SolicitacaoDeLista,
} from "@/lib/tipos";

interface LinhaDeConferencia {
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

export function RegistrarConferencia({
  solicitacao: s,
  catalogo,
  nomeDoAdministrativo,
}: {
  solicitacao: SolicitacaoDeLista;
  catalogo: Item[];
  nomeDoAdministrativo: string;
}) {
  const roteador = useRouter();
  const { avisar } = useAvisos();

  // Sem entrega registrada, o que falta é a entrega. Com ela, a devolução.
  const entrega = !s.entrega_data;
  const momento = entrega ? "Retirada" : "Devolução";

  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [data, setData] = useState(() => dataISOparaBR(hojeISO()));
  const [adm, setAdm] = useState(nomeDoAdministrativo);
  // O prestador que assina é o LÍDER da equipe — é ele quem responde pelo
  // material em campo.
  const [prestador, setPrestador] = useState(() => s.equipe.find((e) => e.lider)?.colaborador ?? "");

  const itemPorId = new Map(catalogo.map((i) => [i.id, i]));
  const [linhas, setLinhas] = useState<LinhaDeConferencia[]>(() =>
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

  function trocar(indice: number, mudanca: Partial<LinhaDeConferencia>) {
    setLinhas((atual) => atual.map((l, i) => (i === indice ? { ...l, ...mudanca } : l)));
  }

  async function registrar() {
    const dataIso = dataBRparaISO(data);
    if (!dataIso || !adm.trim() || !prestador.trim()) {
      avisar("Preencha a data e os dois nomes.", "erro");
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
        adm,
        prestador,
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

      setAberto(false);

      // Item que NÃO VOLTOU mantém a solicitação em campo: o status só vai
      // para Finalizada quando todos foram conferidos de volta. Dizer o
      // que ficou faltando é o que permite ir atrás.
      if (!entrega && r.pendentes.length) {
        avisar(`Faltou voltar: ${r.pendentes.join(", ")}. A solicitação segue em campo.`, "erro");
      } else if (entrega) {
        avisar(`Entrega registrada · ${r.baixados} item(ns) com saída no estoque.`, "ok");
      } else {
        avisar(
          `Devolução registrada · ${r.devolvidos} item(ns) de volta no estoque${r.avarias ? ` · ${r.avarias} avaria(s) aberta(s)` : ""}.`,
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

  return (
    <>
      {/* SEMPRE ícone, nunca texto. Numa coluna de ações ao lado de outros
          botões de 27px, um "Registrar devolução" escrito é três vezes mais
          largo que os vizinhos e empurra a coluna inteira. O nome da ação
          não desaparece: vai para o `title` e para o `aria-label`, que é o
          mesmo tratamento das abas do menu em tela estreita. */}
      <button
        className="btn-icon"
        type="button"
        title={entrega ? "Registrar entrega" : "Registrar devolução"}
        aria-label={entrega ? "Registrar entrega" : "Registrar devolução"}
        onClick={() => setAberto(true)}
      >
        <Icone nome="caminhao" />
      </button>

      <Modal
        titulo={`${entrega ? "Entrega" : "Devolução"} · ${s.codigo}`}
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        rodape={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setAberto(false)} disabled={ocupado}>
              Cancelar
            </button>
            <button className="btn btn-primary" type="button" onClick={registrar} disabled={ocupado}>
              {ocupado ? "Registrando…" : "Registrar"}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label required" htmlFor="conf-data">
              {entrega ? "Data da entrega" : "Data da devolução"}
            </label>
            <CampoMascarado id="conf-data" mascara="data" valor={data} aoMudar={setData} />
          </div>
          <div className="form-group">
            <label className="form-label required" htmlFor="conf-adm">
              Nome do administrativo
            </label>
            <input
              id="conf-adm"
              className="form-control"
              placeholder="Quem entregou/recebeu"
              value={adm}
              onChange={(e) => setAdm(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label required" htmlFor="conf-prestador">
              Nome do prestador
            </label>
            <input
              id="conf-prestador"
              className="form-control"
              placeholder="Quem levou/devolveu"
              value={prestador}
              onChange={(e) => setPrestador(e.target.value)}
            />
          </div>
        </div>

        <div className="modal-subtitle">Equipamentos</div>
        <div>
          {linhas.map((l, indice) => (
            <div className="conf-linha" key={l.id}>
              <span className="conf-nome">
                {l.nome} <span className="mov-autor">· {l.quantidade}</span>
              </span>
              <Caixa marcada={l.marcado} aoMudar={(v) => trocar(indice, { marcado: v })}>
                {entrega ? "Entregue" : "Devolvido"}
              </Caixa>
              <Caixa marcada={l.teste} aoMudar={(v) => trocar(indice, { teste: v })}>
                Teste
              </Caixa>

              {!entrega ? (
                <>
                  <Caixa marcada={l.avaria} aoMudar={(v) => trocar(indice, { avaria: v })}>
                    Avaria
                  </Caixa>
                  <input
                    className="form-control c-avaria-obs"
                    placeholder="O que houve com o item"
                    value={l.observacao}
                    onChange={(e) => trocar(indice, { observacao: e.target.value })}
                  />
                  {/* Marcar avaria abre os campos de custo: sem eles a
                      avaria entraria no relatório sem a coluna pela qual o
                      relatório existe. */}
                  {l.avaria ? (
                    <div className="conf-avaria">
                      <select
                        className="form-control"
                        title="Gravidade"
                        value={l.gravidade}
                        onChange={(e) => trocar(indice, { gravidade: e.target.value as GravidadeAvaria })}
                      >
                        {GRAVIDADES_AVARIA.map((g) => (
                          <option key={g}>{g}</option>
                        ))}
                      </select>
                      <CampoMascarado
                        mascara="moeda"
                        valor={l.custo}
                        aoMudar={(v) => trocar(indice, { custo: v })}
                        placeholder="Custo estimado"
                      />
                      <select
                        className="form-control"
                        title="Providência"
                        value={l.providencia}
                        onChange={(e) => trocar(indice, { providencia: e.target.value as ProvidenciaAvaria })}
                      >
                        {PROVIDENCIAS_AVARIA.map((p) => (
                          <option key={p}>{p}</option>
                        ))}
                      </select>
                      <input
                        className="form-control"
                        placeholder="Fornecedor do reparo (abre manutenção)"
                        value={l.fornecedor}
                        onChange={(e) => trocar(indice, { fornecedor: e.target.value })}
                      />
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ))}
        </div>

        <p className="modal-hint">
          {entrega
            ? "Registrar a entrega dá SAÍDA dos itens no Controle de Estoque, vinculada a esta solicitação."
            : "Registrar a devolução dá ENTRADA dos itens no Controle de Estoque. Informar o fornecedor do reparo numa avaria abre a manutenção do bem lá — sem fornecedor, o item volta disponível e a avaria fica no relatório aguardando encaminhamento."}
        </p>

        {/* ── A ASSINATURA NÃO ACONTECE AQUI ──
            Ela saiu deste modal de propósito. Antes os dois quadros ficavam
            lado a lado e uma pessoa desenhava os dois traços no mesmo
            aparelho — o que provava que alguém desenhou duas vezes, e não
            quem eram. Agora cada um assina no PRÓPRIO acesso, no checklist,
            e a linha guarda quem estava logado.

            O registro abaixo só passa com as duas assinaturas de {momento}
            já no banco; quem cobra isso é `exigir_assinaturas()`, dentro da
            função que move o estoque. */}
        <p className="modal-hint">
          <strong>As assinaturas são feitas no checklist</strong>, cada um no seu acesso: o
          administrativo de um lado, quem recebe o material do outro. Este registro só passa
          quando as duas assinaturas de {momento.toLowerCase()} existirem — e é ele que move o
          estoque. A assinatura entra e não sai: registrada, não é reescrita pelo sistema.
        </p>
      </Modal>
    </>
  );
}
