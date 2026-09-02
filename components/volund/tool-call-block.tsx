"use client";

import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  Loader2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Uma chamada de ferramenta, do jeito que o VolundOS a mostra.
 *
 * ## O que mudou, e por quê
 *
 * Antes daqui a chamada aparecia como uma linha de lista em monoespaçada: um
 * ícone de estado, um de chave inglesa e o nome cru. Dizia que ALGO aconteceu e
 * mais nada — e o pior é que a informação existia: os eventos `tool_call` e
 * `tool_result` trazem o que a ferramenta recebeu (`input`) e o que ela
 * devolveu (`output`), e o chat descartava os dois.
 *
 * Agora é uma pílula que expande, no espírito do `ActionBlock` do produto
 * (`components/agents/chat-primitives.tsx` no VolundOS): fechada ela ocupa uma
 * linha e não compete com a resposta; aberta mostra a entrada e a saída. Quem só
 * conversa não abre; quem precisa entender o que o assistente fez, abre.
 *
 * ## O nome, e a regra de escrita
 *
 * O `DESIGN.md` proíbe jargão na interface, e um nome de ferramenta é técnico
 * por natureza. A saída é que a PÍLULA mostra o nome legível — `listar_recados`
 * vira "listar recados" —, e o nome cru fica dentro do detalhe, junto dos dados,
 * onde ele é a informação certa para quem foi olhar.
 *
 * ## A borda à esquerda carrega o estado
 *
 * É o que o produto faz, e economiza um selo: crimson enquanto roda, neutra
 * quando termina, vermelha quando a ferramenta falhou. O acento aparece só
 * enquanto algo está acontecendo — passado o momento, ele volta a estar
 * disponível para o que importa.
 */

export type EstadoDaFerramenta = "rodando" | "ok" | "erro";

export interface ChamadaDeFerramenta {
  id: string;
  nome: string;
  estado: EstadoDaFerramenta;
  /** O que a ferramenta recebeu. `undefined` até o evento chegar. */
  entrada?: unknown;
  /** O que ela devolveu. `undefined` enquanto roda. */
  saida?: unknown;
}

/** `listar_recados` → `listar recados`. O nome cru fica no detalhe. */
function nomeLegivel(nome: string): string {
  return nome.replace(/[_.]+/g, " ").trim();
}

/**
 * Texto de um payload que veio como `unknown`.
 *
 * String passa como está — a plataforma já desembrulha o texto das ferramentas,
 * e um `JSON.stringify` por cima devolveria a frase entre aspas com as quebras
 * de linha escapadas. O resto vira JSON indentado.
 */
function comoTexto(valor: unknown): string | null {
  if (valor == null) return null;
  if (typeof valor === "string") return valor;
  try {
    return JSON.stringify(valor, null, 2);
  } catch {
    // Referência circular: o payload existe, mas não dá para serializar. Dizer
    // isso é melhor que não mostrar seção nenhuma e parecer que veio vazio.
    return "(não foi possível mostrar este conteúdo)";
  }
}

function BotaoCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1600);
        } catch {
          // Sem permissão de área de transferência. Silenciar é melhor que um
          // erro sobre algo que a pessoa pode resolver selecionando o texto.
        }
      }}
      aria-label={copiado ? "Copiado" : "Copiar"}
      className={cn(
        "text-muted-foreground hover:text-foreground rounded-[6px] p-1 transition-colors",
        "focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
      )}
    >
      {copiado ? (
        <CheckIcon className="size-3" aria-hidden />
      ) : (
        <CopyIcon className="size-3" aria-hidden />
      )}
    </button>
  );
}

function Secao({ rotulo, texto }: { rotulo: string; texto: string }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1">
        <span className="text-muted-foreground text-[10px] font-semibold tracking-[0.1em] uppercase">
          {rotulo}
        </span>
        <BotaoCopiar texto={texto} />
      </div>
      <pre className="max-h-40 overflow-auto px-3 pb-2.5 font-mono text-[11px] leading-[1.6] break-words whitespace-pre-wrap">
        {texto}
      </pre>
    </div>
  );
}

export function ToolCallBlock({ chamada }: { chamada: ChamadaDeFerramenta }) {
  const [aberto, setAberto] = useState(false);

  const rodando = chamada.estado === "rodando";
  const falhou = chamada.estado === "erro";

  const entrada = comoTexto(chamada.entrada);
  const saida = comoTexto(chamada.saida);
  const temDetalhe = entrada !== null || saida !== null;

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        // Enquanto roda não há o que abrir, e um botão que não faz nada é pior
        // que um rótulo: `disabled` diz isso sem precisar de explicação.
        disabled={!temDetalhe}
        aria-expanded={temDetalhe ? aberto : undefined}
        onClick={() => setAberto((v) => !v)}
        className={cn(
          "flex w-fit items-center gap-2 rounded-r-[8px] border-l-2 py-1 pr-2 pl-2.5 transition-colors",
          "focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
          temDetalhe ? "hover:bg-surface-interactive-hover" : "cursor-default",
          rodando
            ? "border-l-primary/65 bg-primary/[0.06]"
            : falhou
              ? "border-l-destructive/60 bg-destructive/[0.06]"
              : "border-l-border-strong bg-surface-interactive",
        )}
      >
        {rodando ? (
          <Loader2Icon className="text-primary size-3 animate-spin" aria-hidden />
        ) : falhou ? (
          <XIcon className="text-destructive size-3" aria-hidden />
        ) : (
          <CheckIcon className="text-muted-foreground size-3" aria-hidden />
        )}
        <WrenchIcon
          className={cn(
            "size-3",
            rodando ? "text-primary/70" : "text-muted-foreground",
          )}
          aria-hidden
        />
        <span
          className={cn(
            "text-[11.5px] font-medium",
            rodando
              ? "text-primary"
              : falhou
                ? "text-destructive"
                : "text-foreground/75",
          )}
        >
          {nomeLegivel(chamada.nome)}
        </span>
        {temDetalhe ? (
          aberto ? (
            <ChevronUpIcon className="text-muted-foreground size-3" aria-hidden />
          ) : (
            <ChevronDownIcon className="text-muted-foreground size-3" aria-hidden />
          )
        ) : null}
      </button>

      {aberto && temDetalhe ? (
        <div className="border-border-subtle bg-surface-elevated divide-border-subtle divide-y overflow-hidden rounded-[10px] border">
          <div className="flex items-center gap-2 px-3 py-2">
            {/* Aqui o nome CRU: quem abriu quer saber exatamente o que foi
                chamado, e é este o texto que serve para procurar no código. */}
            <span className="text-muted-foreground font-mono text-[10.5px]">
              {chamada.nome}
            </span>
          </div>
          {entrada !== null ? <Secao rotulo="Recebeu" texto={entrada} /> : null}
          {saida !== null ? <Secao rotulo="Devolveu" texto={saida} /> : null}
        </div>
      ) : null}
    </div>
  );
}
