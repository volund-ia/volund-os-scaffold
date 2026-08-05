/**
 * O registro dos serviços da aplicação.
 *
 * Um serviço que não esteja aqui continua funcionando para quem o importar
 * direto — o registro não é o portão. Ele existe para que dê para **percorrer** a
 * regra de negócio deste App: é o que permite ao teste conferir que nenhum
 * serviço ficou sem permissão nem sem declaração, e é a lista de onde as tools de
 * MCP saem.
 *
 * Serviço novo entra aqui na mesma mudança em que nasce.
 */

import { verDiagnostico, verPerfil } from "./painel";
import type { AnyService } from "./types";

export const SERVICES: Readonly<Record<string, AnyService>> = Object.freeze({
  [verPerfil.name]: verPerfil,
  [verDiagnostico.name]: verDiagnostico,
});

/**
 * O serviço com este nome, ou `undefined`.
 *
 * O `Object.hasOwn` não é zelo: a busca é por um nome que vem de **fora** — a
 * rota e, adiante, a tool chamada pelo agente pedem o serviço pelo nome que
 * receberam. Sem ele, `getService("toString")` devolveria a função herdada de
 * `Object.prototype`, que passa por qualquer teste de "achou?" e estoura no
 * `execute` que não existe. O tipo diz `undefined`; a função tem de cumprir.
 */
export function getService(name: string): AnyService | undefined {
  return Object.hasOwn(SERVICES, name) ? SERVICES[name] : undefined;
}

export { defineService } from "./define";
export { isPublicService, PUBLIC_SERVICES } from "./policy";
export { fail, ok } from "./types";
export type {
  AnyService,
  Service,
  ServiceDefinition,
  ServiceError,
  ServiceErrorCode,
  ServiceKind,
  ServiceResult,
} from "./types";
