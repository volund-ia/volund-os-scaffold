/**
 * Checagem de permissão — negação por default.
 *
 * ## Leia isto antes de proteger uma tela com `can()`
 *
 * O catálogo de permissões por App ainda **não existe** na plataforma (é a fase
 * seguinte desta mudança). Enquanto ele não existir, o provedor emite todo token
 * com `roles: []` e `permissions: []` — de propósito: inventar um papel implícito
 * ("é membro da organização, logo é administrador do App") faria a baseline da
 * organização vazar para dentro do App, que é exatamente o que o modelo recusa.
 *
 * Consequência prática, e a razão deste aviso ficar aqui em cima:
 *
 * > **Hoje `can()` devolve `false` para qualquer permissão.** Um limite protegido
 * > por `can("algo")` nega TODO MUNDO, inclusive quem criou o App.
 *
 * O portão desta camada é a **sessão**: estar autenticado, com token desta
 * audiência, na organização dona do App. É isso que `guard()` verifica e é isso
 * que protege as rotas por default. `can()` está pronto para quando as
 * concessões existirem, e é o que evita que cada App invente um modelo de papéis
 * próprio nesse dia — mas usá-lo agora tranca a porta com a chave do lado de
 * fora.
 */

import type { Session } from "./session";

/**
 * O usuário tem a permissão?
 *
 * Negação por default: permissão que não está declarada na sessão é permissão
 * que não foi concedida. A ausência nunca é interpretada como liberação.
 */
export function can(session: Session | null, permission: string): boolean {
  if (!session || !permission) return false;
  return session.permissions.includes(permission);
}

/** O usuário tem o papel? Mesma regra: ausência é negação. */
export function hasRole(session: Session | null, role: string): boolean {
  if (!session || !role) return false;
  return session.roles.includes(role);
}

/**
 * Esconder um elemento de interface **não é** proteção.
 *
 * Existe para deixar o par explícito no código: onde houver `hideUnless`, tem de
 * haver a mesma checagem no servidor, no limite que a ação atravessa. Quem chama
 * a API direto, sem passar pela tela, nunca viu o elemento escondido.
 */
export function hideUnless(session: Session | null, permission: string): boolean {
  return !can(session, permission);
}
