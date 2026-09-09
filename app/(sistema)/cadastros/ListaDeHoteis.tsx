"use client";

// Cadastro de hotéis e pousadas por município.
//
// Existe para não procurar hotel de novo a cada viagem, e para o previsto
// da diária sair de um valor COMBINADO com a casa, não de estimativa de
// memória.
//
// EXCLUIR uma casa usada desfaz o vínculo e o histórico do gasto fica sem
// ela — o caminho certo é marcar como INATIVA. A tela diz em quantas
// solicitações a casa aparece antes de perguntar.

import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { Modal } from "@/app/components/Modal";
import { useAvisos } from "@/app/components/Avisos";
import { CampoMascarado, Caixa, Grupo } from "@/app/components/Campos";
import { BotaoExportarCsv, Selo, TabelaVazia } from "@/app/components/Tabela";
import { Icone } from "@/app/components/Icone";
import { ErroDaApi, mensagemDoErro, patch, post, remover } from "@/app/components/api";
import { HotelEmPopup } from "@/app/(sistema)/cadastros/InformacoesEmPopup";
import { UFS, UF_PADRAO } from "@/lib/listas";
import { csvNumero, formatarMoeda, formatarNumeroBR, parseMoeda } from "@/lib/formato";
import { TIPOS_HOTEL, type Hotel, type TipoHotel } from "@/lib/tipos";

interface Rascunho {
  id: string | null;
  nome: string;
  tipo: TipoHotel;
  municipio: string;
  uf: string;
  endereco: string;
  bairro: string;
  telefone: string;
  whatsapp: string;
  email: string;
  contato: string;
  diaria: string;
  cafe: boolean;
  estacionamento: boolean;
  faturamento: boolean;
  observacao: string;
  ativo: boolean;
}

function rascunhoVazio(): Rascunho {
  return {
    id: null,
    nome: "",
    tipo: "Hotel",
    municipio: "",
    uf: UF_PADRAO,
    endereco: "",
    bairro: "",
    telefone: "",
    whatsapp: "",
    email: "",
    contato: "",
    diaria: "",
    cafe: false,
    estacionamento: false,
    faturamento: false,
    observacao: "",
    ativo: true,
  };
}

function rascunhoDe(h: Hotel): Rascunho {
  return {
    id: h.id,
    nome: h.nome,
    tipo: h.tipo,
    municipio: h.municipio,
    uf: h.uf,
    endereco: h.endereco ?? "",
    bairro: h.bairro ?? "",
    telefone: h.telefone ?? "",
    whatsapp: h.whatsapp ?? "",
    email: h.email ?? "",
    contato: h.contato_nome ?? "",
    diaria: formatarNumeroBR(h.valor_diaria),
    cafe: h.cafe_incluso,
    estacionamento: h.estacionamento,
    faturamento: h.aceita_faturamento,
    observacao: h.observacao ?? "",
    ativo: h.ativo,
  };
}

interface Props {
  hoteis: Hotel[];
  usosPorHotel: Record<string, number>;
  podeExcluir: boolean;
  v2Ativa: boolean;
  /** As abas dos cadastros, para entrarem na MESMA linha dos filtros — ver
   *  o comentário em TelaDeCadastros. Chegam prontas de lá. */
  abas?: ReactNode;
}

