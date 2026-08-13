/**
 * A prova de posse que a PLATAFORMA apresenta para ler a superfície interna
 * deste App (contrato 4).
 *
 * ## Por que existe uma rota só para isto, se já há `tools/list`
 *
 * Porque as duas respondem perguntas diferentes. O `tools/list` do endpoint MCP
 * é **filtrado por `can()`**, com o sujeito de quem pergunta: ele responde "o
 * que ESTE sujeito pode chamar". A governança precisa de "o que existe" — e usar
 * a lista filtrada para conferir acusaria deriva falsa, porque tudo o que o
 * sujeito da verificação não pudesse chamar apareceria como declarado e
 * inexistente.
 *
 * Pior: uma tool que exige uma chave que não está no catálogo continuaria
 * filtrada. Esse é justamente o caso de deriva REAL que a verificação existe
 * para achar — a filtragem esconderia exatamente o que se procura.
 *
 * ## O segredo NÃO viaja
 *
 * A plataforma e este App compartilham o `VOLUND_OIDC_CLIENT_SECRET`: ela o
 * injetou, ele o guarda. Mandá-lo num header seria simples e seria um erro — um
 * segredo que existe para não sair do servidor passaria a atravessar a rede a
 * cada verificação, e bastaria um log de proxy para vazá-lo.
 *
 * Em vez disso a plataforma ASSINA (HMAC-SHA256) o caminho e o instante, e este
 * módulo confere com a própria cópia. O que viaja é uma prova de posse, e ela
 * não serve para mais nada.
 *
 * O instante entra na assinatura e tem janela curta: sem ele, uma assinatura
 * capturada valeria para sempre, e "prova de posse" viraria "prova de que alguém
 * teve posse algum dia".
 *
 * O esquema é o mesmo definido em `lib/governance/surface-verification.ts` do
 * VolundOS. As duas pontas precisam concordar byte a byte — daí a mensagem
 * assinada ser explícita aqui, e não montada por conveniência.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Caminho desta rota. Entra na assinatura — ver `signaturePayload`. */
export const INTROSPECTION_PATH = "/api/_volund/surface";

/** Cabeçalhos que a plataforma envia. */
export const TIMESTAMP_HEADER = "x-volund-timestamp";
export const SIGNATURE_HEADER = "x-volund-signature";

/**
 * Cinco minutos. Cobre relógio dessincronizado entre a plataforma e este host
 * sem deixar uma captura útil por muito tempo.
 */
export const SIGNATURE_WINDOW_SECONDS = 300;

/**
 * A mensagem assinada: caminho e instante, nesta ordem, separados por `\n`.
 *
 * O caminho entra para a assinatura não ser reutilizável em outra rota deste
 * App: sem ele, uma assinatura emitida para a introspecção valeria para qualquer
 * endereço que um dia passasse a aceitar o mesmo esquema.
 */
export function signaturePayload(path: string, timestamp: number): string {
  return `${path}\n${timestamp}`;
}

export function sign(secret: string, path: string, timestamp: number): string {
  return createHmac("sha256", secret)
    .update(signaturePayload(path, timestamp))
    .digest("hex");
}

export type VerificationOutcome =
  | { ok: true }
  | { ok: false; reason: "missing" | "malformed" | "expired" | "mismatch" };

/**
 * Confere a assinatura apresentada — em tempo constante e dentro da janela.
 *
 * O motivo da recusa é devolvido para o LOG deste App, e não para a resposta: um
 * atacante que soubesse distinguir "expirou" de "não confere" ganharia um
 * oráculo sobre a própria assinatura. A resposta é sempre a mesma.
 */
export function verifySignature(params: {
  secret: string;
  path: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  now?: number;
}): VerificationOutcome {
  if (!params.timestampHeader || !params.signatureHeader) {
    return { ok: false, reason: "missing" };
  }

  // `Number()` de string vazia é 0, e de lixo é NaN. Os dois precisam cair fora
  // ANTES da comparação de janela — `NaN` em qualquer comparação é `false`, e
  // uma guarda escrita como `if (diferenca > janela) recusa` deixaria `NaN`
  // passar direto.
  const timestamp = Number(params.timestampHeader);
  if (!Number.isFinite(timestamp) || !Number.isInteger(timestamp)) {
    return { ok: false, reason: "malformed" };
  }

  const now = params.now ?? Math.floor(Date.now() / 1000);
  // Nos DOIS sentidos: um instante no futuro é tão suspeito quanto um velho
  // demais, e aceitar o futuro tornaria a janela infinita para quem escolhe o
  // próprio relógio.
  if (Math.abs(now - timestamp) > SIGNATURE_WINDOW_SECONDS) {
    return { ok: false, reason: "expired" };
  }

  const esperada = Buffer.from(sign(params.secret, params.path, timestamp), "utf8");
  const recebida = Buffer.from(params.signatureHeader, "utf8");
  // `timingSafeEqual` exige o mesmo tamanho, e a diferença de tamanho aqui não é
  // segredo útil: a assinatura tem tamanho fixo.
  if (esperada.length !== recebida.length) {
    return { ok: false, reason: "mismatch" };
  }
  return timingSafeEqual(esperada, recebida)
    ? { ok: true }
    : { ok: false, reason: "mismatch" };
}
