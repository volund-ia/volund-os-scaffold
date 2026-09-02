"use client";

import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * A resposta do agente, em Markdown.
 *
 * ## Por que isto existe
 *
 * O agente escreve em Markdown — lista, tabela, título, bloco de código. Antes
 * daqui a mensagem saía como texto puro, então a pessoa lia os asteriscos, os
 * pipes da tabela e as cercas do código no meio da frase. Não era uma questão de
 * enfeite: uma resposta com passos numerados chegava como um parágrafo só.
 *
 * ## Duas extensões, e o motivo de cada uma
 *
 * - `remark-gfm`: tabela, lista de tarefa, tachado e link automático. É o
 *   dialeto que o agente de fato escreve.
 * - `remark-breaks`: uma quebra de linha simples vira `<br>`. No Markdown
 *   original ela é ignorada, e o agente quebra linha esperando que ela apareça —
 *   sem isto, duas frases que ele separou chegam coladas.
 *
 * ## O estilo vem dos tokens, não de literais
 *
 * A receita é a mesma do produto (`components/ui/prose.ts` no VolundOS), com
 * duas diferenças deliberadas:
 *
 * 1. **Sem `@tailwindcss/typography`.** O produto usa os variantes `prose-*`,
 *    que exigem o plugin. Aqui cada elemento é mapeado à mão, porque o plugin
 *    entraria no `package.json` de TODO App criado a partir deste scaffold — e
 *    ele existiria para estilizar uma superfície só.
 * 2. **Cor por token.** O produto escreve `bg-white/[0.05]`; aqui vale
 *    `bg-surface-interactive` e amigos. O `DESIGN.md` pede token em vez de
 *    literal, e é o que mantém um App parecido com o próximo.
 *
 * O que NÃO muda é o raciocínio, que é o que importa portar:
 *
 * - **Código inline não é coral.** O acento é reservado para uma coisa por vez.
 *   Uma resposta de agente tem dez ou mais trechos entre acento grave; dez
 *   acentos intensos é nenhum acento. O que distingue código de texto aqui é
 *   véu e forma — fundo, raio, respiro e monoespaçada —, com a cor herdada.
 * - **O bloco de código desfaz o véu do inline.** A superfície é do bloco, não
 *   de cada pedaço dele; sem isso sai véu sobre véu.
 * - **O link é o único coral**, porque ali ele quer dizer "clicável".
 */

/** A monoespaçada só aqui: código é a exceção que a regra do DESIGN.md abre. */
const MONO = "font-mono";

export function AgentMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 text-[15px] leading-[1.65] wrap-anywhere",
        // Espaço entre blocos irmãos, sem sobra no primeiro e no último: a
        // bolha já paga o respiro dela, e margem aqui somaria duas vezes.
        "[&>*+*]:mt-3 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
    >
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          p: ({ children }) => <p className="my-0">{children}</p>,

          // Um título dentro de uma mensagem de chat não é um título de página:
          // ele separa assunto numa bolha. Por isso a escala é curta e a
          // diferença entre os níveis é de peso, não de corpo.
          h1: ({ children }) => (
            <h3 className="text-[16px] font-semibold tracking-[-0.01em]">{children}</h3>
          ),
          h2: ({ children }) => (
            <h4 className="text-[15px] font-semibold tracking-[-0.01em]">{children}</h4>
          ),
          h3: ({ children }) => <h5 className="text-[15px] font-medium">{children}</h5>,
          h4: ({ children }) => <h6 className="text-[14px] font-medium">{children}</h6>,

          ul: ({ children }) => (
            <ul className="my-0 list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-0 list-decimal space-y-1 pl-5">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{children}</li>,

          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),

          a: ({ children, href }) => (
            <a
              href={href}
              // Conteúdo gerado por agente: o destino não é nosso, e uma aba
              // nova evita que a pessoa perca a conversa no meio.
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary decoration-primary/40 hover:decoration-primary underline underline-offset-2"
            >
              {children}
            </a>
          ),

          blockquote: ({ children }) => (
            <blockquote className="border-border-strong text-muted-foreground border-l-2 pl-3">
              {children}
            </blockquote>
          ),

          hr: () => <hr className="border-border-subtle" />,

          // `pre` é a superfície; o `code` de dentro herda e desfaz o próprio
          // véu (a regra abaixo em `code` só se aplica quando ele está solto).
          pre: ({ children }) => (
            <pre
              // Rolador alcançável pelo teclado. Um `overflow-x-auto` não recebe
              // foco por si: quem navega sem mouse não consegue rolar, e o
              // trecho que passa da largura fica inacessível. `tabIndex` põe a
              // região na ordem de tabulação; o rótulo diz o que ela é quando o
              // foco chega nela. Apontado na revisão.
              tabIndex={0}
              role="region"
              aria-label="Bloco de código"
              className={cn(
                "bg-surface-interactive border-border-subtle overflow-x-auto rounded-[10px] border p-3",
                "text-[12px] leading-[1.6]",
                "focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
                MONO,
                "[&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[12px] [&_code]:text-inherit",
              )}
            >
              {children}
            </pre>
          ),

          code: ({ children }) => (
            <code
              className={cn(
                "bg-surface-interactive rounded-[5px] px-1.5 py-px text-[12.5px] font-normal",
                // Herdada de propósito: o texto ao redor manda na cor, e é o
                // véu que diz "isto é código".
                "text-inherit",
                MONO,
              )}
            >
              {children}
            </code>
          ),

          // Tabela larga não pode empurrar a bolha: o rolador é dela — e ele
          // precisa receber foco pelo mesmo motivo do `pre` acima.
          table: ({ children }) => (
            <div
              tabIndex={0}
              role="region"
              aria-label="Tabela"
              className={cn(
                "border-border-subtle overflow-x-auto rounded-[10px] border",
                "focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
              )}
            >
              <table className="w-full border-collapse text-[13px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-surface-interactive">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border-border-subtle border-b px-3 py-2 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-border-subtle border-b px-3 py-2 align-top last:border-b-0">
              {children}
            </td>
          ),

          // Imagem de conteúdo cabe na bolha e nunca vaza a largura.
          // O endereço vem do agente e é arbitrário. `next/image` exigiria o
          // domínio declarado em `next.config.ts`, e um App não sabe de antemão
          // de onde a imagem vai vir — declarar `**` ali seria pior.
          img: ({ src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={typeof src === "string" ? src : undefined}
              alt={alt ?? ""}
              className="border-border-subtle max-w-full rounded-[10px] border"
            />
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
