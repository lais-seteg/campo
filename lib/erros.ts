// ═══════════════════════════════════════════════════════════════════════
//  TRADUÇÃO DE ERRO DO BANCO PARA FRASE DE GENTE
//
//  Erro de restrição do Postgres tem mensagem para programador. Esta é a
//  camada que a converte — e ela mora no SERVIDOR, não mais no navegador:
//  o cliente recebe `{ error: "..." }` já pronto e nunca vê código de erro,
//  nome de constraint ou detalhe de schema.
//
//  Uma exceção deliberada, herdada da versão anterior: o P0001 (o
//  `raise exception` das nossas funções de reserva, entrega, devolução e
//  acréscimo) passa INTEIRO. Essas mensagens foram escritas para serem
//  lidas por quem está usando o sistema — "Material indisponível nas datas
//  do campo: medidor X, pedido 3, disponível 1" resolve o problema de
//  quem leu, e trocá-la por "não foi possível concluir a operação" não
//  resolve nada.
// ═══════════════════════════════════════════════════════════════════════

/** O formato de erro do PostgREST/supabase-js. */
export interface ErroPostgrest {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

function textoDoErro(erro: unknown): string {
  if (!erro) return "";
  if (typeof erro === "string") return erro;
  if (erro instanceof Error) return erro.message;
  const e = erro as ErroPostgrest;
  return String(e.message ?? e.details ?? e.hint ?? "");
}

function codigoDoErro(erro: unknown): string {
  if (!erro || typeof erro !== "object") return "";
  return String((erro as ErroPostgrest).code ?? "");
}

/**
 * 42P01 = "relation does not exist". É o que o banco responde enquanto um
 * dos arquivos de schema não foi rodado. Vale um aviso claro, não um erro
 * genérico que faria alguém procurar problema na internet.
 */
export function tabelaNaoExiste(erro: unknown): boolean {
  return codigoDoErro(erro) === "42P01" || /does not exist/i.test(textoDoErro(erro));
}

/**
 * 42703 = "column does not exist". Uma coluna nova (supabase/17, por
 * exemplo) chega ao banco e ao código em momentos diferentes: durante a
 * janela do deploy o servidor novo fala com o banco velho, ou o contrário.
 * Quem precisa distinguir isso pede a coluna e trata este código.
 *
 * ATENÇÃO À ORDEM: `tabelaNaoExiste()` acima cai no `/does not exist/`
 * genérico e também dá `true` para erro de coluna. Quem quiser separar os
 * dois tem de perguntar por esta função PRIMEIRO.
 */
export function colunaNaoExiste(erro: unknown): boolean {
  return codigoDoErro(erro) === "42703" || /column .* does not exist/i.test(textoDoErro(erro));
}

/** Restrições que a tela pode encostar, com a frase que explica o que
 *  fazer. A ordem importa pouco; a especificidade, muito. */
const TRADUCOES: readonly { padrao: RegExp; mensagem: string }[] = [
  { padrao: /solicitacoes_cancelamento_check/, mensagem: "Cancelar exige o motivo." },
  { padrao: /solicitacoes_recusa_check/, mensagem: "Recusar exige o motivo." },
  { padrao: /solicitacao_avarias_custo_check/, mensagem: "Avaria resolvida ou cobrada exige o custo real." },
  { padrao: /solicitacoes_locadora_outra_check/, mensagem: 'Locadora "Outros" exige dizer qual é.' },
  { padrao: /solicitacoes_periodo_check/, mensagem: "O fim do período não pode ser antes do início." },
  { padrao: /solicitacoes_conferencia_check/, mensagem: "Registre a entrega antes da devolução." },
  { padrao: /solicitacoes_veiculo_check/, mensagem: "Veículo marcado exige informar o condutor." },
  { padrao: /solicitacao_hospedagens_periodo_check/, mensagem: "A saída não pode ser antes da entrada." },
  { padrao: /solicitacao_equipe_unica/, mensagem: "A mesma pessoa aparece duas vezes na equipe." },
  { padrao: /solicitacao_equipe_um_lider/, mensagem: "Só uma pessoa pode ser líder da equipe." },
  { padrao: /solicitacao_sst_epi_unico/, mensagem: "O mesmo EPI aparece duas vezes na lista." },
  { padrao: /solicitacao_assinaturas_unica/, mensagem: "Esta assinatura já foi registrada." },
  { padrao: /hoteis_unico/, mensagem: "Já existe um hotel com este nome neste município." },
  { padrao: /projetos_unico/, mensagem: "Já existe este projeto para este cliente." },
  {
    padrao: /colaboradores_nome_unico/,
    mensagem:
      "Já existe um colaborador com este nome. Se são duas pessoas diferentes, informe a matrícula de uma delas para distingui-las.",
  },
  { padrao: /colaboradores_codigo_unico/, mensagem: "Esta matrícula já está em uso por outro colaborador." },
  { padrao: /colaboradores_perfil_id_key/, mensagem: "Este acesso do sistema já está ligado a outro colaborador." },
  {
    padrao: /check constraint "itens_manutencao_check"/,
    mensagem: "Abrir manutenção do bem exige o fornecedor do reparo.",
  },
];

/**
 * @param acao verbo no infinitivo, para a frase genérica de último caso:
 *   `mensagemDeErro(e, "salvar a solicitação")` → "Não foi possível salvar
 *   a solicitação."
 */
export function mensagemDeErro(erro: unknown, acao?: string): string {
  const texto = textoDoErro(erro);
  const codigo = codigoDoErro(erro);

  if (tabelaNaoExiste(erro)) {
    return "As tabelas de solicitação ainda não existem no banco (ver supabase/01_solicitacoes.sql e 02_campo_v2.sql).";
  }

  // As mensagens das nossas funções passam inteiras — ver o cabeçalho.
  if (codigo === "P0001" && texto) return texto;

  const traducao = TRADUCOES.find((t) => t.padrao.test(texto));
  if (traducao) return traducao.mensagem;

  if (/duplicate key|already exists/i.test(texto)) return "Já existe um registro com esses dados.";
  if (codigo === "42501" || /permission denied|row-level security/i.test(texto)) {
    return "Você não tem permissão para isso.";
  }
  if (/Failed to fetch|NetworkError|fetch failed|ECONNREFUSED|ETIMEDOUT/i.test(texto)) {
    return "Sem conexão com o banco de dados. Verifique a internet e tente de novo.";
  }

  return `Não foi possível ${acao ?? "concluir a operação"}.`;
}

/**
 * Que status HTTP devolver. Erro de permissão é 403, restrição violada e
 * regra de negócio das funções são 400 (o cliente pode corrigir e tentar
 * de novo), e o resto é 500.
 *
 * P0001 como 400 e não 500 é uma escolha: são as regras do fluxo —
 * "material indisponível", "só o líder aprova", "registre a entrega antes
 * da devolução". Nenhuma delas é uma falha do servidor.
 */
export function statusDoErro(erro: unknown): number {
  const codigo = codigoDoErro(erro);
  const texto = textoDoErro(erro);
  if (codigo === "42501" || /permission denied|row-level security/i.test(texto)) return 403;
  if (codigo === "P0001") return 400;
  if (codigo.startsWith("23")) return 400; // 23xxx = violação de integridade
  if (tabelaNaoExiste(erro)) return 503;
  return 500;
}
