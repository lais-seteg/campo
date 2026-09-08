// O calendário de campo: equipe × projeto × data.
//
// Mesmo desenho do calendário de manutenção do Controle de Estoque, de
// propósito: é a mesma leitura.

import { exigirSessao } from "@/lib/sessao";
import { carregarDados } from "@/lib/dados";
import { CalendarioDeCampo } from "@/app/(sistema)/calendario/CalendarioDeCampo";

export const dynamic = "force-dynamic";

export default async function PaginaDeCalendario() {
  const usuario = await exigirSessao();
  const dados = await carregarDados(usuario.accessToken);

  return (
    <CalendarioDeCampo
      solicitacoes={dados.solicitacoes}
      projetos={dados.projetos}
      v2Ativa={dados.estrutura.v2}
    />
  );
}
