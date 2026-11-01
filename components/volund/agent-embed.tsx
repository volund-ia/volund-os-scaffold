"use client";

import { Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  readEmbedEvent,
  renewFailure,
  renewRequestBody,
  threadIdOf,
  type EmbedCommand,
  type EmbedEvent,
} from "@/lib/volund/embed-messages";
import { useThemeMode } from "@/lib/volund/use-theme-mode";

/** O que a página entrega: a sessão criada no servidor (`createEmbedSession`). */
export interface AgentEmbedSession {
  sessionId: string;
  embedUrl: string;
  threadId: string | null;
}

/**
 * O chat do VolundOS dentro do App (contrato 9).
 *
 * Não é um chat: é o QUADRO do chat da plataforma, ocupando a área que recebe.
 * Markdown, anexos, aprovações, perguntas e ferramentas são todos do VolundOS e
 * evoluem lá. O que este componente faz é o que só o App pode fazer:
 *
 * - **o tema**: no `volund:ready` e a cada troca de claro/escuro do App, manda
 *   `volund:set-color-mode` com o modo atual — o chat acompanha o resto da tela;
 * - **a renovação**: no `volund:session-expiring` (dois minutos antes do fim),
 *   pede uma sessão nova a `POST /api/volund/embed-session` com a conversa em
 *   curso e troca o quadro, e a pessoa continua onde estava;
 * - **o erro**: no `volund:error`, oferece abrir de novo.
 *
 * Mensagem só é aceita da origem do VolundOS e da janela deste quadro
 * (`readEmbedEvent`); e o que sai vai para a origem exata, nunca `"*"`.
 *
 * `onEvent` recebe todo evento conferido — `volund:turn-ended` com o texto da
 * resposta, `volund:artifact` — para a página reagir sem ouvir `message` por
 * conta própria.
 */
export function AgentEmbed({
  session: inicial,
  platformOrigin,
  agent,
  onEvent,
  className,
}: {
  session: AgentEmbedSession;
  /** A origem do VolundOS (`new URL(VOLUND_OIDC_ISSUER).origin`). */
  platformOrigin: string;
  /** O apelido com que a sessão foi criada, para renovar com o mesmo agente. */
  agent?: string;
  onEvent?: (event: EmbedEvent) => void;
  className?: string;
}) {
  const [session, setSession] = useState(inicial);
  const [aviso, setAviso] = useState<string | null>(null);
  const [renovando, setRenovando] = useState(false);
  const mode = useThemeMode();

  const frameRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const threadRef = useRef<string | null>(inicial.threadId);
  const sessionIdRef = useRef(inicial.sessionId);
  const modeRef = useRef(mode);
  const renovandoRef = useRef(false);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const post = useCallback(
    (command: EmbedCommand) => {
      frameRef.current?.contentWindow?.postMessage(command, platformOrigin);
    },
    [platformOrigin],
  );

  const renovar = useCallback(async () => {
    if (renovandoRef.current) return;
    renovandoRef.current = true;
    setRenovando(true);
    try {
      const r = await fetch("/api/volund/embed-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          renewRequestBody({
            agent,
            threadId: threadRef.current,
            colorMode: modeRef.current,
            replaces: sessionIdRef.current,
          }),
        ),
      });
      const body = (await r.json().catch(() => null)) as
        (AgentEmbedSession & { error?: string; message?: string }) | null;
      if (!r.ok || !body?.embedUrl) {
        const falha = renewFailure(body);
        // A conversa guardada foi recusada: "Abrir de novo" abre uma nova.
        if (falha.forgetThread) threadRef.current = null;
        setAviso(falha.message);
        return;
      }
      readyRef.current = false;
      sessionIdRef.current = body.sessionId;
      if (body.threadId) threadRef.current = body.threadId;
      setAviso(null);
      setSession({
        sessionId: body.sessionId,
        embedUrl: body.embedUrl,
        threadId: body.threadId ?? null,
      });
    } catch {
      setAviso("Não consegui renovar a conversa. Recarregue a página para continuar.");
    } finally {
      renovandoRef.current = false;
      setRenovando(false);
    }
  }, [agent]);

  // As mensagens do quadro.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const lido = readEmbedEvent(
        event,
        platformOrigin,
        frameRef.current?.contentWindow,
      );
      if (!lido) return;

      const thread = threadIdOf(lido);
      if (thread) threadRef.current = thread;

      switch (lido.type) {
        case "volund:ready":
          readyRef.current = true;
          post({ type: "volund:set-color-mode", mode: modeRef.current });
          break;
        case "volund:session-expiring":
          void renovar();
          break;
        case "volund:error":
          setAviso("A conversa foi interrompida.");
          break;
        default:
          break;
      }
      onEventRef.current?.(lido);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [platformOrigin, post, renovar]);

  // A troca de tema do App chega ao chat sem recarregar o quadro.
  useEffect(() => {
    modeRef.current = mode;
    if (readyRef.current) post({ type: "volund:set-color-mode", mode });
  }, [mode, post]);

  return (
    <div className={`flex h-full min-h-0 flex-col gap-2 ${className ?? ""}`}>
      {aviso ? (
        <div
          role="status"
          className="border-border-subtle bg-surface flex items-center justify-between gap-3 rounded-[14px] border px-3.5 py-2.5"
        >
          <p className="text-muted-foreground text-[13px]">{aviso}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={renovando}
            onClick={() => void renovar()}
          >
            {renovando ? <Loader2Icon className="animate-spin" /> : null}
            {renovando ? "Abrindo…" : "Abrir de novo"}
          </Button>
        </div>
      ) : null}
      <iframe
        // A chave remonta o quadro quando a sessão troca: o endereço novo tem
        // outro código de entrada, e o documento antigo não serve para ele.
        key={session.sessionId}
        ref={frameRef}
        src={session.embedUrl}
        aria-label="Conversa com o assistente"
        // Copiar a resposta do agente. Microfone fica de fora: o chat embutido
        // não tem voz.
        allow="clipboard-write"
        className="border-border-subtle bg-surface min-h-0 w-full flex-1 rounded-[16px] border"
      />
    </div>
  );
}
