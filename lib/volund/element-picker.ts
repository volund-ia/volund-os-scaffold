/**
 * O seletor de elemento que roda DENTRO da página da aplicação (contrato 10).
 *
 * Cópia do seletor do VolundOS (`lib/apps/element-picker/picker.ts` no
 * `volund-os`), adaptada para ser IMPORTADA pelo componente
 * (`components/volund/element-picker.tsx`), e não injetada como `<script>`: sem
 * início automático e com as opções de que o componente precisa. Mudou lá,
 * mude aqui; o formato das mensagens é o de `contracts/frame-protocol.json`.
 *
 * O painel do VolundOS não lê o DOM do quadro (outra origem: é isso que torna
 * o `sandbox` seguro), então quem acha o elemento é este código, aqui dentro.
 *
 * ## O que ele faz
 *
 * 1. Ao receber `pick { active: true }` da origem EXATA do painel e da janela
 *    pai, liga o modo: cursor em mira e o contorno do modo comentário sobre
 *    quem está sob o mouse, desenhado aqui dentro (é aqui que se sabe onde o
 *    elemento está com rolagem e zoom).
 * 2. O clique é CAPTURADO e cancelado antes de chegar à aplicação: escolher o
 *    botão "Excluir" não pode excluir nada. Ele vira `picked`, e o modo desliga.
 * 3. Esc desliga e avisa `pick-cancel`.
 *
 * O componente e o arquivo:linha vêm do `react-grab` (`getElementContext`), que
 * lê a pilha de componentes do React. Num build de produção normalmente não há
 * essa informação, e aí vão só seletor, texto e HTML, que bastam para o agente
 * achar o elemento.
 */

import {
  getElementAtPoint,
  getElementContext,
  getElementSelector,
  isElementGrabbable,
} from "react-grab/primitives";

const SOURCE_APP = "volund-app";
const SOURCE_PANEL = "volund-panel";
/** Quanto a camada segura o ponteiro depois da escolha: cobre o duplo clique. */
const FIM_DO_GESTO_MS = 450;

interface StartOptions {
  panelOrigin: string;
  /**
   * Avisar `pick-ready` depois do `load`. O componente já avisou antes de
   * carregar este código (o painel só pede depois do aviso), então passa
   * `false`.
   */
  announceReady?: boolean;
  /** Já nascer no modo seleção: o pedido que fez o componente carregar este código. */
  initialActive?: boolean;
}

/** Texto visível, numa linha. */
function visibleText(el: Element): string {
  const raw = (el as HTMLElement).innerText ?? el.textContent ?? "";
  return raw.replace(/\s+/g, " ").trim();
}

/** O nome que a pessoa reconhece: rótulo acessível, texto, alt, placeholder. */
function nameOf(el: Element): string {
  const candidates = [
    el.getAttribute("aria-label"),
    visibleText(el),
    el.getAttribute("alt"),
    el.getAttribute("placeholder"),
    el.getAttribute("title"),
    el.getAttribute("name"),
  ];
  for (const c of candidates) {
    const v = c?.replace(/\s+/g, " ").trim();
    if (v) return v.length > 80 ? `${v.slice(0, 79)}…` : v;
  }
  return el.tagName.toLowerCase();
}

/** Seletor CSS próprio, para quando o do react-grab não vier. */
function fallbackSelector(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && parts.length < 6) {
    if (node.id) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
    parts.unshift(
      same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag,
    );
    node = parent;
  }
  return parts.join(" > ");
}

/** A tag de abertura, sem os filhos: é o que identifica sem despejar a página. */
function openingTag(el: Element): string {
  const html = el.outerHTML;
  const end = html.indexOf(">");
  return end === -1 ? html.slice(0, 300) : html.slice(0, end + 1);
}

