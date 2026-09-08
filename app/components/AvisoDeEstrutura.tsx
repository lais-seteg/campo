// ═══════════════════════════════════════════════════════════════════════
//  O AVISO DE SCHEMA PENDENTE
//
//  O sistema entra e continua navegável mesmo com o banco incompleto, e
//  DIZ o que está desligado em vez de fingir que funciona. Era assim na
//  versão anterior e continua sendo — só que o aviso agora aparece uma vez
//  no layout, e não repetido dentro de cada tela.
//
//  Dois níveis, porque a diferença importa:
//   · sem 01_solicitacoes.sql → não há onde gravar nada;
//   · sem 02_campo_v2.sql     → grava, mas sem reserva de material,
//     calendário e previsto × real;
//   · sem 05_ajustes_v3.sql   → grava, mas sem prazo e gasto previsto do
//     projeto (a tabela `projeto_gastos_previstos` é lida como as da v2).
// ═══════════════════════════════════════════════════════════════════════

import type { EstadoEstrutura } from "@/lib/tipos";

export function AvisoDeEstrutura({ estrutura }: { estrutura: EstadoEstrutura }) {
  if (estrutura.base && estrutura.v2) return null;

  if (!estrutura.base) {
    return (
      <div className="alerta-card alerta-critico" role="alert" style={{ marginBottom: "1rem", flexShrink: 0 }}>
        <div className="alerta-titulo">Estrutura do banco pendente</div>
        <div className="alerta-desc">
          As tabelas de solicitação ainda não existem neste projeto Supabase. A tela funciona, mas
          não há onde gravar.
        </div>
        <div className="alerta-meta">
          Rode <strong>supabase/01_solicitacoes.sql</strong> e depois{" "}
          <strong>supabase/02_campo_v2.sql</strong> e{" "}
          <strong>supabase/04_direcao_e_aprovacao.sql</strong> e{" "}
          <strong>supabase/05_ajustes_v3.sql</strong>, nessa ordem. Todos são idempotentes.
        </div>
      </div>
    );
  }

  return (
    <div className="alerta-card alerta-atencao" role="status" style={{ marginBottom: "1rem", flexShrink: 0 }}>
      <div className="alerta-titulo">Recursos da v2 desligados</div>
      <div className="alerta-desc">
        Dá para abrir e acompanhar solicitação, mas sem reserva de material, calendário de equipe e
        previsto × real.
      </div>
      <div className="alerta-meta">
        Rode <strong>supabase/02_campo_v2.sql</strong> e{" "}
        <strong>supabase/04_direcao_e_aprovacao.sql</strong> e{" "}
        <strong>supabase/05_ajustes_v3.sql</strong> para ligar.
      </div>
    </div>
  );
}
