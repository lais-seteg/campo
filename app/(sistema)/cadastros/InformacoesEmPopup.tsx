"use client";

// ═══════════════════════════════════════════════════════════════════════
//  O OLHO DOS CADASTROS
//
//  Mesmo gesto e mesmo desenho do olho das solicitações: um modal sobre a
//  tela em que a pessoa já está, com o registro INTEIRO. É o padrão dos
//  outros sistemas da pasta ("Informações do Equipamento" do Controle de
//  Estoque).
//
//  ── POR QUE ELE FAZ FALTA AQUI ──
//
//  A tabela de hotéis mostra nove colunas de dezesseis campos. Endereço,
//  bairro, WhatsApp, e-mail, estacionamento e observação — justamente o
//  que se procura quando se vai LIGAR para confirmar uma reserva — só
//  existiam dentro do formulário de EDIÇÃO. Quem só queria o telefone
//  tinha de abrir o modo de editar um cadastro, e abrir edição para ler é
//  como se arrisca a salvar sem querer o que não se queria mexer.
//
//  Ler e alterar viram duas portas: o olho MOSTRA, o lápis MEXE. E o olho
//  não depende de permissão — ler o cadastro é de quem abre a tela;
//  alterar é da Gestão.
// ═══════════════════════════════════════════════════════════════════════

import { useState, type ReactNode } from "react";
import { Modal, type TamanhoDoModal } from "@/app/components/Modal";
import { Icone } from "@/app/components/Icone";
import { Grade, Info } from "@/app/components/Detalhe";
import { Selo } from "@/app/components/Tabela";
import { formatarData, formatarMoeda } from "@/lib/formato";
import type { DiariaValor, Hotel } from "@/lib/tipos";

/** O botão de olho e o modal em volta. Só o conteúdo muda entre cadastros. */
function OlhoEmPopup({
  titulo,
  tamanho,
  children,
}: {
  titulo: string;
  tamanho?: TamanhoDoModal;
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <button
        className="btn-icon"
        type="button"
        title="Ver informações"
        aria-label="Ver informações"
        onClick={() => setAberto(true)}
      >
        <Icone nome="olho" />
      </button>

      <Modal
        titulo={titulo}
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        tamanho={tamanho}
        rodape={
          <button className="btn btn-ghost" type="button" onClick={() => setAberto(false)}>
            Fechar
          </button>
        }
      >
        {/* Só monta a grade com o modal aberto: são muitas linhas por
            hotel, e a tabela pode ter dezenas deles. */}
        {aberto ? children : null}
      </Modal>
    </>
  );
}

export function HotelEmPopup({ hotel: h, usos }: { hotel: Hotel; usos: number }) {
  return (
    <OlhoEmPopup titulo={`${h.nome} · ${h.municipio}/${h.uf}`}>
      <Grade>
        <Info rotulo="Nome">{h.nome}</Info>
        <Info rotulo="Tipo">{h.tipo}</Info>
        <Info rotulo="Município">{h.municipio}</Info>
        <Info rotulo="UF">{h.uf}</Info>
        <Info rotulo="Endereço" duplo>
          {h.endereco || "—"}
        </Info>
        <Info rotulo="Bairro">{h.bairro || "—"}</Info>
        <Info rotulo="Telefone">{h.telefone || "—"}</Info>
        <Info rotulo="WhatsApp">{h.whatsapp || "—"}</Info>
        <Info rotulo="E-mail" duplo>
          {h.email || "—"}
        </Info>
        <Info rotulo="Pessoa de contato">{h.contato_nome || "—"}</Info>
        <Info rotulo="Diária combinada">{formatarMoeda(h.valor_diaria)}</Info>
        <Info rotulo="Café da manhã">{h.cafe_incluso ? "Incluso" : "Não incluso"}</Info>
        <Info rotulo="Estacionamento">{h.estacionamento ? "Tem" : "Não tem"}</Info>
        <Info rotulo="Aceita faturamento">{h.aceita_faturamento ? "Sim" : "Não"}</Info>
        <Info rotulo="Situação">
          <Selo texto={h.ativo ? "Ativo" : "Inativo"} classe={h.ativo ? "st-ok" : "st-neutro"} />
        </Info>
        {/* O número que a tela de exclusão usa para avisar: é ele que diz
            se a casa está em uso ou se é cadastro esquecido. */}
        <Info rotulo="Em solicitações">{usos ? `${usos} campo(s)` : "nenhuma ainda"}</Info>
        <Info rotulo="Cadastrada em">{formatarData(h.criado_em)}</Info>
        <Info rotulo="Última alteração">{formatarData(h.atualizado_em)}</Info>
        {h.observacao ? (
          <Info rotulo="Observação" largo>
            {h.observacao}
          </Info>
        ) : null}
      </Grade>
    </OlhoEmPopup>
  );
}

export function DiariaEmPopup({ diaria: d }: { diaria: DiariaValor }) {
  return (
    <OlhoEmPopup titulo={d.tipo_diaria} tamanho="sm">
      <Grade>
        <Info rotulo="Diária">{d.tipo_diaria}</Info>
        <Info rotulo="Vínculo">{d.vinculo}</Info>
        <Info rotulo="Pernoite">
          <Selo
            texto={d.pernoite ? "Com pernoite" : "Sem pernoite"}
            classe={d.pernoite ? "st-info" : "st-neutro"}
          />
        </Info>
        <Info rotulo="Valor de referência">{formatarMoeda(d.valor)}</Info>
        <Info rotulo="Situação">
          <Selo texto={d.ativo ? "Ativa" : "Inativa"} classe={d.ativo ? "st-ok" : "st-neutro"} />
        </Info>
        {/* A data é a informação que a tabela não tinha e que importa: este
            valor é de referência e muda por decisão administrativa, então
            "de quando é esse valor" faz parte de saber se ele vale. */}
        <Info rotulo="Última alteração">{formatarData(d.atualizado_em)}</Info>
      </Grade>
      <p className="modal-hint">
        Diárias já lançadas guardam o valor com que foram lançadas. Alterar aqui vale para as próximas.
      </p>
    </OlhoEmPopup>
  );
}
