// ═══════════════════════════════════════════════════════════════════════
//  O DETALHE DA SOLICITAÇÃO
//
//  Era um modal aceso por `abrirDetalhe(id)` a partir de cinco telas
//  diferentes, com o corpo montado por template string. Virou uma PÁGINA
//  com endereço próprio, e isso resolve três coisas de uma vez: dá para
//  mandar o link de um pedido para alguém, o botão Voltar do navegador
//  funciona, e as cinco telas passam a apontar para o mesmo lugar em vez
//  de cada uma reabrir o mesmo modal.
// ═══════════════════════════════════════════════════════════════════════

import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirSessao } from "@/lib/sessao";
import { carregarDados, carregarFilhasDaSolicitacao } from "@/lib/dados";
import { Bloco, Grade, Info, Marca, TabelaDeLeitura } from "@/app/components/Detalhe";
import { Selo } from "@/app/components/Tabela";
import { AcoesDaSolicitacao } from "@/app/(sistema)/solicitacoes/[id]/AcoesDaSolicitacao";
import { classeDaAvaria, classeDoCurso, classeDoStatus } from "@/lib/listas";
import { dataISOparaBR, formatarData, formatarDataHora, formatarMoeda, semAcento } from "@/lib/formato";
import { desvioTexto, liderDaSolicitacao, periodoTexto, totalDaSolicitacao } from "@/lib/consultas";
import { ehDirecao, podeAprovar, podeEditar, podeLiberarFolga, podeVerValores } from "@/lib/papeis";
import { LiberarFolga } from "@/app/(sistema)/solicitacoes/[id]/LiberarFolga";
import { formularioDeSolicitacao } from "@/app/(sistema)/solicitacoes/formulario/estado";
import type {
  Item,
  MomentoAssinatura,
  PapelAssinatura,
  SolicitacaoCabecalho,
  SolicitacaoHospedagem,
} from "@/lib/tipos";

export const dynamic = "force-dynamic";

/** A ordem em que as quatro assinaturas acontecem no papel. */
const MOMENTOS_E_PAPEIS: readonly (readonly [MomentoAssinatura, PapelAssinatura])[] = [
  ["Retirada", "Administrativo"],
  ["Retirada", "Prestador"],
  ["Devolução", "Administrativo"],
  ["Devolução", "Prestador"],
];

