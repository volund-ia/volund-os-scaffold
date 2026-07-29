/**
 * Tipos compartilhados da aplicação.
 *
 * A convenção: tipo usado por mais de um módulo vive aqui; tipo usado só dentro
 * de um arquivo fica nele. O objetivo é ter um lugar previsível para procurar,
 * em vez de o mesmo formato de dado ser redeclarado em três telas.
 *
 * Tipos de linha do banco também entram aqui, nomeados pela tabela.
 */

/** Resultado padrão de operação que pode falhar sem ser exceção. */
export type Result<T, E = string> = { ok: true; data: T } | { ok: false; error: E };
