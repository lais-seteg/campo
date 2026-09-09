"use client";

// ═══════════════════════════════════════════════════════════════════════
//  O AJUSTE DO CAMPO EM ANDAMENTO — a chave inglesa
//
//  Campo em andamento pede coisas que o pedido não previu: material que
//  faltou, uma diária a mais porque estendeu, um táxi de madrugada. Isso se
//  fazia editando o pedido, e a edição é o lugar errado — ela APAGA e
//  reescreve as filhas, então o acréscimo de hoje sumia na próxima
//  correção de qualquer outro campo (ver `limparFilhas` e supabase/17).
//
//  ── CHAVE INGLESA, E NÃO "+" ──
//
//  O "+" diz "adicionar mais um item à lista". O que se faz aqui é
//  CONSERTAR um pedido que já está de pé, e continua de pé — o gesto é
//  outro, e o ícone tem de dizer qual.
//
//  ── TRÊS COISAS NUMA JANELA, E NÃO TRÊS BOTÕES ──
//
//  Material, diária e despesa são três tabelas e três funções no banco, mas
//  do lado de quem usa é UMA pergunta: "o campo precisou de mais o quê?".
//  Três ícones na coluna de ações faria a pessoa escolher a porta antes de
//  saber o que vai pedir — e a coluna já tem quatro.
//
//  ── O MOTIVO NÃO É DECORAÇÃO ──
//
//  Ele vai para a frase do histórico, junto do número. Uma linha de custo
//  que aparece sem explicação é o que trava a prestação de contas seis
//  meses depois, quando ninguém lembra por que houve um táxi de R$ 180.
//
//  ── E O HISTÓRICO FICA À VISTA ──
//
//  A janela mostra o que já foi acrescentado neste pedido. Sem isso, duas
//  pessoas conferindo o mesmo campo lançam a mesma diária duas vezes — e a
//  segunda só aparece na conciliação.
// ═══════════════════════════════════════════════════════════════════════

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Modal } from "@/app/components/Modal";
import { Icone } from "@/app/components/Icone";
import { useAvisos } from "@/app/components/Avisos";
import { CampoMascarado } from "@/app/components/Campos";
import { get, mensagemDoErro, post } from "@/app/components/api";
import { formatarDataHora, formatarNumeroBR, parseMoeda } from "@/lib/formato";
import { podeEditar } from "@/lib/papeis";
import {
  GRUPOS_DESPESA,
  VINCULOS,
  type DiariaValor,
  type GrupoDespesa,
  type Item,
  type SolicitacaoAlteracao,
  type SolicitacaoDeLista,
  type Vinculo,
} from "@/lib/tipos";

type Aba = "material" | "diaria" | "despesa";

const ABAS: readonly { chave: Aba; rotulo: string }[] = [
  { chave: "material", rotulo: "Material" },
  { chave: "diaria", rotulo: "Diária" },
  { chave: "despesa", rotulo: "Despesa" },
];