export default async function PaginaDeDetalhe({ params }: { params: { id: string } }) {
  const usuario = await exigirSessao();
  const dados = await carregarDados(usuario.accessToken);

  const s = dados.solicitacoes.find((x) => x.id === params.id);
  if (!s) notFound();

  const itemPorId = new Map(dados.catalogo.map((i) => [i.id, i]));
  const hotelPorId = new Map(dados.hoteis.map((h) => [h.id, h]));
  const nomePorId = new Map(dados.perfis.map((p) => [p.id, p.nome]));

  const projeto = dados.projetos.find((p) => p.id === s.projeto_id);
  const reservasVivas = s.reservas.filter((r) => r.situacao !== "Cancelada");

  // ── O QUE ESTÁ AGUARDANDO A LIBERAÇÃO DA FOLGA ──
  //
  // Derivado, e não uma coluna de estado: linha com item de catálogo, ainda
  // não entregue e SEM reserva viva. Conflito real de datas nem chega a
  // salvar e o que cabe é reservado na hora, então a única maneira de uma
  // linha ficar sem reserva é a folga entre campos (supabase/12). Espelha
  // `equipamentos_aguardando_folga()` no banco — aqui só evita uma consulta
  // a mais, já que as reservas vieram junto com a solicitação.
  const itensComReserva = new Set(
    reservasVivas.map((r) => r.solicitacao_equipamento_id).filter((id): id is string => !!id)
  );
  const aguardandoFolga = s.equipamentos.filter(
    (e) => e.item_id && !e.entregue && !itensComReserva.has(e.id)
  );
  const idsAguardando = new Set(aguardandoFolga.map((e) => e.id));
  const liberarFolga = podeLiberarFolga(usuario.papel);

  // Assinatura e histórico vêm POR SOLICITAÇÃO, e não do carregamento
  // global: as assinaturas são PNG de até 400 mil caracteres e o histórico
  // cresce para sempre. Enquanto estavam na leitura global, abrir o
  // calendário carregava as duas coisas da empresa inteira. Ver
  // `carregarFilhasDaSolicitacao`.
  const { assinaturas, alteracoes } = await carregarFilhasDaSolicitacao(usuario.accessToken, s.id);

  // Previsto × real é dinheiro consolidado: vê quem responde por ele — o
  // líder deste projeto, administrativo, financeiro e Direção. Quem abre o
  // pedido continua vendo tudo o que PEDIU (despesas, diárias, hospedagem):
  // o que sai da tela é a comparação orçamentária, não o pedido dele.
  const verValores = podeVerValores(usuario, dados.projetos);

  return (
    <section className="secao active">
      <div className="sec-header">
        <h2>
          {s.codigo} · {s.cliente_projeto}
        </h2>
        <div className="sec-header-right">
          <Link className="btn btn-ghost btn-sm" href="/solicitacoes">
            ← Voltar
          </Link>
        </div>
      </div>

      {/* `pagina-rolavel` devolve a rolagem que o `.modal-body` dava quando
          isto era um modal — sem ela, `.secao{overflow:hidden}` corta tudo
          abaixo da primeira tela. Ver o bloco no fim de app/globals.css. */}
      <div className="lista-wrapper pagina-rolavel" style={{ padding: "1.2rem" }}>
        <Grade>
          <Info rotulo="Tipo">{s.tipo}</Info>
          <Info rotulo="Solicitante">{s.solicitante_nome || "—"}</Info>
          <Info rotulo="Setor">{s.setor || "—"}</Info>
          <Info rotulo="Data da solicitação">{formatarData(s.criado_em)}</Info>
          <Info rotulo="Recurso até">{dataISOparaBR(s.data_recurso) || "—"}</Info>
          <Info rotulo="Código Clockify">{s.codigo_clockify || "—"}</Info>
          <Info rotulo="Destino">{s.destino || "—"}</Info>
          <Info rotulo="Período">{periodoTexto(s)}</Info>
          <Info rotulo="Status">
            <Selo texto={s.status} classe={classeDoStatus(s.status)} />
          </Info>
          {/* O resumo do dinheiro no alto da tela segue a mesma regra do
              bloco de Previsto × Real lá embaixo: quem não responde por
              valor não o vê aqui também — senão esconder o bloco não
              esconderia nada. */}
          {verValores ? (
            <>
              <Info rotulo="Status de curso">
                <Selo texto={s.status_curso} classe={classeDoCurso(s.status_curso)} />
              </Info>
              <Info rotulo="Previsto × Real">
                {formatarMoeda(s.previsto_total)} × {formatarMoeda(s.real_total)}
              </Info>
              {s.tipo === "Financeiro" ? (
                <Info rotulo="Solicitado no financeiro">{formatarMoeda(totalDaSolicitacao(s))}</Info>
              ) : null}
            </>
          ) : null}
          <Info rotulo="Projeto cadastrado">
            {projeto
              ? `${projeto.cliente} | ${projeto.nome}${projeto.escopo ? ` · ${projeto.escopo}` : ""}`
              : "— sem projeto cadastrado —"}
          </Info>
          <Info rotulo="Quem aprova">{liderDaSolicitacao(s, dados.projetos)}</Info>
          {s.aprovado_em ? (
            <Info rotulo="Aprovada em">
              {formatarDataHora(s.aprovado_em)}
              {s.aprovado_por && nomePorId.get(s.aprovado_por) ? ` · ${nomePorId.get(s.aprovado_por)}` : ""}
            </Info>
          ) : null}
          {s.logistica_em ? (
            <Info rotulo="Logística confirmada em">{formatarDataHora(s.logistica_em)}</Info>
          ) : null}
          {s.motivo_recusa ? (
            <Info rotulo="Motivo da recusa (líder)" largo>
              {s.motivo_recusa}
            </Info>
          ) : null}
          {s.dados_transferencia ? (
            <Info rotulo="Dados da transferência" largo>
              {s.dados_transferencia}
            </Info>
          ) : null}
          {s.observacao ? (
            <Info rotulo="Observação" largo>
              {s.observacao}
            </Info>
          ) : null}
          {s.logistica_obs ? (
            <Info rotulo="Observação da logística" largo>
              {s.logistica_obs}
            </Info>
          ) : null}
          {s.motivo_cancelamento ? (
            <Info rotulo="Motivo do cancelamento" largo>
              {s.motivo_cancelamento}
            </Info>
          ) : null}
        </Grade>

        {s.equipe.length ? (
          <Bloco titulo="Equipe de campo">
            <TabelaDeLeitura colunas={["Colaborador", "Função", "Vínculo", "Clockify", "Telefone", "Líder"]}>
              {s.equipe.map((e) => (
                <tr key={e.id}>
                  <td>{e.colaborador}</td>
                  <td>{e.funcao || "—"}</td>
                  <td>{e.vinculo}</td>
                  <td>{e.codigo_clockify || "—"}</td>
                  <td>{e.telefone || "—"}</td>
                  <td>{e.lider ? <span className="status-badge st-ok">Líder</span> : <Marca valor={false} />}</td>
                </tr>
              ))}
            </TabelaDeLeitura>
          </Bloco>
        ) : null}

        {s.veiculo_necessario ? (
          <Bloco titulo="1 · Veículo e transporte">
            <Grade>
              <Info rotulo="Condutor">{s.veiculo_condutor || "—"}</Info>
              <Info rotulo="CPF">{s.veiculo_cpf || "—"}</Info>
              <Info rotulo="Veículo">{s.veiculo_descricao || "—"}</Info>
              <Info rotulo="Modalidade">{s.transporte_modalidade || "—"}</Info>
              <Info rotulo="Locadora">
                {(s.transporte_locadora === "Outros"
                  ? s.transporte_locadora_outra || "Outros"
                  : s.transporte_locadora) || "—"}
              </Info>
              <Info rotulo="Contrato / reserva">{s.transporte_contrato || "—"}</Info>
              <Info rotulo="Placa">{s.transporte_placa || "—"}</Info>
              <Info rotulo="Valor previsto">{formatarMoeda(s.previsto_veiculo)}</Info>
              <Info rotulo="Valor REAL">{formatarMoeda(s.real_veiculo)}</Info>
              <Info rotulo="Recebimento" largo>
                {s.veiculo_local_retirada || "—"} · {dataISOparaBR(s.veiculo_data_retirada) || "—"}{" "}
                {s.veiculo_hora_retirada ?? ""}
              </Info>
              <Info rotulo="Entrega" largo>
                {s.veiculo_local_entrega || "—"} · {dataISOparaBR(s.veiculo_data_entrega) || "—"}{" "}
                {s.veiculo_hora_entrega ?? ""}
              </Info>
            </Grade>
          </Bloco>
        ) : null}

        {s.hospedagens.length ? (
          <Bloco titulo="2 · Hospedagem">
            <TabelaDeLeitura
              colunas={["Cidade", "Hotel / pousada", "Entrada", "Saída", "Dia(s)", "Diária prevista", "Diária real", "Total"]}
            >
              {s.hospedagens.map((h) => (
                <tr key={h.id}>
                  <td>{h.cidade || "—"}</td>
                  <td>{nomeDoHotel(h, hotelPorId)}</td>
                  <td>{dataISOparaBR(h.entrada) || "—"}</td>
                  <td>{dataISOparaBR(h.saida) || "—"}</td>
                  <td>{h.dias ?? "—"}</td>
                  <td>{formatarMoeda(h.diaria_prevista)}</td>
                  <td>{h.diaria_real == null ? "—" : formatarMoeda(h.diaria_real)}</td>
                  <td>{formatarMoeda((Number(h.dias) || 0) * (Number(h.diaria_real ?? h.diaria_prevista) || 0))}</td>
                </tr>
              ))}
            </TabelaDeLeitura>
          </Bloco>
        ) : null}

        {s.equipamentos.length ? (
          <Bloco titulo="3 · Equipamento para campo">
            {aguardandoFolga.length ? (
              <p className="modal-hint" style={{ marginTop: 0 }}>
                {aguardandoFolga.length} item(ns) <strong>aguardando liberação</strong>: estão livres
                nas datas deste campo, e o que segura é a folga de um dia que a reserva guarda antes
                e depois de outro campo.{" "}
                {liberarFolga
                  ? "Libere abaixo se der tempo de conferir na volta e separar de novo."
                  : "Só o administrativo (ou a Direção) pode liberar."}
              </p>
            ) : null}
            {/* O quadro de CONFERÊNCIA do papel, coluna por coluna:
                ENT. · TESTE · DEV. · TESTE · AVARIA? — mais a coluna de
                RESERVA, que diz se o item está garantido ou ainda esperando
                a liberação da folga. */}
            <TabelaDeLeitura
              colunas={["Equipamento", "Qtd.", "Reserva", "Ent.", "Teste", "Dev.", "Teste", "Avaria"]}
            >
              {s.equipamentos.map((e) => {
                const nome = nomeDoEquipamento(e.item_id, e.descricao, itemPorId);
                const pendente = idsAguardando.has(e.id);
                return (
                  <tr key={e.id}>
                    <td>{nome}</td>
                    <td>{e.quantidade}</td>
                    <td>
                      {/* Item fora do catálogo não reserva nada: não há saldo
                          a disputar, então a coluna não se aplica. */}
                      {!e.item_id ? (
                        "—"
                      ) : pendente ? (
                        <span className="table-actions" style={{ justifyContent: "center", gap: ".35rem" }}>
                          <span className="status-badge st-perto">Aguardando folga</span>
                          {liberarFolga ? (
                            <LiberarFolga
                              solicitacaoId={s.id}
                              equipamentoId={e.id}
                              equipamento={nome}
                              liberado={false}
                            />
                          ) : null}
                        </span>
                      ) : (
                        <span className="table-actions" style={{ justifyContent: "center", gap: ".35rem" }}>
                          <span className="status-badge st-ok">Reservado</span>
                          {/* A liberação fica visível DEPOIS de concedida: é
                              o que permite desfazê-la, e o que mostra que
                              aquele item saiu por decisão de alguém. */}
                          {e.folga_dispensada && liberarFolga && !e.entregue ? (
                            <LiberarFolga
                              solicitacaoId={s.id}
                              equipamentoId={e.id}
                              equipamento={nome}
                              liberado
                            />
                          ) : e.folga_dispensada ? (
                            <span className="status-badge st-neutro" title="A folga entre campos foi liberada para este item">
                              folga liberada
                            </span>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td>
                      <Marca valor={e.entregue} />
                    </td>
                    <td>
                      <Marca valor={e.teste_entrega} />
                    </td>
                    <td>
                      <Marca valor={e.devolvido} />
                    </td>
                    <td>
                      <Marca valor={e.teste_devolucao} />
                    </td>
                    <td>{e.avaria ? <span className="status-badge st-ruim">Sim</span> : <Marca valor={false} />}</td>
                  </tr>
                );
              })}
            </TabelaDeLeitura>
          </Bloco>
        ) : null}

        {reservasVivas.length ? (
          <Bloco titulo="Material reservado no estoque">
            {/* A resposta para "o medidor está reservado ou já saiu?". */}
            <TabelaDeLeitura colunas={["Item", "Qtd.", "Reservado de", "até", "Situação"]}>
              {reservasVivas.map((r) => (
                <tr key={r.id}>
                  <td>{nomeDoEquipamento(r.item_id, null, itemPorId)}</td>
                  <td>{r.quantidade}</td>
                  <td>{dataISOparaBR(r.inicio)}</td>
                  <td>{dataISOparaBR(r.fim)}</td>
                  <td>
                    <Selo
                      texto={r.situacao}
                      classe={
                        r.situacao === "Em campo" ? "st-info" : r.situacao === "Devolvido" ? "st-ok" : "st-perto"
                      }
                    />
                  </td>
                </tr>
              ))}
            </TabelaDeLeitura>
          </Bloco>
        ) : null}

        {/* SST é UMA MARCA desde a v3: se aplica ou não se aplica. As seis
            conferências saíram da tela — quando o pedido é ANTIGO e tem
            alguma delas marcada, o histórico continua sendo mostrado, para
            o detalhe não apagar o que já foi conferido. */}
        <Bloco titulo="SST · segurança do trabalho">
          <Grade>
            <Info rotulo="SST" largo>
              <Selo
                texto={s.sst_aplicavel ? "Se aplica" : "Não se aplica"}
                classe={s.sst_aplicavel ? "st-ok" : "st-neutro"}
              />
            </Info>
            {s.sst_observacao ? (
              <Info rotulo="Observação de SST" largo>
                {s.sst_observacao}
              </Info>
            ) : null}
          </Grade>
          {s.sst_aplicavel ? (
            <>
              {temConferenciaAntiga(s) ? (
                <Grade>
                  <Info rotulo="APR emitida">
                    <Marca valor={s.sst_apr_emitida} />
                  </Info>
                  <Info rotulo="PT emitida">
                    <Marca valor={s.sst_pt_emitida} />
                  </Info>
                  <Info rotulo="DDS realizado">
                    <Marca valor={s.sst_dds_realizado} />
                  </Info>
                  <Info rotulo="Treinamentos">
                    <Marca valor={s.sst_treinamento_conferido} />
                  </Info>
                  <Info rotulo="ASO">
                    <Marca valor={s.sst_aso_conferido} />
                  </Info>
                  <Info rotulo="EPIs">
                    <Marca valor={s.sst_epi_conferido} />
                  </Info>
                  <Info rotulo="Responsável">{s.sst_responsavel || "—"}</Info>
                  <Info rotulo="Conferência" largo>
                    Registro da conferência detalhada, de antes de o SST virar uma marca só.
                  </Info>
                </Grade>
              ) : null}
              {s.epis.length ? (
                <TabelaDeLeitura colunas={["EPI", "Qtd.", "CA", "Conferido"]}>
                  {s.epis.map((e) => (
                    <tr key={e.id}>
                      <td>{e.epi}</td>
                      <td>{e.quantidade}</td>
                      <td>{e.ca || "—"}</td>
                      <td>
                        <Marca valor={e.conferido} />
                      </td>
                    </tr>
                  ))}
                </TabelaDeLeitura>
              ) : null}
            </>
          ) : null}
        </Bloco>

        {/* PREVISTO × REAL — só para quem pode ver valor: o líder DESTE
            projeto, administrativo, financeiro e Direção. Esconder o bloco
            evita a pergunta; quem impede a resposta é a RLS. */}
        {verValores ? (
        <Bloco titulo="Previsto × Real">
          <>
            <TabelaDeLeitura colunas={["Linha", "Previsto", "Real", "Desvio"]}>
              <LinhaPrevistoReal rotulo="Veículo / transporte" previsto={s.previsto_veiculo} real={s.real_veiculo} />
              <LinhaPrevistoReal rotulo="Hospedagem" previsto={s.previsto_hospedagem} real={s.real_hospedagem} />
              <LinhaPrevistoReal rotulo="Alimentação" previsto={s.previsto_alimentacao} real={s.real_alimentacao} />
              <LinhaPrevistoReal rotulo="Outros" previsto={s.previsto_outros} real={s.real_outros} />
              {/* AVARIA — sem previsto, por definição: ninguém orça quebrar
                  o equipamento. O valor é somado pelo banco a partir das
                  avarias registradas, e é por isso que ele aparece aqui e
                  não numa aba separada: é gasto do campo. */}
              {Number(s.real_avaria) > 0 ? (
                <LinhaPrevistoReal rotulo="Avaria" previsto={0} real={s.real_avaria} />
              ) : null}
              <tr className="pxr-total-linha">
                <td>
                  <strong>Total</strong>
                </td>
                <td>
                  <strong>{formatarMoeda(s.previsto_total)}</strong>
                </td>
                <td>
                  <strong>{formatarMoeda(s.real_total)}</strong>
                </td>
                <td>
                  <strong>{desvioTexto(s)}</strong>
                </td>
              </tr>
            </TabelaDeLeitura>
            <div className="form-preview-row">
              <div className="form-preview-item">
                <span>Status de curso</span>
                <strong>
                  <Selo texto={s.status_curso} classe={classeDoCurso(s.status_curso)} />
                </strong>
              </div>
              <div className="form-preview-item">
                <span>Faixa de tolerância</span>
                <strong>± 5% do previsto</strong>
              </div>
            </div>
          </>
        </Bloco>
        ) : null}

        {s.despesas.length ? (
          <Bloco titulo="Despesas com prestação de contas">
            <TabelaDeLeitura colunas={["Grupo", "Descrição", "Valor"]}>
              {s.despesas.map((d) => (
                <tr key={d.id}>
                  <td>{d.grupo}</td>
                  <td>{d.descricao || "—"}</td>
                  <td>{formatarMoeda(d.valor)}</td>
                </tr>
              ))}
            </TabelaDeLeitura>
          </Bloco>
        ) : null}

        {s.diarias.length ? (
          <Bloco titulo="Alimentação (mediante recibo)">
            <TabelaDeLeitura
              colunas={["Colaborador", "Vínculo", "Diária", "Dias", "Valor", "Total", "Dados bancários"]}
            >
              {s.diarias.map((d) => (
                <tr key={d.id}>
                  <td>{d.colaborador}</td>
                  <td>{d.vinculo}</td>
                  <td>{d.tipo_diaria}</td>
                  <td>{d.dias}</td>
                  <td>{formatarMoeda(d.valor_unitario)}</td>
                  <td>{formatarMoeda(d.valor_total)}</td>
                  <td>{d.dados_bancarios || "—"}</td>
                </tr>
              ))}
            </TabelaDeLeitura>
          </Bloco>
        ) : null}

        {s.entrega_data || s.devolucao_data ? (
          <Bloco titulo="Conferência">
            <>
              <Grade>
                <Info rotulo="Data da entrega">{dataISOparaBR(s.entrega_data) || "—"}</Info>
                <Info rotulo="Assinaturas">
                  {s.entrega_adm || "—"} / {s.entrega_prestador || "—"}
                </Info>
                <Info rotulo="Data da devolução">{dataISOparaBR(s.devolucao_data) || "—"}</Info>
                <Info rotulo="Assinaturas">
                  {s.devolucao_adm || "—"} / {s.devolucao_prestador || "—"}
                </Info>
              </Grade>
              {assinaturas.length ? (
                // As quatro assinaturas do papel, na ordem em que
                // acontecem. Bloco vazio aparece de propósito: "sem
                // assinatura registrada" é informação, não ausência de
                // informação.
                <div className="assin-vistas">
                  {MOMENTOS_E_PAPEIS.map(([momento, papel]) => {
                    const a = assinaturas.find((x) => x.momento === momento && x.papel === papel);
                    if (!a) {
                      return (
                        <div className="assin-vista assin-vazia" key={`${momento}-${papel}`}>
                          <span>
                            {momento} · {papel}
                          </span>
                          <em>Sem assinatura registrada</em>
                        </div>
                      );
                    }
                    return (
                      <div className="assin-vista" key={a.id}>
                        <span>
                          {momento} · {papel}
                        </span>
                        {/* eslint-disable-next-line @next/next/no-img-element -- data URL
                            guardada no banco; não há arquivo para o otimizador tratar. */}
                        <img src={a.imagem} alt={`Assinatura de ${a.nome}`} />
                        <em>
                          {a.nome} · {formatarDataHora(a.assinado_em)}
                        </em>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </>
          </Bloco>
        ) : null}

        {s.avarias.length ? (
          <Bloco titulo="Avarias">
            <TabelaDeLeitura
              colunas={["Equipamento", "Gravidade", "Descrição", "Providência", "Estimado", "Real", "Situação"]}
            >
              {s.avarias.map((a) => (
                <tr key={a.id}>
                  <td>{a.item_id ? (itemPorId.get(a.item_id)?.produto ?? "—") : "—"}</td>
                  <td>{a.gravidade}</td>
                  <td>{a.descricao}</td>
                  <td>{a.providencia}</td>
                  <td>{formatarMoeda(a.custo_estimado)}</td>
                  <td>{a.custo_real == null ? "—" : formatarMoeda(a.custo_real)}</td>
                  <td>
                    <Selo texto={a.situacao} classe={classeDaAvaria(a.situacao)} />
                  </td>
                </tr>
              ))}
            </TabelaDeLeitura>
          </Bloco>
        ) : null}

        {alteracoes.length ? (
          <Bloco titulo="Histórico de alterações">
            {/* Escrito por TRIGGER, não pelo aplicativo: não depende de o
                cliente se comportar. */}
            <div className="hist-lista">
              {alteracoes.slice(0, 40).map((a) => (
                <div className="hist-linha" key={a.id}>
                  <span className={`hist-tipo hist-${semAcento(a.tipo)}`}>{a.tipo}</span>
                  <strong>{a.campo}</strong>
                  <span>
                    {a.de || "—"} → {a.para || "—"}
                  </span>
                  <em>
                    {formatarDataHora(a.data)} · {a.usuario_nome || "—"}
                  </em>
                </div>
              ))}
            </div>
          </Bloco>
        ) : null}

        <AcoesDaSolicitacao
          id={s.id}
          codigo={s.codigo}
          status={s.status}
          temEquipamento={s.equipamentos.length > 0}
          // Editar e acrescentar valem enquanto o pedido está andando.
          // Pedido finalizado, cancelado ou recusado é registro.
          podeEditar={podeEditar(s.status) && s.status !== "Recusada"}
          podeDecidir={podeAprovar(usuario.id, usuario.papel, s, dados.projetos)}
          catalogo={dados.catalogo}
          periodo={{ inicio: s.periodo_inicio, fim: s.periodo_fim }}
          // O formulário de edição abre em POPUP sobre este detalhe, e ele
          // não consulta banco: recebe os cadastros prontos. Só é montado
          // quando o pedido é editável — pedido encerrado não tem lápis.
          formulario={
            podeEditar(s.status) && s.status !== "Recusada"
              ? {
                  inicial: formularioDeSolicitacao(s),
                  projetos: dados.projetos,
                  hoteis: dados.hoteis,
                  diariasCadastradas: dados.diarias,
                  usuarioId: usuario.id,
                  solicitanteNome: s.solicitante_nome,
                  ehDirecao: ehDirecao(usuario.papel),
                  // Equipamento já entregue está com a equipe: a linha é a
                  // obrigação de devolver, e a edição não a toca.
                  equipamentosEntregues: s.equipamentos.filter((e) => e.entregue).length,
                }
              : null
          }
        />
      </div>
    </section>
  );
}

/**
 * Este pedido tem conferência de SST DETALHADA gravada?
 *
 * Serve a uma coisa só: pedido de antes da v3, quando SST eram seis
 * conferências mais o responsável. O bloco novo mostra apenas a marca — mas
 * apagar da tela o que já foi conferido seria perder registro, então quando
 * há histórico ele aparece, rotulado como histórico.
 */
function temConferenciaAntiga(s: SolicitacaoCabecalho): boolean {
  return (
    s.sst_apr_emitida ||
    s.sst_pt_emitida ||
    s.sst_dds_realizado ||
    s.sst_treinamento_conferido ||
    s.sst_aso_conferido ||
    s.sst_epi_conferido ||
    !!s.sst_responsavel
  );
}

function LinhaPrevistoReal({ rotulo, previsto, real }: { rotulo: string; previsto: number; real: number }) {
  const p = Number(previsto) || 0;
  const r = Number(real) || 0;
  const desvio = r - p;
  return (
    <tr>
      <td>{rotulo}</td>
      <td>{formatarMoeda(p)}</td>
      <td>{formatarMoeda(r)}</td>
      <td className={desvio > 0 ? "pxr-acima" : desvio < 0 ? "pxr-abaixo" : undefined}>
        {p || r ? `${desvio > 0 ? "+" : desvio < 0 ? "−" : ""}${formatarMoeda(Math.abs(desvio))}` : "—"}
      </td>
    </tr>
  );
}

function nomeDoEquipamento(
  itemId: string | null,
  descricao: string | null,
  catalogo: Map<string, Item>
): string {
  if (itemId) {
    const item = catalogo.get(itemId);
    if (item) return `${item.produto} · ${item.codigo}`;
    return "Item fora do catálogo";
  }
  return descricao || "—";
}

function nomeDoHotel(
  h: SolicitacaoHospedagem,
  hoteis: Map<string, { nome: string; tipo: string }>
): string {
  if (!h.hotel_id) return "A definir";
  const hotel = hoteis.get(h.hotel_id);
  return hotel ? `${hotel.nome} (${hotel.tipo})` : "A definir";
}
