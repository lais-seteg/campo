// ═══════════════════════════════════════════════════════════════════════
//  CHECKLIST DE CAMPO — a folha que vai junto com o equipamento
//
//  A MESMA folha é validada duas vezes: na RETIRADA (conferir e testar o
//  que está saindo) e na DEVOLUÇÃO (conferir se tudo voltou e em que
//  estado).
//
//  A folha continua servindo para assinar À MÃO — campo sem sinal existe.
//  A linha da caneta só é substituída pela imagem da assinatura digital
//  quando ela existe; o que não foi conferido sai como quadradinho vazio,
//  para marcar na hora.
//
//  Imprimir usa o print do navegador: o @media print do style.css esconde
//  o resto da tela e deixa só a folha.
// ═══════════════════════════════════════════════════════════════════════

import { notFound } from "next/navigation";
import { exigirSessao } from "@/lib/sessao";
import { carregarDados, carregarFilhasDaSolicitacao } from "@/lib/dados";
import { BotoesDoChecklist } from "@/app/(sistema)/solicitacoes/[id]/checklist/BotoesDoChecklist";
import { dataISOparaBR, formatarData } from "@/lib/formato";
import { periodoTexto } from "@/lib/consultas";
import type { MomentoAssinatura, PapelAssinatura, SolicitacaoAssinatura } from "@/lib/tipos";

export const dynamic = "force-dynamic";

