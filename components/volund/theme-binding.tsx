"use client";

import { useEffect } from "react";

import {
  PANEL_THEME_STORAGE_KEY,
  applyThemeMode,
  readPanelThemeMessage,
  systemThemeMode,
} from "@/lib/volund/theme";

/**
 * Quem decide claro ou escuro (contrato 9). Não renderiza nada.
 *
 * - **Dentro do painel do VolundOS**, o painel. Ele manda
 *   `{ source: "volund-panel", type: "theme", mode }` quando recebe o primeiro
 *   aviso de rota do `FrameBinding`, e de novo a cada troca no Perfil da pessoa.
 *   A partir da primeira mensagem dele, o aparelho deixa de mandar: a escolha
 *   da pessoa no painel pode ser "Escuro" num aparelho claro.
 * - **Fora do painel**, o aparelho (`prefers-color-scheme`), ao vivo.
 *
 * O primeiro quadro já sai certo pelo script de `THEME_BEFORE_PAINT_SCRIPT`, no
 * `<head>`; este componente mantém o tema certo depois disso.
 *
 * A mensagem só é aceita da origem exata do painel e da janela que emoldura
 * este App — a regra mora em `readPanelThemeMessage`, que o teste exercita.
 *
 * Fica ANTES do `FrameBinding` na árvore: o painel responde ao aviso de rota,
 * e o ouvinte precisa estar de pé quando a resposta chegar.
 */
export function ThemeBinding({ parentOrigin }: { parentOrigin: string | null }) {
  useEffect(() => {
    const framed = window.parent !== window && parentOrigin !== null;
    let panelDecided = false;

    function onMessage(event: MessageEvent) {
      const mode = readPanelThemeMessage(event, parentOrigin, window.parent);
      if (!mode) return;
      panelDecided = true;
      applyThemeMode(mode);
      try {
        sessionStorage.setItem(PANEL_THEME_STORAGE_KEY, mode);
      } catch {
        // Sem armazenamento (quadro de terceiro bloqueado): vale até recarregar.
      }
    }

    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    function onSystemChange() {
      if (panelDecided) return;
      applyThemeMode(systemThemeMode());
    }

    // Fora do painel, o aparelho vale desde já. Dentro, o script de antes da
    // pintura já aplicou o último tema do painel (ou o do aparelho, na primeira
    // vez) — e a resposta do painel corrige.
    if (!framed) applyThemeMode(systemThemeMode());

    if (framed) window.addEventListener("message", onMessage);
    media?.addEventListener("change", onSystemChange);
    return () => {
      if (framed) window.removeEventListener("message", onMessage);
      media?.removeEventListener("change", onSystemChange);
    };
  }, [parentOrigin]);

  return null;
}
