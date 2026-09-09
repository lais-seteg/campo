// ═══════════════════════════════════════════════════════════════════════
//  FORMATAÇÃO E CONVERSÃO — funções puras, sem DOM.
//
//  A versão anterior misturava formatar valor com mexer no `<input>`
//  (`mascaraMoedaEl(el)` lia e escrevia `el.value`). Aqui a formatação é
//  pura e as máscaras são componentes controlados — ver
//  app/components/CampoMascarado.tsx. Separar é o que permite usar as
//  mesmas funções no servidor, na exportação CSV e na validação.
//
//  Não existe `esc()` neste arquivo, e a ausência é o ponto: o React
//  escapa texto por construção. A função existia porque a tela montava
//  HTML com template string, e cada esquecimento dela era um XSS.
// ═══════════════════════════════════════════════════════════════════════

/** "Edição" → "edicao". Serve para virar nome de classe CSS: trocar letra
 *  por letra deixaria o "ç" e o "ã" para trás e a classe não casaria. */
export function semAcento(texto: string | null | undefined): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function formatarData(data: string | Date | null | undefined): string {
  if (!data) return "—";
  const d = typeof data === "string" ? new Date(data) : data;
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export function formatarDataHora(data: string | Date | null | undefined): string {
  if (!data) return "—";
  const d = typeof data === "string" ? new Date(data) : data;
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

export function formatarMoeda(valor: number | string | null | undefined): string {
  return (Number(valor) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Número no formato que a máscara de moeda espera de volta ("1.234,56").
 *  Caminho inverso de `parseMoeda` — existe para carregar um valor do banco
 *  num campo mascarado sem ele virar "1234.56". */
export function formatarNumeroBR(valor: number | string | null | undefined): string {
  const n = Number(valor);
  if (!Number.isFinite(n) || n === 0) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "1.234,56" (o que a máscara escreve) → 1234.56 */
export function parseMoeda(texto: string | null | undefined): number {
  return parseFloat(String(texto ?? "0").replace(/\./g, "").replace(",", ".")) || 0;
}

/** "31/12/2026" → "2026-12-31". String vazia para qualquer coisa que não
 *  seja exatamente esse formato — o banco recebe ISO ou não recebe nada. */
export function dataBRparaISO(v: string | null | undefined): string {
  if (!v) return "";
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v));
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** "2026-12-31" (ou o timestamp inteiro) → "31/12/2026". */
export function dataISOparaBR(v: string | null | undefined): string {
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * "2026-12-31" → "31/12". Sem o ano, para caber DENTRO de uma célula que já
 * tem outras coisas — a hospedagem numa linha de tabela mostra cidade, hotel
 * e período, e "31/12/2026 a 05/01/2027" sozinho ocuparia a coluna inteira.
 *
 * Só onde o ano já está dito por perto (a coluna Período do mesmo pedido, o
 * cabeçalho da tela). Data solta nunca perde o ano: um campo que atravessa o
 * réveillon vira "31/12 a 05/01" e some a informação de que mudou de ano.
 */
export function dataCurtaBR(v: string | null | undefined): string {
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (!m) return "";
  return `${m[3]}/${m[2]}`;
}

// ─── Máscaras (puras: texto entra, texto sai) ────────────────────────────

export function mascararData(valor: string): string {
  return valor
    .replace(/\D/g, "")
    .slice(0, 8)
    .replace(/(\d{2})(\d)/, "$1/$2")
    .replace(/(\d{2})(\d)/, "$1/$2");
}

export function mascararHora(valor: string): string {
  return valor.replace(/\D/g, "").slice(0, 4).replace(/(\d{2})(\d)/, "$1:$2");
}

export function mascararCpf(valor: string): string {
  return valor
    .replace(/\D/g, "")
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1-$2");
}

/**
 * Telefone brasileiro, com DDD: `(85) 3333-4444` ou `(85) 98888-7777`.
 *
 * ── ONZE DÍGITOS, E NÃO UM A MAIS ──
 *
 * O `.slice(0, 11)` é o ponto: 2 do DDD + 9 do número é o máximo que existe
 * no país. Sem ele o campo aceitava telefone com quinze dígitos — e um
 * número que ninguém consegue discar é pior do que um campo vazio, porque
 * parece preenchido. Quem digita a mais simplesmente não vê o dígito
 * entrar, que é o mesmo comportamento do CPF e da data aqui do lado.
 *
 * O nono dígito decide a formatação: com 11, o bloco da frente tem cinco
 * casas (celular); com 10, quatro (fixo). É por isso que a máscara olha o
 * comprimento em vez de aplicar um `replace` fixo como a do CPF.
 */
export function mascararTelefone(valor: string): string {
  const d = valor.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  const ddd = `(${d.slice(0, 2)}) `;
  const resto = d.slice(2);
  if (resto.length <= 4) return ddd + resto;
  const corte = resto.length > 8 ? 5 : 4;
  return `${ddd}${resto.slice(0, corte)}-${resto.slice(corte)}`;
}

export function mascararMoeda(valor: string): string {
  const limpo = valor.replace(/[^\d,]/g, "");
  const partes = limpo.split(",");
  const inteiro = (partes[0] ?? "")
    .replace(/^0+(?=\d)/, "")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const decimal = partes.length > 1 ? `,${(partes[1] ?? "").slice(0, 2)}` : "";
  return inteiro + decimal;
}

// ─── Datas como dia, não como instante ───────────────────────────────────
//
// O período de um campo é um intervalo de DIAS. Comparar timestamps com
// fuso faria "2026-08-28" no Brasil virar 27 ou 29 dependendo da hora —
// por isso tudo aqui é ancorado em meia-noite UTC.

/** "2026-08-28" (ou o timestamp inteiro) → Date na meia-noite UTC daquele
 *  dia. `null` para entrada vazia ou fora do formato. */
export function soData(v: string | null | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Data de hoje em "YYYY-MM-DD", pelo calendário local de quem está olhando. */
export function hojeISO(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

/** Dias de campo, contando as duas pontas: sair e voltar no mesmo dia é
 *  um dia de campo, não zero. */
export function diasDeCampo(inicio: string | null | undefined, fim: string | null | undefined): number {
  const a = soData(inicio);
  const b = soData(fim);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
}

/**
 * NOITES de hotel, que é outra conta — e é justamente por ser outra que ela
 * mora aqui e não vira um parâmetro de `diasDeCampo`.
 *
 * Campo conta as duas pontas: sair e voltar no mesmo dia é UM dia de campo.
 * Hotel conta as noites: entrar e sair no mesmo dia é ZERO diária, porque
 * ninguém dormiu. É a conta que a casa faz, e confundir as duas gera fatura
 * com um dia a mais em toda hospedagem.
 *
 * A mesma função serve o formulário e o ajuste em campo. Duas cópias desta
 * subtração é onde uma delas ganha o `+ 1` por descuido.
 */
export function noitesDeHospedagem(
  entrada: string | null | undefined,
  saida: string | null | undefined
): number {
  const a = soData(entrada);
  const b = soData(saida);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

export function mesmoDia(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return a.getTime() === b.getTime();
}

// ─── CSV ─────────────────────────────────────────────────────────────────

export function csvEscape(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

/** Formato que o Excel brasileiro entende como NÚMERO, e não como texto:
 *  vírgula decimal, sem separador de milhar. */
export function csvNumero(v: unknown): string {
  return (Number(v) || 0).toFixed(2).replace(".", ",");
}

/**
 * Monta o texto do CSV. O `﻿` na frente (BOM) é o que faz o Excel
 * abrir a acentuação certa; ponto e vírgula como separador é o que ele
 * espera na configuração brasileira.
 */
export function montarCsv(cabecalho: readonly string[], linhas: readonly (readonly unknown[])[]): string {
  const texto = [
    cabecalho.map(csvEscape).join(";"),
    ...linhas.map((l) => l.map(csvEscape).join(";")),
  ].join("\r\n");
  return `﻿${texto}`;
}

/** Nome do arquivo com a data do dia, como na versão anterior. */
export function nomeDeArquivoCsv(base: string): string {
  return `${base}-${new Date().toISOString().slice(0, 10)}.csv`;
}
