/**
 * O contrato da camada de serviço — o formato que toda regra de negócio deste
 * App tem.
 *
 * ## Por que esta camada existe
 *
 * Uma aplicação do VolundOS é alcançada por mais de uma porta: a tela, a rota
 * HTTP e a tool de MCP que um agente chama. Se cada porta decidir por conta
 * própria, elas divergem — e a divergência não aparece como erro, aparece como
 * comportamento diferente para a mesma pergunta. Numa aplicação de reservas isso
 * significa a tool marcar uma sala que a tela não deixaria marcar, e o dono da
 * sala descobrir depois.
 *
 * Então a decisão mora aqui, **uma vez**, e as portas só traduzem entrada e
 * saída. Um serviço:
 *
 * - recebe a sessão e a entrada crua, `(session, entrada) → resultado`;
 * - **não conhece HTTP**: nada de resposta, status, cabeçalho, cookie ou
 *   `Request`. Quem traduz para HTTP é a rota;
 * - devolve `ServiceResult`, que é sucesso com dado ou falha da taxonomia
 *   abaixo — nunca lança para dizer "não pode".
 *
 * ## A taxonomia é única de propósito
 *
 * A rota vai mapear estes códigos para status HTTP e a tool vai mapeá-los para
 * erro de MCP. Havendo uma lista só, as duas traduções ficam completas por
 * construção: um código novo aparece nos dois lugares como caso não tratado, e
 * não como comportamento diferente em cada porta.
 */

import type { z } from "zod";

import type { Session } from "../auth/session";

/**
 * A tool que expõe o serviço lê ou escreve? Declarado no serviço porque é o
 * serviço que sabe — quem opera o agente decide, tool por tool, o que passa
 * direto e o que pede confirmação, e para isso precisa da resposta correta.
 *
 * Um serviço que grava é `write`, ainda que também devolva dado.
 */
export type ServiceKind = "read" | "write";

/**
 * Os modos de falhar. Não há "erro genérico": o chamador precisa distinguir o
 * que ele pode corrigir (entrada) do que não pode (permissão).
 */
export type ServiceErrorCode =
  /** Não há sessão. Quem chama pela tela vai para o login; quem chama por API, 401. */
  | "unauthenticated"
  /** Há sessão, falta a permissão exigida. */
  | "forbidden"
  /** A entrada não passou pelo schema declarado. */
  | "invalid_input"
  /** O que se pediu não existe (ou não é visível para este sujeito). */
  | "not_found"
  /** O estado atual não permite a operação (duplicado, já encerrado, etc.). */
  | "conflict"
  /** Falha nossa. A mensagem é genérica de propósito — ver `defineService`. */
  | "internal";

export interface ServiceError {
  code: ServiceErrorCode;
  /** Mensagem em português, pronta para chegar a quem chamou. Sem detalhe de infraestrutura. */
  message: string;
  /** Em `forbidden`: qual permissão faltou. É o que permite a tela explicar o que pedir. */
  permission?: string;
  /** Em `invalid_input`: um item por campo, no formato `campo: problema`. */
  issues?: string[];
}

export type ServiceResult<T> =
  { ok: true; data: T } | { ok: false; error: ServiceError };

/** Sucesso. */
export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

/**
 * Falha. Existe para que nenhum serviço monte o objeto de erro à mão — o campo
 * esquecido só apareceria no chamador, longe daqui.
 */
export function fail(
  code: ServiceErrorCode,
  message: string,
  extra: { permission?: string; issues?: string[] } = {},
): ServiceResult<never> {
  return { ok: false, error: { code, message, ...extra } };
}

/**
 * O que o autor de um serviço escreve.
 *
 * `run` só é chamado depois de a sessão existir, a permissão ter sido conferida
 * e a entrada ter sido validada — por isso ele recebe `Session` (não `null`) e a
 * entrada já no tipo do schema.
 */
export interface ServiceDefinition<Schema extends z.ZodType, Output> {
  /**
   * Identificador estável, em minúsculas com `_` (o mesmo formato das chaves de
   * permissão). É por este nome que a tool de MCP e o inventário de governança
   * se referem ao serviço, então trocá-lo é mudança de contrato, não renomeação.
   */
  name: string;
  /** Uma linha em português dizendo o que o serviço faz. Vira a descrição da tool. */
  summary: string;
  kind: ServiceKind;
  /**
   * A permissão do catálogo do App que este serviço exige, sem namespace
   * (`fechar_mes`), ou `null` para "não exige permissão" — e aí o nome precisa
   * estar declarado em `PUBLIC_SERVICES`. `null` é declaração, não omissão.
   */
  permission: string | null;
  /** Schema da entrada. Serviço sem entrada usa `z.object({})`. */
  input: Schema;
  run: (
    session: Session,
    input: z.output<Schema>,
  ) => Promise<ServiceResult<Output>> | ServiceResult<Output>;
}

/** O serviço pronto: a definição, mais o portão, exposto em `execute`. */
export interface Service<Schema extends z.ZodType, Output> {
  readonly name: string;
  readonly summary: string;
  readonly kind: ServiceKind;
  readonly permission: string | null;
  readonly input: Schema;
  execute(session: Session | null, input: unknown): Promise<ServiceResult<Output>>;
}

/**
 * Um serviço qualquer, para quem guarda ou percorre vários — o registro, os
 * testes e, mais tarde, o registro de tools. Sem os genéricos, que só interessam
 * a quem chama um serviço específico e conhece o tipo da resposta.
 */
export interface AnyService {
  readonly name: string;
  readonly summary: string;
  readonly kind: ServiceKind;
  readonly permission: string | null;
  readonly input: z.ZodType;
  execute(session: Session | null, input: unknown): Promise<ServiceResult<unknown>>;
}
