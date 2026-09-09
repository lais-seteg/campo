"use client";

// ═══════════════════════════════════════════════════════════════════════
//  O QUE O ADMINISTRATIVO FECHOU
//
//  Duas ações, e não uma: SALVAR guarda o que já se sabe; CONFIRMAR move o
//  status. A logística raramente fecha de uma vez — o carro sai hoje, o
//  hotel na quinta —, e obrigar a confirmar para não perder o que já foi
//  negociado faria confirmar o que ainda não está fechado.
//
//  Confirmar tenta GARANTIR a reserva antes de mudar o status: dizer
//  "logística confirmada" com material não reservado seria confirmar o que
//  não está fechado. Quem confere é a função no banco.
// ═══════════════════════════════════════════════════════════════════════

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/app/components/Modal";
import { useAvisos } from "@/app/components/Avisos";
import { CampoMascarado } from "@/app/components/Campos";
import { Selo } from "@/app/components/Tabela";
import { Icone } from "@/app/components/Icone";
import { mensagemDoErro, post } from "@/app/components/api";
import { formatarMoeda, formatarNumeroBR, parseMoeda } from "@/lib/formato";
import { LOCADORAS, type Hotel, type Item, type Locadora, type SolicitacaoDeLista } from "@/lib/tipos";

const MODALIDADES = ["Locação", "Frota própria", "Aéreo", "Rodoviário", "Aplicativo", "Outros"] as const;

interface LinhaDeHospedagem {
  id: string;
  cidade: string;
  dias: number;
  hotelId: string;
  diaria: string;
  reserva: string;
}

