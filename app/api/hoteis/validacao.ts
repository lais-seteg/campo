// Validação do cadastro de hotéis e pousadas — compartilhada entre POST e
// PATCH, para o cadastro e a edição não divergirem no que aceitam.
//
// O cadastro existe para não procurar hotel de novo a cada viagem, e para
// o previsto da diária sair de um valor COMBINADO, não de estimativa de
// memória. Por isso `valor_diaria` é aceito zerado (nem toda casa tem
// valor fechado ainda) mas nunca negativo.

import { TIPOS_HOTEL, type TipoHotel } from "@/lib/tipos";
import { TEXTO_LONGO, booleano, daLista, dinheiro, maiusculas, texto, textoOpcional, uf } from "@/lib/validacao";

export interface CorpoDeHotel {
  nome: string;
  tipo: TipoHotel;
  municipio: string;
  uf: string;
  endereco: string | null;
  bairro: string | null;
  telefone: string | null;
  whatsapp: string | null;
  email: string | null;
  contato_nome: string | null;
  valor_diaria: number;
  cafe_incluso: boolean;
  estacionamento: boolean;
  aceita_faturamento: boolean;
  observacao: string | null;
  ativo: boolean;
}

export type ResultadoDeHotel = { ok: true; dados: CorpoDeHotel } | { ok: false; erro: string };

export function validarHotel(corpo: Record<string, unknown>): ResultadoDeHotel {
  const nome = texto(corpo.nome);
  if (!nome) return { ok: false, erro: "Informe o nome da casa." };

  const tipo = daLista(corpo.tipo, TIPOS_HOTEL) ?? "Hotel";

  const municipio = texto(corpo.municipio);
  if (!municipio) return { ok: false, erro: "Informe o município." };

  const estado = uf(corpo.uf);
  if (!estado) return { ok: false, erro: "Informe a UF com duas letras." };

  const valorDiaria = dinheiro(corpo.valor_diaria);
  if (valorDiaria === null) return { ok: false, erro: "Valor da diária inválido." };

  const opcionais = {
    endereco: textoOpcional(corpo.endereco, TEXTO_LONGO),
    bairro: textoOpcional(corpo.bairro),
    telefone: textoOpcional(corpo.telefone, 40),
    whatsapp: textoOpcional(corpo.whatsapp, 40),
    email: textoOpcional(corpo.email),
    contato_nome: textoOpcional(corpo.contato_nome),
    observacao: textoOpcional(corpo.observacao, TEXTO_LONGO),
  };
  for (const [campo, valor] of Object.entries(opcionais)) {
    if (valor === false) return { ok: false, erro: `Campo ${campo} acima do tamanho permitido.` };
  }

  return {
    ok: true,
    dados: {
      nome: maiusculas(nome),
      tipo,
      municipio: maiusculas(municipio),
      uf: estado,
      endereco: opcionais.endereco ? maiusculas(opcionais.endereco) : null,
      bairro: opcionais.bairro ? maiusculas(opcionais.bairro) : null,
      telefone: opcionais.telefone || null,
      whatsapp: opcionais.whatsapp || null,
      // E-mail NÃO vai para caixa alta: endereço é literal.
      email: opcionais.email || null,
      contato_nome: opcionais.contato_nome ? maiusculas(opcionais.contato_nome) : null,
      valor_diaria: valorDiaria,
      cafe_incluso: booleano(corpo.cafe_incluso),
      estacionamento: booleano(corpo.estacionamento),
      aceita_faturamento: booleano(corpo.aceita_faturamento),
      observacao: opcionais.observacao || null,
      // Ausente = ativo. Cadastro novo nasce valendo.
      ativo: corpo.ativo !== false,
    },
  };
}
