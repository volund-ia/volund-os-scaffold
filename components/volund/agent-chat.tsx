"use client";

import type { VolundEvent } from "@volund-ia/sdk";
import {
  AlertTriangleIcon,
  CheckIcon,
  Loader2Icon,
  SendIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { MonoLabel } from "@/components/ui/mono-label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AppAgent } from "@/lib/volund/agents";
import { AgentPicker } from "./agent-picker";

/**
 * A conversa com um agente do App.
 *
 * ## O que ele fala, e com quem
 *
 * Só com as rotas de `app/api/volund/` — nunca com a plataforma direto. A
 * credencial que a plataforma aceita fica no servidor, e é isso que separa este
 * chat de um que guardasse uma chave no navegador. Do lado de cá viajam o texto
 * da pessoa e o apelido do agente; nada mais.
 *
 * ## As três pausas
 *
 * Um agente não só responde: ele pode parar no meio e precisar de alguém.
 *
 * - **Pergunta** (`question_asked`): ele abriu um card com opções e está
 *   esperando. O turno CONTINUA quando a resposta chega — por isso o stream não
 *   fecha e a pessoa responde sem perder o fio.
 * - **Aprovação** (`awaiting_input` com `kind: "approval"`): ele quer usar uma
 *   ferramenta que alguém precisa liberar. Aqui o stream FECHA; aprovar retoma
 *   do outro lado.
 * - **Credencial** (`awaiting_input` com `kind: "vault"`): ele precisa de uma
 *   senha ou chave, e isso não se preenche aqui — o cofre é da plataforma, de
 *   propósito, para o segredo não passar por esta aplicação.
 *
 * Tratar as três como "erro" seria o caminho fácil e faria a pessoa achar que
 * quebrou algo quando o agente só está esperando por ela.
 *
 * ## O raciocínio não aparece
 *
 * `thinking_delta` é descartado. Quem usa este App não está depurando o agente,
 * e mostrar o rascunho do pensamento junto da resposta faz as duas coisas
 * competirem pela atenção — a pessoa lê o que ainda vai mudar.
 */

interface Passo {
  id: string;
  nome: string;
  estado: "rodando" | "ok" | "erro";
}

type Mensagem =
  | { tipo: "pessoa"; id: string; texto: string }
  | { tipo: "agente"; id: string; texto: string; passos: Passo[] };

interface Opcao {
  label: string;
  description?: string;
}

interface Pergunta {
  question: string;
  header?: string;
  options: Opcao[];
}

interface CardDePergunta {
  id: string;
  perguntas: Pergunta[];
}

type Pausa = { tipo: "aprovacao"; id: string } | { tipo: "credencial" } | null;

/**
 * A conversa em si. Recebe o roteiro pronto do servidor e daqui para baixo é
 * tudo cliente — conversa é interação.
 */
export function AgentChat({ agents }: { agents: AppAgent[] }) {
  const [selecionado, setSelecionado] = useState(
    () => (agents.find((a) => a.isDefault) ?? agents[0])?.key ?? "",
  );
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [rascunho, setRascunho] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [card, setCard] = useState<CardDePergunta | null>(null);
  const [pausa, setPausa] = useState<Pausa>(null);
  const [decidindo, setDecidindo] = useState(false);

  /**
   * O identificador da conversa em andamento.
   *
   * Em `ref` e não em `state` porque ele é lido DENTRO do laço do stream, na
   * mesma função que o recebe. Num `state` a leitura enxergaria o valor do
   * render em que a função nasceu — e a segunda mensagem começaria uma conversa
   * nova em vez de continuar a que está na tela.
   */
  const conversaId = useRef<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  /**
   * O envio em voo, para poder abortá-lo.
   *
   * Sem isto, sair da tela deixava o turno rodando. A rota de stream derruba o
   * ambiente do agente no `cancel` do corpo da resposta — e desmontar o
   * componente não cancela nada por si: o `fetch` e o laço de leitura seguem
   * vivos, sem ninguém para ler. O agente continuaria trabalhando para uma tela
   * que não existe mais, consumindo o que é da pessoa.
   */
  const emVoo = useRef<AbortController | null>(null);

  useEffect(() => () => emVoo.current?.abort(), []);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensagens, card, pausa]);

  /** Trocar de agente começa outra conversa: o histórico é por agente. */
  function trocarAgente(key: string) {
    setSelecionado(key);
    conversaId.current = null;
    setMensagens([]);
    setCard(null);
    setPausa(null);
    setErro(null);
  }

  const enviar = useCallback(
    async (texto: string) => {
      const limpo = texto.trim();
      if (!limpo || enviando || !selecionado) return;

      const idPessoa = crypto.randomUUID();
      const idAgente = crypto.randomUUID();
      setMensagens((atual) => [
        ...atual,
        { tipo: "pessoa", id: idPessoa, texto: limpo },
        { tipo: "agente", id: idAgente, texto: "", passos: [] },
      ]);
      setRascunho("");
      setErro(null);
      setCard(null);
      setPausa(null);
      setEnviando(true);

      /** Aplica uma mudança à mensagem do agente que está sendo escrita. */
      const atualizar = (fn: (m: Extract<Mensagem, { tipo: "agente" }>) => void) => {
        setMensagens((atual) =>
          atual.map((m) => {
            if (m.id !== idAgente || m.tipo !== "agente") return m;
            const copia = { ...m, passos: [...m.passos] };
            fn(copia);
            return copia;
          }),
        );
      };

      /**
       * Tira da tela a bolha vazia do agente.
       *
       * Ela é inserida ANTES da resposta chegar, e sem isto um caminho de erro a
       * deixava com texto e passos vazios — que é exatamente a condição de
       * `Escrevendo`. A pessoa via os três pontos animados ao lado do aviso de
       * falha e concluía que a resposta ainda estava a caminho.
       */
      const descartarBolhaVazia = () =>
        setMensagens((atual) =>
          atual.filter(
            (m) => m.id !== idAgente || m.tipo !== "agente" || m.texto !== "",
          ),
        );

      try {
        // Um envio de cada vez: se ainda houver outro em voo, ele perdeu a vez.
        emVoo.current?.abort();
        const controle = new AbortController();
        emVoo.current = controle;

        const resposta = await fetch(
          `/api/volund/agents/${encodeURIComponent(selecionado)}/stream`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: controle.signal,
            body: JSON.stringify({
              input: limpo,
              ...(conversaId.current ? { conversaId: conversaId.current } : {}),
            }),
          },
        );

        if (!resposta.ok || !resposta.body) {
          const corpo = (await resposta.json().catch(() => null)) as {
            message?: string;
          } | null;
          setErro(corpo?.message ?? "Não consegui falar com o assistente agora.");
          descartarBolhaVazia();
          return;
        }

        for await (const evento of lerEventos(resposta.body)) {
          switch (evento.type) {
            case "run_started":
              conversaId.current = evento.run_id;
              break;
            case "assistant_text_delta":
              atualizar((m) => {
                m.texto += evento.delta;
              });
              break;
            case "tool_call":
              atualizar((m) => {
                m.passos.push({
                  id: evento.tool_call_id,
                  nome: evento.tool_name,
                  estado: "rodando",
                });
              });
              break;
            case "tool_result":
              atualizar((m) => {
                const passo = m.passos.find((p) => p.id === evento.tool_call_id);
                if (passo) passo.estado = evento.is_error ? "erro" : "ok";
              });
              break;
            case "question_asked":
              setCard({
                id: evento.request_id,
                perguntas: lerPerguntas(evento.questions),
              });
              break;
            case "awaiting_input":
              setPausa(
                evento.kind === "approval"
                  ? { tipo: "aprovacao", id: evento.request_id }
                  : { tipo: "credencial" },
              );
              break;
            case "run_finished":
              if (evento.status === "failed") {
                setErro(evento.error ?? "O assistente não conseguiu terminar.");
              }
              break;
            case "channel_error":
              setErro(evento.message);
              break;
          }
        }
      } catch (err) {
        descartarBolhaVazia();
        // Cancelamento é pedido nosso — sair da tela, ou mandar outra mensagem
        // por cima. Mostrar "a conexão caiu" aí seria acusar defeito de uma
        // coisa que a própria pessoa fez.
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[volund] falha ao conversar:", err);
        setErro("A conexão caiu no meio da resposta. Tente enviar de novo.");
      } finally {
        setEnviando(false);
      }
    },
    [enviando, selecionado],
  );

  /** Manda as escolhas da pessoa. O card só sai da tela se elas chegarem. */
  async function responderCard(perguntaId: string, respostas: Record<string, string>) {
    setDecidindo(true);
    try {
      const r = await fetch("/api/volund/questions/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ perguntaId, respostas }),
      });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { message?: string } | null;
        setErro(corpo?.message ?? "Não consegui enviar sua resposta.");
        return;
      }
      setCard(null);
    } finally {
      setDecidindo(false);
    }
  }

  /**
   * Diz que a pessoa não quis escolher. O agente segue com a melhor decisão
   * possível em vez de esperar até desistir sozinho, com a tela parada.
   */
  async function pularCard(perguntaId: string) {
    setDecidindo(true);
    try {
      const r = await fetch("/api/volund/questions/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ perguntaId, pular: true }),
      });
      // O card só sai da tela se a recusa TIVER chegado. Limpá-lo de qualquer
      // jeito tirava da pessoa o único controle que retoma o turno, com o
      // agente ainda esperando do outro lado.
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { message?: string } | null;
        setErro(corpo?.message ?? "Não consegui enviar sua resposta.");
        return;
      }
      setCard(null);
    } finally {
      setDecidindo(false);
    }
  }

  /**
   * Libera ou recusa a ferramenta que pausou o agente. A retomada acontece do
   * outro lado e NÃO volta por esta conexão, que já fechou — daí a frase que
   * fica na tela dizendo o que esperar.
   */
  async function decidir(id: string, decisao: "aprovar" | "recusar") {
    setDecidindo(true);
    try {
      const r = await fetch(`/api/volund/approvals/${encodeURIComponent(id)}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisao }),
      });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { message?: string } | null;
        setErro(corpo?.message ?? "Não consegui registrar sua decisão.");
        return;
      }
      setPausa(null);
      // A decisão retoma o agente do outro lado, e a retomada não volta por esta
      // conexão — ela já fechou. A frase abaixo é o que evita a tela parecer
      // travada: ela diz o que aconteceu e o que fazer para ver o resto.
      setErro(
        decisao === "aprovar"
          ? "Liberado. Mande uma mensagem para ver o que o assistente fez com isso."
          : "Recusado. O assistente vai seguir sem essa ação.",
      );
    } finally {
      setDecidindo(false);
    }
  }

  const agente = agents.find((a) => a.key === selecionado);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <AgentPicker
        agents={agents}
        selecionado={selecionado}
        onSelecionar={trocarAgente}
        disabled={enviando}
      />

      <div className="border-border-subtle bg-surface flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-[16px] border p-6">
        {mensagens.length === 0 ? (
          <EstadoVazio agente={agente} />
        ) : (
          mensagens.map((m) =>
            m.tipo === "pessoa" ? (
              <div key={m.id} className="flex justify-end">
                <p className="bg-surface-elevated max-w-[85%] rounded-[14px] px-3.5 py-2.5 text-[15px] leading-[1.65] whitespace-pre-wrap">
                  {m.texto}
                </p>
              </div>
            ) : (
              <div key={m.id} className="flex flex-col gap-2">
                {m.passos.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {m.passos.map((p) => (
                      <li
                        key={p.id}
                        className="text-muted-foreground flex items-center gap-2 font-mono text-[11.5px]"
                      >
                        {p.estado === "rodando" ? (
                          <Loader2Icon className="size-3.5 animate-spin" />
                        ) : p.estado === "erro" ? (
                          <XIcon className="text-destructive size-3.5" />
                        ) : (
                          <CheckIcon className="size-3.5" />
                        )}
                        <WrenchIcon className="size-3.5" />
                        {p.nome}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {m.texto ? (
                  <p className="text-[15px] leading-[1.65] whitespace-pre-wrap">
                    {m.texto}
                  </p>
                ) : m.passos.length === 0 ? (
                  <Escrevendo />
                ) : null}
              </div>
            ),
          )
        )}

        {card ? (
          <CardPergunta
            card={card}
            ocupado={decidindo}
            onResponder={responderCard}
            onPular={pularCard}
          />
        ) : null}

        {pausa?.tipo === "aprovacao" ? (
          <CardAprovacao id={pausa.id} ocupado={decidindo} onDecidir={decidir} />
        ) : null}

        {pausa?.tipo === "credencial" ? (
          <Aviso>
            O assistente precisa de uma credencial para continuar. Ela é guardada no
            VolundOS, e não aqui — abra o assistente por lá para informá-la.
          </Aviso>
        ) : null}

        {erro ? <Aviso>{erro}</Aviso> : null}

        <div ref={fim} />
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar(rascunho);
        }}
      >
        <Textarea
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          onKeyDown={(e) => {
            // Enter envia; Shift+Enter quebra linha. Sem isto, escrever dois
            // parágrafos exigiria o mouse.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void enviar(rascunho);
            }
          }}
          rows={2}
          disabled={enviando}
          placeholder={
            agente ? `Peça algo para ${agente.name}…` : "Escolha um assistente…"
          }
          className="max-h-40 min-h-[52px] resize-none"
          aria-label="Sua mensagem"
        />
        <Button
          type="submit"
          size="icon-lg"
          disabled={enviando || rascunho.trim().length === 0}
          aria-label={enviando ? "Enviando…" : "Enviar"}
        >
          {enviando ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
        </Button>
      </form>
    </div>
  );
}

/** O que a tela mostra antes da primeira mensagem: quem é o agente e o que ele faz. */
function EstadoVazio({ agente }: { agente: AppAgent | undefined }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
      <MonoLabel>Assistente</MonoLabel>
      <p className="text-[15px] font-medium">{agente?.name ?? "Sem assistente"}</p>
      <p className="text-muted-foreground max-w-[42ch] text-[13px] leading-[1.65]">
        {agente?.description ??
          "Escreva o que você precisa. Ele responde aqui mesmo, e usa o que este app sabe fazer."}
      </p>
    </div>
  );
}

/** Os três pontos enquanto nada chegou ainda. Vazio leria-se como travado. */
function Escrevendo() {
  return (
    <div className="flex items-center gap-1" aria-label="Escrevendo" role="status">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="bg-muted-foreground size-1.5 animate-pulse rounded-full"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </div>
  );
}

/** Recado de erro ou de pausa. Mesma caixa para os dois, para não competirem. */
function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-border-subtle bg-surface-elevated text-muted-foreground flex items-start gap-2 rounded-[14px] border p-3.5 text-[13px] leading-[1.6]">
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/**
 * O card que o agente abriu, com as opções dele. O turno CONTINUA quando a
 * resposta chega — por isso ele aparece no meio da conversa em vez de encerrá-la.
 */
function CardPergunta({
  card,
  ocupado,
  onResponder,
  onPular,
}: {
  card: CardDePergunta;
  ocupado: boolean;
  onResponder: (id: string, respostas: Record<string, string>) => void;
  onPular: (id: string) => void;
}) {
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  // `every` de lista vazia é `true`: sem o primeiro termo, um card que não deu
  // para ler habilitaria "Responder" e mandaria um mapa vazio.
  const completo =
    card.perguntas.length > 0 && card.perguntas.every((p) => escolhas[p.question]);

  return (
    <div className="border-border-subtle bg-surface-elevated flex flex-col gap-4 rounded-[16px] border p-5">
      <MonoLabel>O assistente perguntou</MonoLabel>
      {card.perguntas.length === 0 ? (
        <p className="text-[13px] leading-[1.6]">
          Ele fez uma pergunta que esta tela não conseguiu mostrar. Deixe que ele
          decida, ou escreva a sua resposta na próxima mensagem.
        </p>
      ) : null}
      {card.perguntas.map((p) => (
        <fieldset key={p.question} className="flex flex-col gap-2">
          {/* O `<legend>` tem de ser o PRIMEIRO filho do `<fieldset>` — o
              rótulo em mono vem dentro dele. Fora dessa posição o navegador
              deixa de tratá-lo como legenda, e o grupo fica sem nome
              acessível: um leitor de tela anuncia as opções sem a pergunta. */}
          <legend className="flex flex-col gap-1 text-[14px] font-medium">
            {p.header ? <MonoLabel>{p.header}</MonoLabel> : null}
            {p.question}
          </legend>
          <div
            role="radiogroup"
            aria-label={p.question}
            className="flex flex-wrap gap-2"
          >
            {p.options.map((o) => {
              const ativo = escolhas[p.question] === o.label;
              return (
                <button
                  key={o.label}
                  type="button"
                  // Mesma semântica do seletor de agente: sem `role`/
                  // `aria-checked`, "escolhida" existe só como cor.
                  role="radio"
                  aria-checked={ativo}
                  disabled={ocupado}
                  onClick={() =>
                    setEscolhas((atual) => ({ ...atual, [p.question]: o.label }))
                  }
                  className={cn(
                    "border-border-subtle rounded-[12px] border px-3 py-2 text-left text-[13px] transition-colors",
                    "focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
                    "disabled:pointer-events-none disabled:opacity-50",
                    ativo
                      ? "border-primary/40 bg-primary/10"
                      : "hover:border-border-strong",
                  )}
                >
                  <span className="font-medium">{o.label}</span>
                  {o.description ? (
                    <span className="text-muted-foreground mt-0.5 block text-[12px]">
                      {o.description}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={ocupado || !completo}
          onClick={() => onResponder(card.id, escolhas)}
        >
          {ocupado ? <Loader2Icon className="animate-spin" /> : null}
          Responder
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={ocupado}
          onClick={() => onPular(card.id)}
        >
          Decida por mim
        </Button>
      </div>
    </div>
  );
}

/**
 * O pedido de liberação. Aqui o stream já FECHOU: o agente parou esperando uma
 * decisão, e é ela que o retoma.
 */
function CardAprovacao({
  id,
  ocupado,
  onDecidir,
}: {
  id: string;
  ocupado: boolean;
  onDecidir: (id: string, decisao: "aprovar" | "recusar") => void;
}) {
  return (
    <div className="border-border-subtle bg-surface-elevated flex flex-col gap-3 rounded-[16px] border p-5">
      <MonoLabel>Precisa da sua liberação</MonoLabel>
      <p className="text-[13px] leading-[1.6]">
        O assistente parou para pedir permissão antes de fazer algo. Libere para ele
        seguir, ou recuse para ele tentar outro caminho.
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={ocupado}
          onClick={() => onDecidir(id, "aprovar")}
        >
          {ocupado ? <Loader2Icon className="animate-spin" /> : null}
          Liberar
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={ocupado}
          onClick={() => onDecidir(id, "recusar")}
        >
          Recusar
        </Button>
      </div>
    </div>
  );
}

/** O que a tela entende de um evento — os do agente mais o do canal. */
type EventoDoChat = VolundEvent | { type: "channel_error"; message: string };

/**
 * Lê o corpo `text/event-stream` e entrega um evento por vez.
 *
 * Escrito à mão porque `EventSource` só faz `GET`, e a mensagem vai no corpo de
 * um `POST`. As duas armadilhas cobertas aqui: um pedaço da rede pode cortar um
 * evento no meio (daí o buffer até `\n\n`), e o batimento chega como comentário
 * `: ping` — descartar linha que não começa com `data:` é o que impede o
 * batimento de virar um evento inválido.
 */
async function* lerEventos(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<EventoDoChat> {
  const leitor = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let corte = buffer.indexOf("\n\n");
      while (corte !== -1) {
        const bloco = buffer.slice(0, corte);
        buffer = buffer.slice(corte + 2);
        for (const linha of bloco.split("\n")) {
          const limpa = linha.replace(/\r$/, "");
          if (!limpa.startsWith("data:")) continue;
          const cru = limpa.slice(5).trim();
          if (!cru) continue;
          try {
            yield JSON.parse(cru) as EventoDoChat;
          } catch {
            // Frame quebrado: descartar um evento é melhor que derrubar a
            // conversa inteira por causa dele.
          }
        }
        corte = buffer.indexOf("\n\n");
      }
    }
  } finally {
    leitor.releaseLock();
  }
}

/**
 * O payload do card chega como `unknown` — o contrato de eventos não o tipa, de
 * propósito, porque ele é do agente e não do protocolo. Estreitar aqui é o que
 * impede um card estranho de derrubar a tela: o que não tem a forma esperada
 * simplesmente não aparece.
 *
 * **`multiSelect` é ignorado, e a escolha continua sendo uma.** A resposta que a
 * plataforma recebe é um texto por pergunta, e não uma lista; inventar uma
 * codificação para várias opções (juntar com vírgula, por exemplo) seria
 * combinar um formato com o outro lado sem ele estar de acordo. Um card de
 * múltipla escolha vira escolha única aqui, e quem quiser acrescentar diz na
 * mensagem seguinte.
 */
function lerPerguntas(bruto: unknown): Pergunta[] {
  if (!Array.isArray(bruto)) return [];
  const perguntas: Pergunta[] = [];

  for (const item of bruto) {
    if (!item || typeof item !== "object") continue;
    const registro = item as Record<string, unknown>;
    if (typeof registro.question !== "string") continue;
    if (!Array.isArray(registro.options)) continue;

    const options: Opcao[] = [];
    for (const o of registro.options) {
      if (!o || typeof o !== "object") continue;
      const opcao = o as Record<string, unknown>;
      if (typeof opcao.label !== "string") continue;
      options.push({
        label: opcao.label,
        description:
          typeof opcao.description === "string" ? opcao.description : undefined,
      });
    }
    if (options.length === 0) continue;

    perguntas.push({
      question: registro.question,
      header: typeof registro.header === "string" ? registro.header : undefined,
      options,
    });
  }

  return perguntas;
}