export function FecharLogistica({
  solicitacao: s,
  hoteis,
  catalogo,
}: {
  solicitacao: SolicitacaoDeLista;
  hoteis: Hotel[];
  catalogo: Item[];
}) {
  const roteador = useRouter();
  const { avisar } = useAvisos();

  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const [modalidade, setModalidade] = useState(s.transporte_modalidade ?? "");
  const [locadora, setLocadora] = useState<Locadora | "">(s.transporte_locadora ?? "");
  const [locadoraOutra, setLocadoraOutra] = useState(s.transporte_locadora_outra ?? "");
  const [contrato, setContrato] = useState(s.transporte_contrato ?? "");
  const [placa, setPlaca] = useState(s.transporte_placa ?? "");
  const [valorTransporte, setValorTransporte] = useState(formatarNumeroBR(s.real_veiculo));
  const [observacao, setObservacao] = useState(s.logistica_obs ?? "");

  const [hospedagens, setHospedagens] = useState<LinhaDeHospedagem[]>(() =>
    s.hospedagens.map((h) => ({
      id: h.id,
      cidade: h.cidade,
      dias: Number(h.dias) || 0,
      hotelId: h.hotel_id ?? "",
      diaria: formatarNumeroBR(h.diaria_real ?? h.diaria_prevista),
      reserva: h.reserva_codigo ?? "",
    }))
  );

  const itemPorId = new Map(catalogo.map((i) => [i.id, i]));
  const reservados = s.reservas.filter((r) => r.situacao === "Reservado" || r.situacao === "Em campo");

  function trocarHospedagem(indice: number, mudanca: Partial<LinhaDeHospedagem>) {
    setHospedagens((atual) => atual.map((l, i) => (i === indice ? { ...l, ...mudanca } : l)));
  }

  async function salvar(confirmar: boolean) {
    if (locadora === "Outros" && !locadoraOutra.trim()) {
      avisar("Diga qual é a locadora.", "erro");
      return;
    }
    setOcupado(true);
    try {
      await post(`/api/solicitacoes/${s.id}/logistica`, {
        confirmar,
        transporte_modalidade: modalidade || null,
        transporte_locadora: locadora || null,
        transporte_locadora_outra: locadora === "Outros" ? locadoraOutra : null,
        transporte_contrato: contrato || null,
        transporte_placa: placa || null,
        real_veiculo: parseMoeda(valorTransporte),
        logistica_obs: observacao || null,
        hospedagens: hospedagens.map((h) => ({
          id: h.id,
          hotel_id: h.hotelId || null,
          diaria_real: parseMoeda(h.diaria),
          reserva_codigo: h.reserva || null,
        })),
      });
      setAberto(false);
      avisar(confirmar ? "Logística confirmada." : "Logística salva.", "ok");
      roteador.refresh();
    } catch (erro) {
      avisar(mensagemDoErro(erro, confirmar ? "confirmar a logística" : "salvar a logística"), "erro");
    } finally {
      setOcupado(false);
    }
  }

  // O real de hospedagem sai das LINHAS: dias × diária real. Mostrar a soma
  // aqui é o que evita a pessoa descobrir o total só depois de salvar.
  const totalHospedagem = hospedagens.reduce((t, h) => t + h.dias * parseMoeda(h.diaria), 0);

  return (
    <>
      {/* ── UMA SETA, EM VERDE ──
          Ícone e nunca texto: numa coluna de ações ao lado de botões de
          27px, um "Confirmar logística" escrito é quatro vezes mais largo
          que os vizinhos e desalinhava a fileira inteira. O nome não
          desaparece — vai para o `title` e o `aria-label`.

          A SETA e não o ícone de logística (a caixa) porque o desenho tem de
          dizer o VERBO, não o assunto: a coluna já está na aba Logística, e
          repetir o assunto no botão não informa nada. Seta para a frente é o
          gesto de confirmar e empurrar o pedido para o estado seguinte —
          "Aprovada" vira "Logística confirmada".

          Verde porque é a cor de confirmação no resto do sistema
          (`btn-icon-green`), a mesma dos botões de confirmar dos modais. */}
      <button
        className="btn-icon btn-icon-green"
        type="button"
        title="Confirmar logística"
        aria-label="Confirmar logística"
        onClick={() => setAberto(true)}
      >
        <Icone nome="seta" />
      </button>

      <Modal
        titulo={`Logística · ${s.codigo} · ${s.cliente_projeto}`}
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        rodape={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setAberto(false)} disabled={ocupado}>
              Cancelar
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => salvar(false)} disabled={ocupado}>
              Salvar sem confirmar
            </button>
            <button className="btn btn-green" type="button" onClick={() => salvar(true)} disabled={ocupado}>
              {ocupado ? "Salvando…" : "Confirmar logística"}
            </button>
          </>
        }
      >
        <div className="modal-subtitle">Transporte</div>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label" htmlFor="log-modalidade">
              Modalidade
            </label>
            <select
              id="log-modalidade"
              className="form-control"
              value={modalidade}
              onChange={(e) => setModalidade(e.target.value)}
            >
              <option value="">—</option>
              {MODALIDADES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="log-locadora">
              Locadora
            </label>
            <select
              id="log-locadora"
              className="form-control"
              value={locadora}
              onChange={(e) => setLocadora(e.target.value as Locadora | "")}
            >
              <option value="">—</option>
              {LOCADORAS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>

          {locadora === "Outros" ? (
            <div className="form-group">
              <label className="form-label required" htmlFor="log-locadora-outra">
                Qual locadora
              </label>
              <input
                id="log-locadora-outra"
                className="form-control"
                placeholder="Nome da locadora"
                value={locadoraOutra}
                onChange={(e) => setLocadoraOutra(e.target.value)}
              />
            </div>
          ) : null}

          <div className="form-group">
            <label className="form-label" htmlFor="log-contrato">
              Contrato / reserva
            </label>
            <input
              id="log-contrato"
              className="form-control"
              value={contrato}
              onChange={(e) => setContrato(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="log-placa">
              Placa
            </label>
            <input
              id="log-placa"
              className="form-control"
              maxLength={8}
              value={placa}
              onChange={(e) => setPlaca(e.target.value.toUpperCase())}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="log-valor">
              Valor REAL do transporte
            </label>
            <CampoMascarado
              id="log-valor"
              mascara="moeda"
              valor={valorTransporte}
              aoMudar={setValorTransporte}
            />
          </div>
        </div>

        <div className="modal-subtitle">Hospedagem</div>
        {hospedagens.length ? (
          <>
            {hospedagens.map((h, indice) => {
              // Só os hotéis DAQUELE município: a lista inteira num campo
              // de cidade pequena esconderia as três casas que interessam.
              const doMunicipio = hoteis.filter(
                (x) => x.ativo && x.municipio.toUpperCase() === h.cidade.toUpperCase()
              );
              return (
                <div className="log-hosp" key={h.id}>
                  <span className="log-hosp-cidade">
                    {h.cidade} <em>{h.dias} dia(s)</em>
                  </span>
                  <select
                    className="form-control log-hotel"
                    value={h.hotelId}
                    aria-label={`Hotel em ${h.cidade}`}
                    onChange={(e) => {
                      const hotel = hoteis.find((x) => x.id === e.target.value);
                      trocarHospedagem(indice, {
                        hotelId: e.target.value,
                        ...(hotel ? { diaria: formatarNumeroBR(hotel.valor_diaria) } : {}),
                      });
                    }}
                  >
                    <option value="">Hotel a definir</option>
                    {doMunicipio.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nome} · {formatarMoeda(x.valor_diaria)}
                      </option>
                    ))}
                  </select>
                  <CampoMascarado
                    mascara="moeda"
                    valor={h.diaria}
                    aoMudar={(v) => trocarHospedagem(indice, { diaria: v })}
                    placeholder="Diária real"
                    className="form-control log-diaria"
                  />
                  <input
                    className="form-control log-reserva"
                    placeholder="Nº da reserva"
                    value={h.reserva}
                    onChange={(e) => trocarHospedagem(indice, { reserva: e.target.value })}
                  />
                </div>
              );
            })}
            <p className="modal-hint">
              Real de hospedagem: <strong>{formatarMoeda(totalHospedagem)}</strong> — soma de dias × diária real
              de cada cidade. Zerar as diárias zera o real.
            </p>
          </>
        ) : (
          <p className="modal-hint">
            Esta solicitação não pede hospedagem.
            {hoteis.length ? "" : " O cadastro de hotéis está vazio — a aba Cadastros é onde ele nasce."}
          </p>
        )}

        <div className="modal-subtitle">Material reservado nas datas do campo</div>
        {s.equipamentos.length ? (
          <>
            <div className="table-wrapper" style={{ boxShadow: "none" }}>
              <div className="table-scroll">
                <table className="art-table tabela-centralizada">
                  <thead>
                    <tr>
                      <th>Equipamento</th>
                      <th>Qtd.</th>
                      <th>Reserva</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.equipamentos.map((e) => {
                      const reserva = reservados.find((r) => r.solicitacao_equipamento_id === e.id);
                      const item = e.item_id ? itemPorId.get(e.item_id) : undefined;
                      return (
                        <tr key={e.id}>
                          <td>{item ? `${item.produto} · ${item.codigo}` : (e.descricao ?? "—")}</td>
                          <td>{e.quantidade}</td>
                          <td>
                            {reserva ? (
                              <Selo
                                texto={reserva.situacao}
                                classe={reserva.situacao === "Em campo" ? "st-info" : "st-ok"}
                              />
                            ) : (
                              <Selo texto="Sem reserva" classe="st-ruim" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="modal-hint">
              {reservados.length < s.equipamentos.length
                ? "Confirmar a logística tenta reservar o que falta nas datas do campo. Se não couber, o sistema diz o que falta e nada muda."
                : "Todo o material está comprometido nas datas do campo."}
            </p>
          </>
        ) : (
          <p className="modal-hint">Esta solicitação não pede equipamento do estoque.</p>
        )}

        <div className="form-group" style={{ marginTop: ".7rem" }}>
          <label className="form-label" htmlFor="log-obs">
            Observação da logística
          </label>
          <textarea
            id="log-obs"
            className="form-control"
            rows={2}
            placeholder="O que ficou combinado e não cabe nos campos acima"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
          />
        </div>
      </Modal>
    </>
  );
}