export function ListaDeHoteis({ hoteis, usosPorHotel, podeExcluir, v2Ativa, abas }: Props) {
  const roteador = useRouter();
  const { avisar } = useAvisos();

  const [uf, setUf] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [busca, setBusca] = useState("");
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const ufs = useMemo(
    () => Array.from(new Set(hoteis.map((h) => h.uf))).sort(),
    [hoteis]
  );
  const municipios = useMemo(
    () =>
      Array.from(new Set(hoteis.filter((h) => !uf || h.uf === uf).map((h) => h.municipio))).sort((a, b) =>
        a.localeCompare(b, "pt-BR")
      ),
    [hoteis, uf]
  );

  const filtrados = useMemo(() => {
    const texto = busca.trim().toLowerCase();
    return hoteis.filter((h) => {
      if (uf && h.uf !== uf) return false;
      if (municipio && h.municipio !== municipio) return false;
      if (!texto) return true;
      return `${h.nome} ${h.municipio} ${h.contato_nome ?? ""}`.toLowerCase().includes(texto);
    });
  }, [hoteis, uf, municipio, busca]);

  async function salvar() {
    if (!rascunho) return;
    if (!rascunho.nome.trim() || !rascunho.municipio.trim() || !rascunho.uf) {
      avisar("Preencha nome, município e UF.", "erro");
      return;
    }

    const corpo = {
      nome: rascunho.nome,
      tipo: rascunho.tipo,
      municipio: rascunho.municipio,
      uf: rascunho.uf,
      endereco: rascunho.endereco || null,
      bairro: rascunho.bairro || null,
      telefone: rascunho.telefone || null,
      whatsapp: rascunho.whatsapp || null,
      email: rascunho.email || null,
      contato_nome: rascunho.contato || null,
      valor_diaria: parseMoeda(rascunho.diaria),
      cafe_incluso: rascunho.cafe,
      estacionamento: rascunho.estacionamento,
      aceita_faturamento: rascunho.faturamento,
      observacao: rascunho.observacao || null,
      ativo: rascunho.ativo,
    };

    setOcupado(true);
    try {
      if (rascunho.id) await patch(`/api/hoteis/${rascunho.id}`, corpo);
      else await post("/api/hoteis", corpo);
      setRascunho(null);
      avisar(rascunho.id ? "Hotel atualizado." : "Hotel cadastrado.", "ok");
      roteador.refresh();
    } catch (erro) {
      avisar(mensagemDoErro(erro, "salvar o hotel"), "erro");
    } finally {
      setOcupado(false);
    }
  }

  async function excluir(h: Hotel) {
    const usos = usosPorHotel[h.id] ?? 0;
    const pergunta = usos
      ? `${h.nome} está em ${usos} solicitação(ões). Excluir desfaz esse vínculo e o histórico do gasto fica sem a casa — o melhor é marcar como inativa. Excluir mesmo assim?`
      : `Excluir ${h.nome}?`;
    if (!window.confirm(pergunta)) return;

    try {
      // `confirmar=1` porque a pessoa acabou de ver o número e disse sim.
      // A rota recusa a exclusão de casa em uso sem essa confirmação.
      await remover(`/api/hoteis/${h.id}?confirmar=1`);
      avisar("Hotel excluído.", "ok");
      roteador.refresh();
    } catch (erro) {
      // 403 aqui é a RLS falando: só a Gestão exclui.
      avisar(
        erro instanceof ErroDaApi && erro.status === 403
          ? "Só a Gestão exclui cadastro de hotel."
          : mensagemDoErro(erro, "excluir o hotel"),
        "erro"
      );
    }
  }

  return (
    <div className="lista-wrapper">
      <div className="table-controls">
        <div className="filter-row">
          {abas}
          <select
            className="form-control filter-select"
            value={uf}
            onChange={(e) => {
              setUf(e.target.value);
              setMunicipio("");
            }}
            aria-label="Filtrar por estado"
          >
            <option value="">Todos os estados</option>
            {ufs.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
          <select
            className="form-control filter-select"
            value={municipio}
            onChange={(e) => setMunicipio(e.target.value)}
            aria-label="Filtrar por município"
          >
            <option value="">Todos os municípios</option>
            {municipios.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <input
            className="form-control search-input"
            placeholder="Buscar por nome, município ou contato"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar"
          />
          <div className="filter-row-actions">
            <BotaoExportarCsv
              arquivo="hoteis"
              cabecalho={CABECALHO_CSV}
              linhas={() => filtrados.map(linhaCsv)}
            />
            <button className="btn btn-primary btn-sm" type="button" onClick={() => setRascunho(rascunhoVazio())}>
              + Novo hotel
            </button>
          </div>
        </div>
        <div className="filter-resumo">
          {v2Ativa
            ? `${filtrados.length} casa(s) no filtro`
            : "Rode supabase/02_campo_v2.sql para o cadastro de hotéis funcionar."}
        </div>
      </div>

      <div className="table-wrapper">
        <div className="table-scroll">
          <table className="art-table tabela-centralizada">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Tipo</th>
                <th>Município</th>
                <th>UF</th>
                <th>Telefone</th>
                <th>Contato</th>
                <th>Diária</th>
                <th>Café</th>
                <th>Faturamento</th>
                <th>Situação</th>
                <th className="col-acoes">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((h) => (
                <tr key={h.id}>
                  <td>{h.nome}</td>
                  <td>{h.tipo}</td>
                  <td>{h.municipio}</td>
                  <td>{h.uf}</td>
                  <td>{h.telefone || "—"}</td>
                  <td>{h.contato_nome || "—"}</td>
                  <td>{formatarMoeda(h.valor_diaria)}</td>
                  <td>{h.cafe_incluso ? "Sim" : "—"}</td>
                  <td>{h.aceita_faturamento ? "Sim" : "—"}</td>
                  <td>
                    <Selo texto={h.ativo ? "Ativo" : "Inativo"} classe={h.ativo ? "st-ok" : "st-neutro"} />
                  </td>
                  <td className="table-actions">
                    {/* Ler vem antes de mexer, e não depende de permissão:
                        endereço, WhatsApp, e-mail, estacionamento e
                        observação não estão na tabela e só existiam dentro
                        do formulário de edição. */}
                    <HotelEmPopup hotel={h} usos={usosPorHotel[h.id] ?? 0} />
                    <button
                      className="btn-icon"
                      type="button"
                      title="Editar"
                      onClick={() => setRascunho(rascunhoDe(h))}
                    >
                      <Icone nome="editar" />
                    </button>
                    {podeExcluir ? (
                      <button
                        className="btn-icon btn-icon-danger"
                        type="button"
                        title="Excluir"
                        onClick={() => void excluir(h)}
                      >
                        <Icone nome="lixeira" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TabelaVazia visivel={filtrados.length === 0}>
            <strong>Nenhum hotel cadastrado</strong>
          </TabelaVazia>
        </div>
      </div>

      <Modal
        titulo={rascunho?.id ? "Editar hotel" : "Novo hotel"}
        aberto={rascunho !== null}
        aoFechar={() => setRascunho(null)}
        rodape={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setRascunho(null)} disabled={ocupado}>
              Cancelar
            </button>
            <button className="btn btn-primary" type="button" onClick={salvar} disabled={ocupado}>
              {ocupado ? "Salvando…" : "Salvar"}
            </button>
          </>
        }
      >
        {rascunho ? (
          <>
            <div className="form-section-block">
              <h4 className="form-subtitle">Identificação</h4>
              <div className="form-grid">
                <Grupo rotulo="Nome" obrigatorio>
                  {(id) => (
                    <input
                      id={id}
                      className="form-control"
                      placeholder="Nome da casa"
                      value={rascunho.nome}
                      onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })}
                    />
                  )}
                </Grupo>
                <Grupo rotulo="Tipo" obrigatorio>
                  {(id) => (
                    <select
                      id={id}
                      className="form-control"
                      value={rascunho.tipo}
                      onChange={(e) => setRascunho({ ...rascunho, tipo: e.target.value as TipoHotel })}
                    >
                      {TIPOS_HOTEL.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  )}
                </Grupo>
                <Grupo rotulo="Município" obrigatorio>
                  {(id) => (
                    <input
                      id={id}
                      className="form-control"
                      placeholder="Cidade"
                      value={rascunho.municipio}
                      onChange={(e) => setRascunho({ ...rascunho, municipio: e.target.value })}
                    />
                  )}
                </Grupo>
                <Grupo rotulo="UF" obrigatorio>
                  {(id) => (
                    <select
                      id={id}
                      className="form-control"
                      value={rascunho.uf}
                      onChange={(e) => setRascunho({ ...rascunho, uf: e.target.value })}
                    >
                      {UFS.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  )}
                </Grupo>
                <Grupo rotulo="Endereço" largo>
                  {(id) => (
                    <input
                      id={id}
                      className="form-control"
                      placeholder="Rua, número"
                      value={rascunho.endereco}
                      onChange={(e) => setRascunho({ ...rascunho, endereco: e.target.value })}
                    />
                  )}
                </Grupo>
                <Grupo rotulo="Bairro">
                  {(id) => (
                    <input
                      id={id}
                      className="form-control"
                      value={rascunho.bairro}
                      onChange={(e) => setRascunho({ ...rascunho, bairro: e.target.value })}
                    />
                  )}
                </Grupo>
              </div>
            </div>

            <div className="form-section-block">
              <h4 className="form-subtitle">Contato</h4>
              <div className="form-grid">
                {/* Os dois mascarados e com teto de onze dígitos: era campo
                    livre, e telefone de hotel com um dígito a mais é
                    ligação que não completa na hora de confirmar a reserva. */}
                <Grupo rotulo="Telefone">
                  {(id) => (
                    <CampoMascarado
                      id={id}
                      mascara="telefone"
                      valor={rascunho.telefone}
                      aoMudar={(v) => setRascunho({ ...rascunho, telefone: v })}
                    />
                  )}
                </Grupo>
                <Grupo rotulo="WhatsApp">
                  {(id) => (
                    <CampoMascarado
                      id={id}
                      mascara="telefone"
                      valor={rascunho.whatsapp}
                      aoMudar={(v) => setRascunho({ ...rascunho, whatsapp: v })}
                    />
                  )}
                </Grupo>
                <Grupo rotulo="E-mail">
                  {(id) => (
                    <input
                      id={id}
                      className="form-control"
                      type="email"
                      value={rascunho.email}
                      onChange={(e) => setRascunho({ ...rascunho, email: e.target.value })}
                    />
                  )}
                </Grupo>
                <Grupo rotulo="Pessoa de contato">
                  {(id) => (
                    <input
                      id={id}
                      className="form-control"
                      value={rascunho.contato}
                      onChange={(e) => setRascunho({ ...rascunho, contato: e.target.value })}
                    />
                  )}
                </Grupo>
              </div>
            </div>

            <div className="form-section-block">
              <h4 className="form-subtitle">Comercial</h4>
              <div className="form-grid">
                <Grupo rotulo="Diária combinada" obrigatorio>
                  {(id) => (
                    <CampoMascarado
                      id={id}
                      mascara="moeda"
                      valor={rascunho.diaria}
                      aoMudar={(v) => setRascunho({ ...rascunho, diaria: v })}
                    />
                  )}
                </Grupo>
                <Grupo rotulo="Situação">
                  {(id) => (
                    <select
                      id={id}
                      className="form-control"
                      value={rascunho.ativo ? "1" : "0"}
                      onChange={(e) => setRascunho({ ...rascunho, ativo: e.target.value === "1" })}
                    >
                      <option value="1">Ativo</option>
                      <option value="0">Inativo</option>
                    </select>
                  )}
                </Grupo>
              </div>
              <div className="checks-linha" style={{ marginTop: ".5rem" }}>
                <Caixa marcada={rascunho.cafe} aoMudar={(v) => setRascunho({ ...rascunho, cafe: v })}>
                  Café da manhã incluso
                </Caixa>
                <Caixa
                  marcada={rascunho.estacionamento}
                  aoMudar={(v) => setRascunho({ ...rascunho, estacionamento: v })}
                >
                  Estacionamento
                </Caixa>
                <Caixa
                  marcada={rascunho.faturamento}
                  aoMudar={(v) => setRascunho({ ...rascunho, faturamento: v })}
                >
                  Aceita faturamento
                </Caixa>
              </div>
              <div className="form-group" style={{ marginTop: ".6rem" }}>
                <label className="form-label" htmlFor="hotel-obs">
                  Observação
                </label>
                <textarea
                  id="hotel-obs"
                  className="form-control"
                  rows={2}
                  placeholder="O que vale saber antes de reservar"
                  value={rascunho.observacao}
                  onChange={(e) => setRascunho({ ...rascunho, observacao: e.target.value })}
                />
              </div>
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  );
}

const CABECALHO_CSV = [
  "Nome", "Tipo", "Município", "UF", "Endereço", "Bairro", "Telefone", "WhatsApp",
  "E-mail", "Contato", "Diária", "Café", "Estacionamento", "Faturamento", "Situação", "Observação",
] as const;

function linhaCsv(h: Hotel): unknown[] {
  return [
    h.nome, h.tipo, h.municipio, h.uf, h.endereco ?? "", h.bairro ?? "",
    h.telefone ?? "", h.whatsapp ?? "", h.email ?? "", h.contato_nome ?? "",
    csvNumero(h.valor_diaria),
    h.cafe_incluso ? "Sim" : "Não",
    h.estacionamento ? "Sim" : "Não",
    h.aceita_faturamento ? "Sim" : "Não",
    h.ativo ? "Ativo" : "Inativo",
    h.observacao ?? "",
  ];
}
