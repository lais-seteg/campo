// A raiz não tem tela própria: manda cada papel para onde ele começa.
// A Direção cai no Painel (ela não abre nem acompanha pedido de campo);
// todo mundo cai em Solicitações. Ver `abaInicial` em lib/navegacao.ts.

import { redirect } from "next/navigation";
import { exigirSessao } from "@/lib/sessao";
import { abaInicial } from "@/lib/navegacao";

export const dynamic = "force-dynamic";

export default async function Raiz() {
  const usuario = await exigirSessao();
  redirect(abaInicial(usuario.papel));
}
