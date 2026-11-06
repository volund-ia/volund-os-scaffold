/**
 * As DECISÕES do seletor de elemento, sem janela nem React (contrato 10): a
 * conferência do pedido do painel, o que um clique faz, o Esc e a carga sob
 * demanda do componente. O componente (`components/volund/element-picker.tsx`)
 * e o seletor (`lib/volund/element-picker.ts`) só executam o que estas funções
 * decidem, e o teste exercita as funções, e não o texto dos arquivos.
 *
 * O formato das mensagens está em `contracts/frame-protocol.json`, igual nas
 * duas pontas.
 */

/** Quem assina cada direção. */
export const FRAME_SOURCE_APP = "volund-app";
export const FRAME_SOURCE_PANEL = "volund-panel";

/** O aviso de que o seletor está pronto: sem ele, o painel deixa o botão desligado. */
export const PICK_READY_MESSAGE = {
  source: FRAME_SOURCE_APP,
  type: "pick-ready",
} as const;

/** O modo seleção desligou do lado da aplicação: o painel sai do modo também. */
export const PICK_CANCEL_MESSAGE = {
  source: FRAME_SOURCE_APP,
  type: "pick-cancel",
} as const;

/**
 * Quanto a camada segura o ponteiro depois da escolha. O segundo clique de um
 * duplo clique chega uns 300 ms depois do primeiro: com os bloqueios já
 * retirados, ele cairia no botão da aplicação ("Excluir" com dois cliques
 * excluiria).
 */
export const FIM_DO_GESTO_MS = 450;

/**
 * O pedido do painel para ligar ou desligar o modo seleção, ou `null` quando a
 * mensagem não é um, ou não veio da origem EXATA do painel e da janela pai.
 *
 * As duas conferências são do EVENTO, não do corpo: quem manda a mensagem
 * controla cada byte do corpo, mas não controla a origem nem qual janela falou.
 * Uma página qualquer que emoldurasse esta aplicação não liga o seletor.
 */
export function readPanelPickMessage(
  event: { origin: string; source: unknown; data: unknown },
  parentOrigin: string | null,
  parentWindow: unknown,
): boolean | null {
  if (!parentOrigin) return null;
  if (event.origin !== parentOrigin) return null;
  if (event.source !== parentWindow) return null;
  const data = event.data as {
    source?: unknown;
    type?: unknown;
    active?: unknown;
  } | null;
  if (!data || typeof data !== "object") return null;
  if (data.source !== FRAME_SOURCE_PANEL || data.type !== "pick") return null;
  return typeof data.active === "boolean" ? data.active : null;
}

/**
 * O que um clique no modo seleção faz.
 *
 * - `engolir`: o fim do gesto de uma escolha que já aconteceu (o segundo
 *   clique de um duplo clique). Não escolhe de novo nem chega à aplicação.
 * - `seguir-no-modo`: nada escolhível sob o cursor (o fundo da página, uma
 *   margem). O modo segue ligado, como se o clique não tivesse existido:
 *   desligar aqui deixaria o painel dizendo "modo comentário" sem nenhum aviso,
 *   e o próximo clique da pessoa cairia na aplicação.
 * - `escolher`: manda `picked`, segura o fim do gesto e só então desliga.
 *
 * Em todos, o clique já foi cancelado antes de chegar à aplicação.
 */
export function decidirClique(p: {
  escolhendo: boolean;
  temElemento: boolean;
}): "engolir" | "seguir-no-modo" | "escolher" {
  if (p.escolhendo) return "engolir";
  return p.temElemento ? "escolher" : "seguir-no-modo";
}

/** A mensagem que uma tecla manda ao painel no modo seleção: só o Esc cancela. */
export function mensagemDaTecla(key: string): typeof PICK_CANCEL_MESSAGE | null {
  return key === "Escape" ? PICK_CANCEL_MESSAGE : null;
}

/**
 * A carga sob demanda do componente: o seletor só é baixado no primeiro pedido
 * de ligar o modo, e o pedido que chegar enquanto ele baixa é o que vale.
 */
export interface CargaDoSeletor {
  carregando: boolean;
  /** O último pedido do painel: é com ele que o seletor nasce. */
  ultimoPedido: boolean;
}

export const CARGA_INICIAL: CargaDoSeletor = { carregando: false, ultimoPedido: false };

/** Chegou um pedido do painel. `carregar` diz se é hora de baixar o seletor. */
export function aoPedido(
  carga: CargaDoSeletor,
  active: boolean,
): { carga: CargaDoSeletor; carregar: boolean } {
  const proxima = { ...carga, ultimoPedido: active };
  if (!active || carga.carregando) return { carga: proxima, carregar: false };
  return { carga: { ...proxima, carregando: true }, carregar: true };
}

/** O seletor chegou: ele nasce no estado do último pedido. */
export function aoCarregar(carga: CargaDoSeletor): { initialActive: boolean } {
  return { initialActive: carga.ultimoPedido };
}

/**
 * O seletor não baixou (o App foi republicado e o arquivo antigo sumiu, a rede
 * caiu). Se o painel tinha pedido o modo, ele precisa sair dele: sem isto, o
 * botão seguiria pressionado e o clique da pessoa cairia na aplicação. O
 * próximo pedido tenta baixar de novo.
 */
export function aoFalhar(carga: CargaDoSeletor): {
  carga: CargaDoSeletor;
  avisar: typeof PICK_CANCEL_MESSAGE | null;
} {
  return {
    carga: CARGA_INICIAL,
    avisar: carga.ultimoPedido ? PICK_CANCEL_MESSAGE : null,
  };
}