export default async function PaginaDeChecklist({ params }: { params: { id: string } }) {
  const usuario = await exigirSessao();
  const dados = await carregarDados(usuario.accessToken);

  const s = dados.solicitacoes.find((x) => x.id === params.id);
  if (!s) notFound();

  // As assinaturas vêm por solicitação, e não do carregamento global: são
  // PNG de até 400 mil caracteres, e trazê-las na lista fazia toda tela do
  // sistema carregar toda assinatura da empresa. Ver
  // `carregarFilhasDaSolicitacao`.
  const { assinaturas } = await carregarFilhasDaSolicitacao(usuario.accessToken, s.id);

  const itemPorId = new Map(dados.catalogo.map((i) => [i.id, i]));

  if (!s.equipamentos.length) {
    return (
      <section className="secao active">
        <div className="empty-state" style={{ padding: "3rem 1rem" }}>
          <strong>Esta solicitação não tem equipamento para conferir.</strong>
          <p>O checklist existe para acompanhar material que sai e volta.</p>
        </div>
      </section>
    );
  }

  const hospedagens = s.hospedagens
    .map(
      (h) =>
        `${h.cidade} (${dataISOparaBR(h.entrada) || "?"} a ${dataISOparaBR(h.saida) || "?"}, ${h.dias ?? 0}d)`
    )
    .join(" · ");

  const locadora =
    s.transporte_locadora === "Outros" ? s.transporte_locadora_outra || "Outros" : s.transporte_locadora;
  const veiculo = s.veiculo_necessario
    ? `${s.veiculo_descricao || "—"}${locadora ? ` · ${locadora}` : ""}${s.transporte_placa ? ` · placa ${s.transporte_placa}` : ""}` +
      ` · condutor ${s.veiculo_condutor || "—"} · retirada ${dataISOparaBR(s.veiculo_data_retirada) || "—"} ${s.veiculo_hora_retirada ?? ""} em ${s.veiculo_local_retirada || "—"}`
    : "";

  // A equipe entra na folha: é ela que confere o material na retirada e
  // responde por ele em campo.
  const equipe = s.equipe
    .map((e) => `${e.colaborador}${e.lider ? " (líder)" : ""}${e.funcao ? ` — ${e.funcao}` : ""}`)
    .join(" · ");

  return (
    <section className="secao active">
      <div className="sec-header">
        <h2>Checklist · {s.codigo}</h2>
        <div className="sec-header-right">
          <BotoesDoChecklist voltarPara={`/solicitacoes/${s.id}`} />
        </div>
      </div>

      {/* O invólucro é só a rolagem: a folha é mais alta que a tela, e
          `.secao` é `overflow:hidden`. Na impressão ele não atrapalha —
          o @media print tira `#checklistFolha` do fluxo com `position:
          absolute`. */}
      <div className="pagina-rolavel">
        {/* O id é o que o @media print do style.css mira para esconder
            todo o resto da tela e imprimir só esta folha. Trocar por
            classe quebraria a impressão. */}
        <div id="checklistFolha" className="checklist-folha">
        <div className="chk-cabecalho">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="chk-logo" src="/images/logo-seteg.svg" alt="Seteg" />
          <div>
            <h1>Checklist de equipamento de campo</h1>
            <p>
              {s.codigo} · {s.cliente_projeto}
            </p>
          </div>
        </div>

        <table className="chk-dados">
          <tbody>
            <tr>
              <th>Solicitante</th>
              <td>{s.solicitante_nome || "—"}</td>
              <th>Setor</th>
              <td>{s.setor || "—"}</td>
            </tr>
            <tr>
              <th>Destino</th>
              <td>{s.destino || "—"}</td>
              <th>Período</th>
              <td>{periodoTexto(s)}</td>
            </tr>
            <tr>
              <th>Código Clockify</th>
              <td>{s.codigo_clockify || "—"}</td>
              <th>Recurso até</th>
              <td>{dataISOparaBR(s.data_recurso) || "—"}</td>
            </tr>
            {equipe ? (
              <tr>
                <th>Equipe</th>
                <td colSpan={3}>{equipe}</td>
              </tr>
            ) : null}
            {veiculo ? (
              <tr>
                <th>Veículo</th>
                <td colSpan={3}>{veiculo}</td>
              </tr>
            ) : null}
            {hospedagens ? (
              <tr>
                <th>Hospedagem</th>
                <td colSpan={3}>{hospedagens}</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {/* O bloco impresso é a RAZÃO de o SST estar no pedido de campo:
            sai junto do equipamento, é conferido antes de sair e volta
            assinado. */}
        {!s.sst_aplicavel ? (
          <div className="chk-sst">
            <strong>SST</strong>
            <p>Não se aplica a este campo.</p>
          </div>
        ) : (
          <div className="chk-sst">
            {/* SST é UMA MARCA desde a v3: o sistema registra que se aplica,
                e o que vai impresso é a LISTA DE EPIs — o que precisa ser
                conferido fisicamente na hora de sair, item por item. As seis
                conferências (APR, PT, DDS, treinamento, ASO, EPI) saíram da
                tela; a linha de assinatura no fim é o que fica valendo como
                registro de quem conferiu. */}
            <strong>SST · se aplica a este campo</strong>
            {s.epis.length ? (
              <div className="chk-sst-linha">
                {s.epis.map((e) => (
                  <ItemSst
                    key={e.id}
                    marcado={e.conferido}
                    rotulo={`${e.epi} (${e.quantidade}${e.ca ? ` · CA ${e.ca}` : ""})`}
                  />
                ))}
              </div>
            ) : (
              <p>Nenhum EPI relacionado no pedido.</p>
            )}
            <p>
              Responsável pela conferência: {s.sst_responsavel || "____________________"}
              {s.sst_observacao ? ` · ${s.sst_observacao}` : ""}
            </p>
          </div>
        )}

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
              const item = e.item_id ? itemPorId.get(e.item_id) : undefined;
              return (
                <tr key={e.id}>
                  <td className="chk-num">{String(i + 1).padStart(2, "0")}</td>
                  <td className="chk-item">
                    {item ? `${item.produto} · ${item.codigo}` : (e.descricao ?? "Item fora do catálogo")}
                  </td>
                  <td>{e.quantidade}</td>
                  <td>
                    <Caixa marcado={e.entregue} />
                  </td>
                  <td>
                    <Caixa marcado={e.teste_entrega} />
                  </td>
                  <td>
                    <Caixa marcado={e.devolvido} />
                  </td>
                  <td>
                    <Caixa marcado={e.teste_devolucao} />
                  </td>
                  <td>
                    <Caixa marcado={e.avaria} />
                  </td>
                  <td className="chk-obs">{e.avaria_obs ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="chk-instrucao">
          Na retirada, marque cada item conferido e testado. Na devolução, confira de novo item por item: o que
          não voltar fica em branco e a solicitação continua aberta; avaria deve ser descrita na observação.
        </p>

        <div className="chk-assinaturas">
          <div>
            <strong>Retirada</strong>
            <p>Data: {dataISOparaBR(s.entrega_data) || "____/____/______"}</p>
            <AssinaturaImpressa assinaturas={assinaturas} momento="Retirada" papel="Administrativo" digitado={s.entrega_adm} />
            <AssinaturaImpressa assinaturas={assinaturas} momento="Retirada" papel="Prestador" digitado={s.entrega_prestador} />
          </div>
          <div>
            <strong>Devolução</strong>
            <p>Data: {dataISOparaBR(s.devolucao_data) || "____/____/______"}</p>
            <AssinaturaImpressa assinaturas={assinaturas} momento="Devolução" papel="Administrativo" digitado={s.devolucao_adm} />
            <AssinaturaImpressa assinaturas={assinaturas} momento="Devolução" papel="Prestador" digitado={s.devolucao_prestador} />
          </div>
        </div>
        </div>
      </div>
    </section>
  );
}

/** Marcado sai com X; não marcado sai como quadradinho vazio, para marcar
 *  à caneta na hora da conferência. */
function Caixa({ marcado }: { marcado: boolean }) {
  return marcado ? <span className="chk-box chk-box-on">X</span> : <span className="chk-box" />;
}

function ItemSst({ rotulo, marcado }: { rotulo: string; marcado: boolean }) {
  return (
    <span className="chk-sst-item">
      <Caixa marcado={marcado} /> {rotulo}
    </span>
  );
}

/**
 * A assinatura digital, quando existe, ocupa a linha que antes era para
 * caneta. Quando não existe, a linha continua vazia — a folha tem de
 * servir para assinar à mão também.
 */
function AssinaturaImpressa({
  assinaturas,
  momento,
  papel,
  digitado,
}: {
  assinaturas: readonly SolicitacaoAssinatura[];
  momento: MomentoAssinatura;
  papel: PapelAssinatura;
  digitado: string | null;
}) {
  const rotulo = papel === "Administrativo" ? "Assinatura do administrativo" : "Assinatura do prestador";
  const a = assinaturas.find((x) => x.momento === momento && x.papel === papel);

  if (!a) {
    return (
      <>
        <p className="chk-linha">{digitado ?? ""}</p>
        <span>{rotulo}</span>
      </>
    );
  }

  return (
    <>
      <div className="chk-assin">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a.imagem} alt="Assinatura" />
      </div>
      <p className="chk-linha chk-linha-assinada">{a.nome}</p>
      <span>
        {rotulo} · {formatarData(a.assinado_em)}
      </span>
    </>
  );
}
