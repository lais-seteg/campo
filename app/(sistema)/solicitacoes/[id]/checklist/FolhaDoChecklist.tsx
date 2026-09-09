"use client";

// ═══════════════════════════════════════════════════════════════════════
//  A FOLHA DO CHECKLIST — um componente, dois lugares
//
//  Ela é montada no POPUP (que é como se usa: `ChecklistEmPopup`, abrindo
//  de qualquer tabela sem sair da tela) e na PÁGINA
//  `/solicitacoes/[id]/checklist`, que continua existindo para link direto
//  e para quem chega pelo endereço.
//
//  Um componente e não dois porque isto é um documento: duas cópias do
//  mesmo layout divergem na primeira alteração, e o que sai no papel
//  passaria a depender de por onde a pessoa entrou.
//
//  `id="checklistFolha"` é o que o `@media print` mira para esconder todo
//  o resto e imprimir só esta folha — vale igual dentro do modal, cujo
//  overlay o print já neutraliza. Trocar por classe quebraria a impressão.
// ═══════════════════════════════════════════════════════════════════════

import {
  AssinarNoChecklist,
  ChecklistDeConferencia,
  ObservacoesDoChecklist,
} from "@/app/(sistema)/solicitacoes/[id]/checklist/ChecklistDeConferencia";
import { dataISOparaBR, formatarData } from "@/lib/formato";
import { periodoTexto } from "@/lib/consultas";
import { podeEditar, podeRegistrarDevolucao, podeRegistrarEntrega } from "@/lib/papeis";
import type {
  Item,
  MomentoAssinatura,
  PapelAssinatura,
  SituacaoDaAssinatura,
  SolicitacaoAssinatura,
  SolicitacaoDeLista,
} from "@/lib/tipos";