export function startElementPicker({
  panelOrigin,
  announceReady = true,
  initialActive = false,
}: StartOptions): void {
  if (window.parent === window) return;
  if (!/^https?:\/\/[^/]+$/.test(panelOrigin)) return;
  // Duas cargas (script injetado + componente do scaffold) não podem ligar
  // dois seletores na mesma página.
  if ((window as unknown as { __volundPickerStarted?: boolean }).__volundPickerStarted)
    return;
  (window as unknown as { __volundPickerStarted?: boolean }).__volundPickerStarted =
    true;

  const post = (message: Record<string, unknown>) =>
    window.parent.postMessage({ source: SOURCE_APP, ...message }, panelOrigin);

  // Uma camada por cima da página, num shadow root: o CSS da aplicação não
  // alcança, e ela não alcança o da aplicação. Com o modo ligado ela RECEBE o
  // ponteiro (cursor em mira, e o clique nunca chega a um elemento do App); o
  // elemento sob ela é achado por `getElementAtPoint`, que a atravessa.
  //
  // Nada disto toca no DOM do App, nem no `style` do `<html>`: o React compara
  // o documento com o HTML do servidor na hidratação, e um atributo a mais vira
  // aviso de "hydration mismatch" no App da pessoa.
  const host = document.createElement("div");
  host.setAttribute("data-react-grab-ignore", "");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;inset:0;pointer-events:auto;cursor:crosshair;z-index:2147483647;display:none;background:transparent";
  const shadow = host.attachShadow({ mode: "open" });
  // O contorno é o do modo comentário dos artefatos
  // (`components/artifacts/design-comments.tsx`): só a linha, 2 px na cor da
  // marca a 80%, raio 3, afastada 1 px do elemento. Sem etiqueta e sem fundo.
  shadow.innerHTML = `<style>
    .box{position:fixed;pointer-events:none;box-sizing:border-box;border:2px solid rgba(237,59,98,.8);border-radius:3px;transition:all 60ms linear}
  </style><div class="box"></div>`;
  const box = shadow.querySelector(".box") as HTMLDivElement;
  const mount = () => {
    if (!host.isConnected) document.documentElement.appendChild(host);
  };

  let active = false;
  /**
   * Entre o clique que escolheu e o fim do gesto. O segundo clique de um duplo
   * clique chega uns 300 ms depois do primeiro: com os bloqueios já retirados,
   * ele cairia no botão do App ("Excluir" com dois cliques excluiria). A camada
   * e os bloqueios ficam até `FIM_DO_GESTO_MS` depois da escolha.
   */
  let escolhendo = false;
  let fimDoGesto: number | null = null;
  let current: Element | null = null;
  let frame = 0;
  let lastPoint: { x: number; y: number } | null = null;

  const elementAt = (x: number, y: number): Element | null =>
    getElementAtPoint(x, y, {
      filter: (candidate: Element) =>
        isElementGrabbable(candidate) && !host.contains(candidate),
    });

  const draw = () => {
    frame = 0;
    if (!active || escolhendo || !lastPoint) return;
    const el = elementAt(lastPoint.x, lastPoint.y);
    current = el;
    box.style.display = el ? "block" : "none";
    if (!el) return;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      left: `${r.left - 3}px`,
      top: `${r.top - 3}px`,
      width: `${r.width + 6}px`,
      height: `${r.height + 6}px`,
    });
  };

  const onMove = (event: PointerEvent) => {
    lastPoint = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(draw);
  };

  const block = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const setActive = (next: boolean) => {
    if (next === active) return;
    active = next;
    const events = [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "dblclick",
      "contextmenu",
    ];
    if (active) {
      mount();
      host.style.display = "block";
      box.style.display = "none";
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("click", onClick, true);
      window.addEventListener("keydown", onKey, true);
      for (const e of events) window.addEventListener(e, block, true);
    } else {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
      for (const e of events) window.removeEventListener(e, block, true);
      host.style.display = "none";
      current = null;
      lastPoint = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
  };

  async function describe(el: Element) {
    const r = el.getBoundingClientRect();
    const base = {
      selector: "",
      label: nameOf(el),
      tag: el.tagName.toLowerCase(),
      componentName: null as string | null,
      filePath: null as string | null,
      line: null as number | null,
      column: null as number | null,
      text: visibleText(el).slice(0, 280),
      htmlPreview: openingTag(el).slice(0, 1200),
      route: `${location.pathname}${location.search}`,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    };
    try {
      base.selector = getElementSelector(el) ?? "";
    } catch {
      /* fica o próprio */
    }
    try {
      const ctx = await getElementContext(el);
      base.componentName = ctx.componentName;
      base.filePath = ctx.filePath;
      base.line = ctx.lineNumber;
      base.column = ctx.columnNumber;
      if (!base.selector && ctx.selector) base.selector = ctx.selector;
    } catch {
      // Sem React, ou build sem informação de depuração: seguem seletor,
      // texto e HTML, que bastam para o agente achar o elemento.
    }
    if (!base.selector) base.selector = fallbackSelector(el);
    return base;
  }

  async function onClick(event: MouseEvent) {
    block(event);
    if (escolhendo) return;
    const el = current ?? elementAt(event.clientX, event.clientY);
    escolhendo = true;
    box.style.display = "none";
    fimDoGesto = window.setTimeout(() => {
      fimDoGesto = null;
      escolhendo = false;
      setActive(false);
    }, FIM_DO_GESTO_MS);
    if (!el) return;
    post({ type: "picked", element: await describe(el) });
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    block(event);
    setActive(false);
    post({ type: "pick-cancel" });
  }

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.origin !== panelOrigin) return;
    if (event.source !== window.parent) return;
    const data = event.data as {
      source?: unknown;
      type?: unknown;
      active?: unknown;
    } | null;
    if (!data || typeof data !== "object") return;
    if (data.source !== SOURCE_PANEL || data.type !== "pick") return;
    if (typeof data.active !== "boolean") return;
    // Pedido do painel no meio do fim do gesto (a pessoa religou o modo logo
    // depois de escolher): o pedido novo prevalece. Sem isto, o temporizador
    // desligaria o seletor com o painel dizendo "modo comentário".
    if (fimDoGesto !== null) {
      window.clearTimeout(fimDoGesto);
      fimDoGesto = null;
      escolhendo = false;
      setActive(false);
    }
    setActive(data.active);
  });

  if (initialActive) setActive(true);

  // Só depois do `load`: ligar o modo antes de o App hidratar poria a camada no
  // documento no meio da hidratação.
  if (!announceReady) return;
  const ready = () => requestAnimationFrame(() => post({ type: "pick-ready" }));
  if (document.readyState === "complete") ready();
  else window.addEventListener("load", ready, { once: true });
}
