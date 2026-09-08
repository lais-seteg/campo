// ═══════════════════════════════════════════════════════════════════════
//  VALIDAÇÃO DO ORGANOGRAMA
//
//  Compartilhada entre POST e PATCH, para o cadastro e a edição não
//  divergirem no que aceitam.
//
//  Duas regras que não são formalidade:
//
//   · O ACESSO TEM DE EXISTIR E ESTAR ATIVO. Sem esta conferência, um
//     `perfil_id` qualquer passaria pela FK desde que existisse em
//     `perfis` — inclusive o de alguém desativado, que voltaria a aparecer
//     como candidato a líder.
//   · UM ACESSO É DE UMA PESSOA SÓ. A unicidade é do banco
//     (`colaboradores_perfil_id_key`); barrar aqui é o que dá a mensagem
//     que diz DE QUEM é o acesso, em vez do erro cru da constraint.
//
//  `nome` vai para caixa alta como todo nome no sistema (cliente, projeto,
//  destino): é o que faz a busca e a exportação não dependerem de como
//  cada um digitou. E-MAIL é a exceção de sempre — endereço é literal, e
//  CARGO é a outra: vem de lista fechada, então já chega numa grafia só.
// ═══════════════════════════════════════════════════════════════════════

import { CARGOS, VINCULOS, type Colaborador, type Perfil, type Vinculo } from "@/lib/tipos";
import {
  TEXTO_LONGO,
  booleano,
  daLista,
  maiusculas,
  texto,
  textoOpcional,
  uuidOpcional,
} from "@/lib/validacao";

export interface CorpoDeColaborador {
  nome: string;
  codigo: string | null;
  cargo: string | null;
  setor: string | null;
  telefone: string | null;
  email: string | null;
  vinculo: Vinculo;
  perfil_id: string | null;
  ativo: boolean;
  observacao: string | null;
}

export type ResultadoDeColaborador =
  | { ok: true; dados: CorpoDeColaborador }
  | { ok: false; erro: string };

const MAX_CODIGO = 40;
const MAX_TELEFONE = 40;

/**
 * @param perfis acessos ATIVOS do sistema — o vínculo tem de ser com um
 *   deles.
 * @param colaboradores o organograma como está, para detectar acesso já
 *   usado por outra pessoa.
 * @param idAtual o colaborador sendo editado, ou `null` no cadastro novo.
 *   É o que permite salvar alguém sem que o próprio acesso dele conte como
 *   "já usado".
 */
export function validarColaborador(
  corpo: Record<string, unknown>,
  perfis: readonly Perfil[],
  colaboradores: readonly Colaborador[],
  idAtual: string | null
): ResultadoDeColaborador {
  const nome = texto(corpo.nome);
  if (!nome) return { ok: false, erro: "Informe o nome do colaborador." };

  const vinculo = daLista(corpo.vinculo, VINCULOS) ?? "Seteg";

  const perfilId = uuidOpcional(corpo.perfil_id);
  if (perfilId === false) return { ok: false, erro: "Acesso do sistema inválido." };

  if (perfilId) {
    if (!perfis.some((p) => p.id === perfilId)) {
      return { ok: false, erro: "O acesso escolhido não é um acesso ativo do sistema." };
    }
    const jaUsado = colaboradores.find((c) => c.perfil_id === perfilId && c.id !== idAtual);
    if (jaUsado) {
      return {
        ok: false,
        erro: `Este acesso do sistema já é de ${jaUsado.nome}. Um acesso é de uma pessoa só.`,
      };
    }
  }

  // ── O CARGO É LISTA FECHADA, COM UMA EXCEÇÃO ──
  //
  // O organograma nasceu com os cargos que vinham de `perfis` ("Colaborador",
  // "Assistente de Compras", "Financeiro"…), e nenhum deles está em
  // `CARGOS`. Recusar esses valores aqui impediria a Direção de mudar a
  // SITUAÇÃO de uma dessas pessoas sem trocar o cargo dela no mesmo
  // movimento — e trocar calado seria pior. Então o cargo que a linha JÁ
  // TEM é aceito de volta; qualquer outro fora da lista, não.
  const atual = colaboradores.find((c) => c.id === idAtual);
  const cargoBruto = textoOpcional(corpo.cargo);
  if (cargoBruto === false) return { ok: false, erro: "Cargo acima do tamanho permitido." };

  let cargo: string | null = null;
  if (cargoBruto) {
    if (daLista(cargoBruto, CARGOS)) {
      cargo = cargoBruto;
    } else if (atual && atual.cargo === cargoBruto) {
      cargo = cargoBruto;
    } else {
      return { ok: false, erro: `Cargo inválido. Use ${CARGOS.join(", ")}.` };
    }
  }

  const opcionais = {
    codigo: textoOpcional(corpo.codigo, MAX_CODIGO),
    setor: textoOpcional(corpo.setor),
    telefone: textoOpcional(corpo.telefone, MAX_TELEFONE),
    email: textoOpcional(corpo.email),
    observacao: textoOpcional(corpo.observacao, TEXTO_LONGO),
  };
  for (const [campo, valor] of Object.entries(opcionais)) {
    if (valor === false) return { ok: false, erro: `Campo ${campo} acima do tamanho permitido.` };
  }

  return {
    ok: true,
    dados: {
      nome: maiusculas(nome),
      codigo: opcionais.codigo || null,
      // O cargo NÃO vai para caixa alta, ao contrário do nome e do setor:
      // ele vem de uma lista fechada, então já chega numa grafia só — e
      // "ANALISTA AMBIENTAL III" gritaria numa coluna de tabela.
      cargo,
      setor: opcionais.setor ? maiusculas(opcionais.setor) : null,
      telefone: opcionais.telefone || null,
      // E-mail NÃO vai para caixa alta: endereço é literal.
      email: opcionais.email || null,
      vinculo,
      perfil_id: perfilId,
      // Ausente = ativo. Cadastro novo nasce valendo.
      ativo: corpo.ativo !== false,
      observacao: opcionais.observacao || null,
      // `criado_por` e `atualizado_em` NÃO são enviados: são do banco, por
      // trigger (`colaboradores_antes_de_gravar`). Mandá-los daqui faria a
      // autoria depender de o cliente se comportar.
    },
  };
}
