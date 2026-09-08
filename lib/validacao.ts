// ═══════════════════════════════════════════════════════════════════════
//  LEITORES DE CORPO DE REQUISIÇÃO
//
//  As primitivas que toda rota usa para transformar `unknown` em algo com
//  tipo. Não são "helpers genéricos" por gosto de abstrair: são o contrato
//  de que NENHUMA rota lê um campo do corpo sem passar por uma checagem de
//  tipo, tamanho e faixa.
//
//  A convenção é uma só e vale para todas:
//
//    · `null`  = ausente, e ausente é aceitável;
//    · `false` = presente mas INVÁLIDO (só nos leitores "opcional");
//    · valor   = presente e válido.
//
//  Sem essa distinção, um campo malformado viraria `null` silenciosamente
//  e seria gravado como "não informado" — o pior dos dois mundos, porque
//  ninguém fica sabendo.
// ═══════════════════════════════════════════════════════════════════════

/** Tetos padrão. Sem teto, um texto de 1 MB seria aceito e gravado. */
export const TEXTO_CURTO = 200;
export const TEXTO_LONGO = 2000;
export const MAX_LINHAS = 200;
/** O teto de `numeric(14,2)`. */
export const VALOR_MAX = 99_999_999.99;

export const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
export const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Texto obrigatório: `null` quando vazio, não-string ou acima do teto. */
export function texto(valor: unknown, max = TEXTO_CURTO): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  if (!limpo || limpo.length > max) return null;
  return limpo;
}

/** Texto que pode faltar. `false` distingue "veio errado" de "não veio". */
export function textoOpcional(valor: unknown, max = TEXTO_CURTO): string | null | false {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor !== "string") return false;
  const limpo = valor.trim();
  if (!limpo) return null;
  if (limpo.length > max) return false;
  return limpo;
}

/**
 * "YYYY-MM-DD" e nada mais.
 *
 * O round-trip pelo `Date` rejeita data impossível como 2026-02-31, que o
 * JavaScript "rolaria" para 03/03 e o banco aceitaria como um dia que
 * ninguém digitou.
 */
export function data(valor: unknown): string | null {
  if (typeof valor !== "string" || !RE_DATA.test(valor)) return null;
  const d = new Date(`${valor}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === valor ? valor : null;
}

export function dataOpcional(valor: unknown): string | null | false {
  if (valor === null || valor === undefined || valor === "") return null;
  return data(valor) ?? false;
}

export function horaOpcional(valor: unknown): string | null | false {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor !== "string" || !RE_HORA.test(valor)) return false;
  return valor;
}

export function uuid(valor: unknown): string | null {
  return typeof valor === "string" && RE_UUID.test(valor) ? valor : null;
}

export function uuidOpcional(valor: unknown): string | null | false {
  if (valor === null || valor === undefined || valor === "") return null;
  return uuid(valor) ?? false;
}

/** Dinheiro: finito, não negativo, dentro de numeric(14,2), arredondado a
 *  dois decimais. Ausente conta como zero — é o padrão das colunas. */
export function dinheiro(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return 0;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > VALOR_MAX) return null;
  return Math.round(n * 100) / 100;
}

/** Dinheiro que pode legitimamente ser "não informado" (custo real de uma
 *  avaria ainda em análise, por exemplo) — aí ausente é `null`, não zero. */
export function dinheiroOuNulo(valor: unknown): number | null | false {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > VALOR_MAX) return false;
  return Math.round(n * 100) / 100;
}

export function inteiroPositivo(valor: unknown, max = 100_000): number | null {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}

export function inteiroNaoNegativo(valor: unknown, max = 100_000): number | null {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0 || n > max) return null;
  return n;
}

/** Só `true` é `true`. "false", 0 e "" não viram booleano por acidente. */
export function booleano(valor: unknown): boolean {
  return valor === true;
}

/** Valor que tem de estar numa lista fechada — o espelho de um
 *  `check (... in (...))` do banco. */
export function daLista<T extends string>(valor: unknown, lista: readonly T[]): T | null {
  return typeof valor === "string" && (lista as readonly string[]).includes(valor) ? (valor as T) : null;
}

export function lista(valor: unknown, max = MAX_LINHAS): unknown[] | null {
  if (!Array.isArray(valor)) return null;
  return valor.length > max ? null : valor;
}

/**
 * Cliente, destino, nomes e placas são gravados em CAIXA ALTA para a busca
 * e a exportação não dependerem de como cada um digitou. É o `maiusc()` da
 * versão anterior.
 *
 * E-mail é a exceção deliberada: endereço é literal e não se normaliza.
 */
export function maiusculas(valor: string): string {
  return valor.toUpperCase();
}

/** UF em duas letras — o mesmo `check (uf ~ '^[A-Z]{2}$')` do banco. */
export function uf(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(limpo) ? limpo : null;
}

/** Lê o corpo JSON, ou `null` se não for JSON válido. */
export async function corpoJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const corpo: unknown = await request.json();
    if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) return null;
    return corpo as Record<string, unknown>;
  } catch {
    return null;
  }
}
