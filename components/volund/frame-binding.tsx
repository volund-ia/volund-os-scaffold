"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * O vínculo de rota com quem emoldura esta aplicação (contrato 7).
 *
 * ## Por que ele existe
 *
 * No painel do VolundOS esta aplicação roda dentro de um quadro, e o painel
 * **não consegue ler** a URL de dentro dele: são origens diferentes, e essa
 * barreira é a mesma que torna o isolamento do quadro seguro. O efeito prático é
 * que, sem este componente, o endereço do painel congela na página em que a
 * aplicação abriu — quem clicasse em qualquer link aqui dentro e copiasse o link
 * de lá mandaria o colega para outro lugar.
 *
 * Então a aplicação AVISA: uma mensagem a cada mudança de rota. E escuta a
 * direção contrária, que é o que permite o painel navegar sem trocar o `src` do
 * quadro — trocar o `src` remonta o documento e joga fora o que a pessoa estava
 * fazendo (formulário preenchido, passo de um fluxo).
 *
 * O formato das duas mensagens está em `contracts/frame-protocol.json`, e o
 * mesmo arquivo existe do outro lado. Ele não é dependência de build: quem
 * garante que os dois não divirjam é o número de contrato e a revisão.
 *
 * ## A origem é sempre explícita
 *
 * `postMessage` com `"*"` publicaria a navegação de quem usa a aplicação para
 * QUALQUER página que resolvesse emoldurá-la. O destino é a origem do painel, que
 * o App já conhece por `VOLUND_OIDC_ISSUER` — e a mensagem que chega só é aceita
 * se vier de lá.
 *
 * ## Não fazer nada é o caminho normal
 *
 * Fora do painel — a aplicação aberta numa aba, que é como ela roda na maior
 * parte do tempo — não há pai, e o componente não faz absolutamente nada. Ele
 * também não renderiza nada em nenhum caso.
 */
export function FrameBinding({ parentOrigin }: { parentOrigin: string | null }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Avisa a rota atual: na montagem e a cada navegação daqui de dentro.
  useEffect(() => {
    if (!parentOrigin) return;
    if (window.parent === window) return;

    const query = searchParams.toString();
    // A query faz parte do endereço: sem ela, "a tela que eu estava vendo"
    // perderia o filtro, a aba e a página — que é o que distingue uma tela da
    // outra em qualquer sistema de verdade.
    const path = `${pathname}${query ? `?${query}` : ""}`;
    window.parent.postMessage(
      { source: "volund-app", type: "route", path },
      parentOrigin,
    );
  }, [parentOrigin, pathname, searchParams]);

  // Escuta o pedido de navegação do painel.
  useEffect(() => {
    if (!parentOrigin) return;

    function onMessage(event: MessageEvent) {
      // Origem exata, e a janela tem de ser a que emoldura esta. Sem a segunda
      // conferência, qualquer quadro irmão servido pelo mesmo painel poderia
      // navegar esta aplicação.
      if (event.origin !== parentOrigin) return;
      if (event.source !== window.parent) return;

      const data = event.data as {
        source?: unknown;
        type?: unknown;
        path?: unknown;
      } | null;
      if (!data || typeof data !== "object") return;
      if (data.source !== "volund-panel" || data.type !== "navigate") return;
      if (typeof data.path !== "string" || !data.path.startsWith("/")) return;
      // Caminho que sairia do site não é rota desta aplicação: `//outro.site` e
      // `/\outro.site` são endereços absolutos para o navegador, e o roteador os
      // levaria a sério.
      if (/^[/\\]{2}/.test(data.path)) return;

      router.push(data.path);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [parentOrigin, router]);

  return null;
}
