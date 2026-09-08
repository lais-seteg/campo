"use client";

// ═══════════════════════════════════════════════════════════════════════
//  COMO O CLIENTE FALA COM O SERVIDOR
//
//  Um lugar só. A versão anterior tinha `await sb.from(...)` espalhado por
//  trinta pontos do script.js, cada um decidindo à sua maneira o que fazer
//  com o erro — e alguns não decidindo nada.
//
//  Duas regras aqui:
//
//   1. A MENSAGEM VEM PRONTA DO SERVIDOR. O cliente nunca monta frase a
//      partir de código de erro do Postgres; quem traduz é lib/erros.ts,
//      no servidor (ver o `{ error }` de toda rota).
//   2. Falha de rede é a única frase que o cliente escreve sozinho — é o
//      único erro que o servidor, por definição, não teve como responder.
// ═══════════════════════════════════════════════════════════════════════

export class ErroDaApi extends Error {
  readonly status: number;
  /** Corpo da resposta, para quem precisa de mais do que a mensagem (o
   *  `precisaConfirmar` da exclusão de hotel e projeto, por exemplo). */
  readonly corpo: Record<string, unknown>;

  constructor(mensagem: string, status: number, corpo: Record<string, unknown>) {
    super(mensagem);
    this.name = "ErroDaApi";
    this.status = status;
    this.corpo = corpo;
  }
}

async function chamar<T>(caminho: string, opcoes: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, opcoes);
  } catch {
    throw new ErroDaApi("Sem conexão com o servidor. Verifique a internet e tente de novo.", 0, {});
  }

  const corpo = await lerCorpo(resposta);

  if (!resposta.ok) {
    const mensagem =
      typeof corpo.error === "string" ? corpo.error : "Não foi possível concluir a operação.";
    throw new ErroDaApi(mensagem, resposta.status, corpo);
  }

  return corpo as T;
}

async function lerCorpo(resposta: Response): Promise<Record<string, unknown>> {
  try {
    const corpo: unknown = await resposta.json();
    return typeof corpo === "object" && corpo !== null ? (corpo as Record<string, unknown>) : {};
  } catch {
    // 204, HTML de erro do proxy, resposta truncada. Nada a extrair.
    return {};
  }
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function get<T>(caminho: string): Promise<T> {
  return chamar<T>(caminho, { method: "GET" });
}

export function post<T>(caminho: string, corpo: unknown): Promise<T> {
  return chamar<T>(caminho, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(corpo) });
}

export function patch<T>(caminho: string, corpo: unknown): Promise<T> {
  return chamar<T>(caminho, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(corpo) });
}

export function remover<T>(caminho: string): Promise<T> {
  return chamar<T>(caminho, { method: "DELETE" });
}

/** A frase que a tela mostra, venha o erro de onde vier. */
export function mensagemDoErro(erro: unknown, acao: string): string {
  if (erro instanceof ErroDaApi) return erro.message;
  return `Não foi possível ${acao}.`;
}