export function FolhaDoChecklist({
  solicitacao: s,
  catalogo,
  assinaturas,
  situacao,
}: {
  solicitacao: SolicitacaoDeLista;
  catalogo: Item[];
  /** As assinaturas já registradas, com a imagem — para a folha mostrá-las. */
  assinaturas: readonly SolicitacaoAssinatura[];
  /** Quem já assinou o quê, e qual papel EU posso assinar. */
  situacao: readonly SituacaoDaAssinatura[];
}) {
  // ── UMA CIDADE POR LINHA, E SEM INTERROGAÇÃO ──
  //
  // Saía tudo grudado numa frase só, separado por "·":
  //
  //   FORTALEZA (? a ?, 0d) — LAIS MENDES · CAUCAIA (? a ?, 0d) — LIZABETH
  //
  // Dois problemas, e os dois atrapalham quem está no balcão do hotel com a
  // folha na mão. O primeiro é a forma: três cidades viravam um parágrafo, e
  // achar a sua exigia ler as outras. Agora é uma linha por cidade.
  //
  // O segundo era o "?" — entrada e saída são opcionais no banco e ficavam
  // nulas, então a folha anunciava um período que não sabia. Nos pedidos
  // novos a tela já sugere as datas do campo, e os antigos foram corrigidos
  // (supabase/17); mas se ainda faltar, a folha diz "datas a definir" em vez
  // de fingir um período. Interrogação numa reserva de hotel é pior que
  // silêncio: parece dado, e não é.
  const hospedagens = s.hospedagens.map((h) => {
    const entrada = dataISOparaBR(h.entrada);
    const saida = dataISOparaBR(h.saida);
    const noites = h.dias ?? 0;
    const periodo =
      entrada && saida
        ? `${entrada} a ${saida}${noites ? ` · ${noites} diária(s)` : ""}`
        : "datas a definir";
    return {
      chave: h.id,
      cidade: h.cidade,
      periodo,
      hospedes: h.hospedes ?? "",
    };
  });

  const locadora =
    s.transporte_locadora === "Outros" ? s.transporte_locadora_outra || "Outros" : s.transporte_locadora;
  const veiculo = s.veiculo_necessario
    ? `${s.veiculo_descricao || "—"}${locadora ? ` · ${locadora}` : ""}${s.transporte_placa ? ` · placa ${s.transporte_placa}` : ""}` +
      ` · condutor ${s.veiculo_condutor || "—"} · retirada ${dataISOparaBR(s.veiculo_data_retirada) || "—"} ${s.veiculo_hora_retirada ?? ""} em ${s.veiculo_local_retirada || "—"}`
    : "";

  // A equipe entra na folha: é ela que confere o material na retirada e
  // responde por ele em campo. Uma pessoa por linha, pelo mesmo motivo da
  // hospedagem — é uma lista, e lista grudada em frase não se procura.
  const equipe = s.equipe.map((e) => ({
    chave: e.id,
    nome: `${e.colaborador}${e.lider ? " (líder)" : ""}`,
    funcao: e.funcao ?? "",
  }));

  const emRetirada = !s.entrega_data;
  const podeConferir = emRetirada
    ? podeRegistrarEntrega(s.status)
    : podeRegistrarDevolucao(s.status);

  const daRetirada = situacao.find((a) => a.momento === "Retirada");
  const daDevolucao = situacao.find((a) => a.momento === "Devolução");

  return (
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
          {/* O SETOR saiu da identificação (supabase/16); o ESCOPO entrou no
              lugar dele — e é mais útil na folha impressa: diz qual programa
              do contrato este campo atende. */}
          <tr>
            <th>Solicitante</th>
            <td>{s.solicitante_nome || "—"}</td>
            <th>Escopo</th>
            <td>{s.escopo || "—"}</td>
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
          {equipe.length ? (
            <tr>
              <th>Equipe</th>
              <td colSpan={3}>
                <ul className="chk-lista">
                  {equipe.map((e) => (
                    <li key={e.chave}>
                      <strong>{e.nome}</strong>
                      {e.funcao ? <span>{e.funcao}</span> : null}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ) : null}
          {veiculo ? (
            <tr>
              <th>Veículo</th>
              <td colSpan={3}>{veiculo}</td>
            </tr>
          ) : null}
          {hospedagens.length ? (
            <tr>
              <th>Hospedagem</th>
              <td colSpan={3}>
                <ul className="chk-lista">
                  {hospedagens.map((h) => (
                    <li key={h.chave}>
                      <strong>{h.cidade}</strong>
                      <span>{h.periodo}</span>
                      {h.hospedes ? <span>{h.hospedes}</span> : null}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {/* O bloco impresso é a RAZÃO de o SST estar no pedido de campo: sai
          junto do equipamento, é conferido antes de sair e volta assinado. */}
      {!s.sst_aplicavel ? (
        <div className="chk-sst">
          <strong>SST</strong>
          <p>Não se aplica a este campo.</p>
        </div>
      ) : (
        <div className="chk-sst">
          {/* SST é UMA MARCA desde a v3: o sistema registra que se aplica, e
              o que vai impresso é a LISTA DE EPIs — o que precisa ser
              conferido fisicamente na hora de sair, item por item. */}
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

      {/* A TABELA É INTERATIVA: os quadradinhos do momento em curso são
          botões, a avaria se descreve aqui e o registro sai daqui. */}
      <ChecklistDeConferencia
        solicitacao={s}
        catalogo={catalogo}
        assinaturas={situacao}
        podeConferir={podeConferir}
      />

      <p className="chk-instrucao">
        Na retirada, marque cada item conferido e testado. Na devolução, confira de novo item por item: o
        que não voltar fica em branco e a solicitação continua aberta; avaria deve ser descrita na
        observação.
      </p>

      <ObservacoesDoChecklist
        solicitacaoId={s.id}
        inicial={s.checklist_observacoes ?? ""}
        editavel={podeEditar(s.status)}
      />

      <div className="chk-assinaturas">
        <div>
          <strong>Retirada</strong>
          <p>Data: {dataISOparaBR(s.entrega_data) || "____/____/______"}</p>
          <AssinaturaImpressa
            assinaturas={assinaturas}
            momento="Retirada"
            papel="Administrativo"
            digitado={s.entrega_adm}
          />
          <AssinarNoChecklist
            solicitacaoId={s.id}
            momento="Retirada"
            papel="Administrativo"
            jaAssinada={!!daRetirada?.adm_assinada}
            euAssino={daRetirada?.eu_assino ?? null}
            bloqueado={false}
          />
          <AssinaturaImpressa
            assinaturas={assinaturas}
            momento="Retirada"
            papel="Prestador"
            digitado={s.entrega_prestador}
          />
          <AssinarNoChecklist
            solicitacaoId={s.id}
            momento="Retirada"
            papel="Prestador"
            jaAssinada={!!daRetirada?.prestador_assinada}
            euAssino={daRetirada?.eu_assino ?? null}
            bloqueado={false}
          />
        </div>
        <div>
          <strong>Devolução</strong>
          <p>Data: {dataISOparaBR(s.devolucao_data) || "____/____/______"}</p>
          <AssinaturaImpressa
            assinaturas={assinaturas}
            momento="Devolução"
            papel="Administrativo"
            digitado={s.devolucao_adm}
          />
          <AssinarNoChecklist
            solicitacaoId={s.id}
            momento="Devolução"
            papel="Administrativo"
            jaAssinada={!!daDevolucao?.adm_assinada}
            euAssino={daDevolucao?.eu_assino ?? null}
            // A volta não se assina antes da saída: assinar a devolução de
            // material que não saiu é registro falso, e a folha impressa não
            // distingue isso depois. O banco recusa igual.
            bloqueado={emRetirada}
            motivoDoBloqueio="A devolução só pode ser assinada depois de a retirada ser registrada."
          />
          <AssinaturaImpressa
            assinaturas={assinaturas}
            momento="Devolução"
            papel="Prestador"
            digitado={s.devolucao_prestador}
          />
          <AssinarNoChecklist
            solicitacaoId={s.id}
            momento="Devolução"
            papel="Prestador"
            jaAssinada={!!daDevolucao?.prestador_assinada}
            euAssino={daDevolucao?.eu_assino ?? null}
            bloqueado={emRetirada}
            motivoDoBloqueio="A devolução só pode ser assinada depois de a retirada ser registrada."
          />
        </div>
      </div>
    </div>
  );
}

/** Marcado sai com X; não marcado sai como quadradinho vazio, para marcar à
 *  caneta na hora da conferência. */
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
 * caneta. Quando não existe, a linha continua vazia — a folha tem de servir
 * para assinar à mão também, porque campo sem sinal existe.
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
        {/* Quem estava logado ao assinar. É esta coluna que faz a assinatura
            identificar a pessoa, e não só provar que alguém desenhou. */}
        {a.usuario_nome ? ` · acesso de ${a.usuario_nome}` : ""}
      </span>
    </>
  );
}
