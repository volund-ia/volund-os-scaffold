"use client";

import { useEffect } from "react";

import {
  PICK_READY_MESSAGE,
  readPanelPickMessage,
} from "@/lib/volund/element-picker-gate";

/**
 * A seleção de elemento para comentar com o agente do VolundOS (contrato 10).
 *
 * ## O que ela é
 *
 * No painel do VolundOS, quem constrói a aplicação liga "Comentar", escolhe um
 * elemento da página e escreve o que quer mudar; o agente recebe o lugar
 * exato (rota, seletor, componente e arquivo:linha quando há). O painel não
 * consegue ler esta página (outra origem), então quem acha o elemento é o
 * seletor que roda aqui dentro (`lib/volund/element-picker.ts`).
 *
 * ## Por que ele carrega só quando pedem
 *
 * O seletor leva o `react-grab` (dezenas de KB). Quem USA a aplicação nunca
 * comenta nada, e não pode pagar por isso em toda página. Então este componente
 * só faz duas coisas baratas: avisa ao painel que sabe selecionar
 * (`pick-ready`, sem o qual o botão fica desligado) e escuta. O código de
 * verdade só é baixado no primeiro pedido de ligar o modo.
 *
 * ## Não fazer nada é o caminho normal
 *
 * Fora do painel (a aplicação aberta numa aba, como roda quase sempre) não há
 * pai, e o componente não faz nada. Nem quando o seletor já está na página: no
 * ambiente de Desenvolvimento, o proxy do VolundOS injeta o mesmo seletor em
 * toda página, e dois seletores responderiam duas vezes ao mesmo clique.
 *
 * As mensagens só vão para a origem do painel (`VOLUND_OIDC_ISSUER`) e só são
 * aceitas dela e da janela pai, como no `FrameBinding`.
 */
export function ElementPicker({ parentOrigin }: { parentOrigin: string | null }) {
  useEffect(() => {
    if (!parentOrigin) return;
    if (window.parent === window) return;
    // O proxy do ambiente de Desenvolvimento já pôs o seletor nesta página.
    if (
      (window as unknown as { __volundPickerStarted?: boolean }).__volundPickerStarted
    )
      return;

    let carregando = false;
    let ultimoPedido = false;
    let vivo = true;

    function onMessage(event: MessageEvent) {
      const active = readPanelPickMessage(event, parentOrigin, window.parent);
      if (active === null) return;
      ultimoPedido = active;
      if (!active || carregando) return;
      carregando = true;
      void import("@/lib/volund/element-picker")
        .then(({ startElementPicker }) => {
          if (!vivo) return;
          // A partir daqui, quem escuta o painel é o seletor.
          window.removeEventListener("message", onMessage);
          startElementPicker({
            panelOrigin: parentOrigin!,
            announceReady: false,
            // O pedido que chegou enquanto o código baixava é o que vale.
            initialActive: ultimoPedido,
          });
        })
        .catch(() => {
          // Sem o código, o próximo pedido tenta de novo.
          carregando = false;
        });
    }

    const avisar = () => window.parent.postMessage(PICK_READY_MESSAGE, parentOrigin);

    window.addEventListener("message", onMessage);
    // Depois do `load`, como o seletor faz: ligar o modo no meio da hidratação
    // poria a camada dele no documento antes de o React terminar.
    if (document.readyState === "complete") avisar();
    else window.addEventListener("load", avisar, { once: true });

    return () => {
      vivo = false;
      window.removeEventListener("message", onMessage);
      window.removeEventListener("load", avisar);
    };
  }, [parentOrigin]);

  return null;
}