export function AjusteEmCampo({
  solicitacao: s,
  catalogo,
  diarias,
}: {
  solicitacao: SolicitacaoDeLista;
  catalogo: readonly Item[];
  /** A tabela de referência da diária — só para SUGERIR o valor. */
  diarias: readonly DiariaValor[];
}) {
  const roteador = useRouter();
  const { avisar } = useAvisos();

  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<Aba>("material");
  const [ocupado, setOcupado] = useState(false);
  const [historico, setHistorico] = useState<SolicitacaoAlteracao[] | null>(null);

  const [motivo, setMotivo] = useState("");

  // Material
  const [itemId, setItemId] = useState("");
  const [quantidade, setQuantidade] = useState("1");

  // Diária
  const [colaborador, setColaborador] = useState("");
  const [vinculo, setVinculo] = useState<Vinculo>("Seteg");
  const [tipoDiaria, setTipoDiaria] = useState("");
  const [dias, setDias] = useState("1");
  const [valorDiaria, setValorDiaria] = useState("");

  // Despesa
  const [grupo, setGrupo] = useState<GrupoDespesa>("Outros");
  const [descricao, setDescricao] = useState("");
  const [valorDespesa, setValorDespesa] = useState("");

  const abrir = useCallback(async () => {
    setAberto(true);
    // O histórico é buscado a cada abertura: entre uma e outra alguém pode
    // ter lançado algo, e é exatamente essa a duplicidade que se quer
    // evitar mostrando a lista.
    try {
      const carga = await get<{ alteracoes: SolicitacaoAlteracao[] }>(
        `/api/solicitacoes/${s.id}/detalhe`
      );
      setHistorico(carga.alteracoes.filter((a) => a.tipo === "Acréscimo"));
    } catch {
      // Sem histórico a janela continua servindo para lançar. Um alerta
      // aqui atrapalharia o que a pessoa veio fazer.
      setHistorico([]);
    }
  }, [s.id]);

  function limpar() {
    setMotivo("");
    setItemId("");
    setQuantidade("1");
    setColaborador("");
    setTipoDiaria("");
    setDias("1");
    setValorDiaria("");
    setDescricao("");
    setValorDespesa("");
  }

  /** Escolher o tipo da diária traz o valor de REFERÊNCIA de hoje. Só
   *  sugestão: diária lançada guarda o valor com que foi lançada, e quem
   *  combinou outro número digita o outro número. */
  function aplicarTipoDeDiaria(tipo: string) {
    setTipoDiaria(tipo);
    const referencia = diarias.find((d) => d.tipo_diaria === tipo);
    if (referencia) setValorDiaria(formatarNumeroBR(referencia.valor));
  }

  async function lancar() {
    const corpo =
      aba === "material"
        ? { tipo: aba, motivo, item_id: itemId, quantidade: Number(quantidade) }
        : aba === "diaria"
          ? {
              tipo: aba,
              motivo,
              colaborador,
              vinculo,
              tipo_diaria: tipoDiaria,
              dias: Number(dias),
              valor_unitario: parseMoeda(valorDiaria),
            }
          : { tipo: aba, motivo, grupo, descricao, valor: parseMoeda(valorDespesa) };

    setOcupado(true);
    try {
      await post(`/api/solicitacoes/${s.id}/ajustes`, corpo);
      avisar(
        aba === "material"
          ? "Material acrescentado e reservado nas datas do campo."
          : aba === "diaria"
            ? "Diária acrescentada ao pedido."
            : "Despesa acrescentada ao pedido.",
        "ok"
      );
      limpar();
      // A janela FICA ABERTA: quem ajusta um campo em andamento raramente
      // ajusta uma coisa só, e fechar obrigaria a reabrir e reencontrar a
      // linha. O histórico logo abaixo já mostra o que acabou de entrar.
      await abrir();
      roteador.refresh();
    } catch (erro) {
      avisar(mensagemDoErro(erro, "acrescentar ao pedido"), "erro");
    } finally {
      setOcupado(false);
    }
  }

  // Pedido fechado é REGISTRO: acrescentar custo a um campo que já
  // encerrou não é ajuste, é reescrever a história dele — e o gasto do
  // projeto já foi somado com o número de lá. O banco recusa igual; aqui o
  // botão nem aparece.
  //
  // Depois de todos os hooks, e não antes: `return` no meio faria a
  // contagem de hooks mudar entre renderizações.
  if (!podeEditar(s.status)) return null;

  // Item em manutenção não sai para campo — ele está no conserto. Deixá-lo
  // na lista seria oferecer o que a reserva vai recusar depois, com a
  // pessoa já tendo escolhido.
  const doCatalogo = catalogo.filter((i) => !i.em_manutencao);
  const tiposDeDiaria = diarias.filter((d) => d.vinculo === vinculo && d.ativo);

  return (
    <>
      <button
        className="btn-icon"
        type="button"
        title="Pedir ajuste: material, diária ou despesa"
        aria-label="Pedir ajuste: material, diária ou despesa"
        onClick={() => void abrir()}
      >
        <Icone nome="ferramenta" />
      </button>

      <Modal
        titulo={`Ajuste em campo · ${s.codigo}`}
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        rodape={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setAberto(false)} disabled={ocupado}>
              Fechar
            </button>
            <button className="btn btn-primary" type="button" onClick={lancar} disabled={ocupado}>
              {ocupado ? "Lançando…" : "Acrescentar"}
            </button>
          </>
        }
      >
        <div className="cad-abas" style={{ marginBottom: ".7rem" }}>
          {ABAS.map((a) => (
            <button
              key={a.chave}
              className={`cad-aba${aba === a.chave ? " active" : ""}`}
              type="button"
              onClick={() => setAba(a.chave)}
            >
              {a.rotulo}
            </button>
          ))}
        </div>

        <div className="form-section-block">
          <div className="form-grid">
            {aba === "material" ? (
              <>
                <div className="form-group">
                  <label className="form-label required" htmlFor="aj-item">
                    Equipamento
                  </label>
                  <select
                    id="aj-item"
                    className="form-control"
                    value={itemId}
                    onChange={(e) => setItemId(e.target.value)}
                  >
                    <option value="">Escolha no estoque</option>
                    {doCatalogo.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.produto} · {i.codigo}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label required" htmlFor="aj-qtd">
                    Quantidade
                  </label>
                  <input
                    id="aj-qtd"
                    className="form-control"
                    type="number"
                    min={1}
                    value={quantidade}
                    onChange={(e) => setQuantidade(e.target.value)}
                  />
                </div>
                <p className="modal-hint full-width">
                  O material é reservado nas datas deste campo na mesma transação. Se não couber, nada é
                  gravado e a mensagem diz o que falta — material novo disputa as datas como qualquer outro.
                </p>
              </>
            ) : null}

            {aba === "diaria" ? (
              <>
                <div className="form-group">
                  <label className="form-label required" htmlFor="aj-colab">
                    Quem recebe
                  </label>
                  <input
                    id="aj-colab"
                    className="form-control"
                    list="aj-equipe"
                    placeholder="Nome de quem esteve em campo"
                    value={colaborador}
                    onChange={(e) => setColaborador(e.target.value)}
                  />
                  {/* A equipe DESTE pedido como sugestão: quem recebe diária
                      deste campo é quem foi a este campo. */}
                  <datalist id="aj-equipe">
                    {s.equipe.map((e) => (
                      <option key={e.id} value={e.colaborador} />
                    ))}
                  </datalist>
                </div>
                <div className="form-group">
                  <label className="form-label required" htmlFor="aj-vinculo">
                    Vínculo
                  </label>
                  <select
                    id="aj-vinculo"
                    className="form-control"
                    value={vinculo}
                    onChange={(e) => {
                      setVinculo(e.target.value as Vinculo);
                      // O tipo pertence ao vínculo: trocar de vínculo sem
                      // limpar deixaria uma diária de temporário lançada
                      // como Seteg.
                      setTipoDiaria("");
                      setValorDiaria("");
                    }}
                  >
                    {VINCULOS.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label required" htmlFor="aj-tipo-diaria">
                    Tipo da diária
                  </label>
                  <select
                    id="aj-tipo-diaria"
                    className="form-control"
                    value={tipoDiaria}
                    onChange={(e) => aplicarTipoDeDiaria(e.target.value)}
                  >
                    <option value="">Escolha</option>
                    {tiposDeDiaria.map((d) => (
                      <option key={d.id} value={d.tipo_diaria}>
                        {d.tipo_diaria}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label required" htmlFor="aj-dias">
                    Dias
                  </label>
                  <input
                    id="aj-dias"
                    className="form-control"
                    type="number"
                    min={1}
                    value={dias}
                    onChange={(e) => setDias(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label required" htmlFor="aj-valor-diaria">
                    Valor por dia
                  </label>
                  <CampoMascarado
                    id="aj-valor-diaria"
                    mascara="moeda"
                    valor={valorDiaria}
                    aoMudar={setValorDiaria}
                  />
                </div>
                <p className="modal-hint full-width">
                  O valor vem da tabela de referência como sugestão e pode ser trocado: a diária lançada
                  guarda o valor com que foi lançada.
                </p>
              </>
            ) : null}

            {aba === "despesa" ? (
              <>
                <div className="form-group">
                  <label className="form-label required" htmlFor="aj-grupo">
                    Grupo
                  </label>
                  <select
                    id="aj-grupo"
                    className="form-control"
                    value={grupo}
                    onChange={(e) => setGrupo(e.target.value as GrupoDespesa)}
                  >
                    {GRUPOS_DESPESA.map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label required" htmlFor="aj-valor-despesa">
                    Valor
                  </label>
                  <CampoMascarado
                    id="aj-valor-despesa"
                    mascara="moeda"
                    valor={valorDespesa}
                    aoMudar={setValorDespesa}
                  />
                </div>
                <div className="form-group full-width">
                  <label className="form-label required" htmlFor="aj-descricao">
                    O que foi
                  </label>
                  <input
                    id="aj-descricao"
                    className="form-control"
                    placeholder="Táxi do aeroporto ao alojamento, pedágio da BR-116…"
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                  />
                </div>
              </>
            ) : null}

            <div className="form-group full-width">
              <label className="form-label" htmlFor="aj-motivo">
                Motivo do ajuste
              </label>
              <input
                id="aj-motivo"
                className="form-control"
                placeholder="Por que o campo precisou disto — o campo estendeu dois dias, o medidor falhou…"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
              <p className="modal-hint">
                Entra na linha do histórico, junto do número. É o que responde, seis meses depois, por que
                este custo existe.
              </p>
            </div>
          </div>
        </div>

        <div className="modal-subtitle">Já acrescentado neste pedido</div>
        {historico === null ? (
          <p className="modal-hint">Carregando…</p>
        ) : historico.length === 0 ? (
          <p className="modal-hint">Nada foi acrescentado a este pedido ainda.</p>
        ) : (
          /* Mesma marcação e mesmas classes do histórico do olho: quatro
             colunas na grade de `.hist-linha` e o selo laranja de
             `.hist-acrescimo`. Uma segunda forma para o mesmo dado faria a
             pessoa reaprender a ler a mesma lista. */
          <div className="hist-lista">
            {historico.map((a) => (
              <div className="hist-linha" key={a.id}>
                <span className="hist-tipo hist-acrescimo">{a.tipo}</span>
                <strong>{a.campo}</strong>
                <span>{a.para || "—"}</span>
                <em>
                  {formatarDataHora(a.data)} · {a.usuario_nome || "—"}
                </em>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
