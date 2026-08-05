/**
 * `defineService` — o portão que todo serviço atravessa antes de decidir
 * qualquer coisa.
 *
 * ## Por que o portão é aqui, e não dentro de cada serviço
 *
 * A regra é "todo serviço protegido consulta `can()`, de leitura tanto quanto de
 * escrita". Escrita à mão, essa linha é lembrada nos três primeiros serviços e
 * esquecida no quarto — e o sintoma de esquecer é **ausência** de erro: o serviço
 * funciona, para todo mundo. Aqui a consulta acontece uma vez, no caminho por
 * onde todos passam, e "esquecer" deixa de ser possível: o que se declara é a
 * permissão, e quem confere é este arquivo.
 *
 * O serviço que precise de uma checagem a mais — por registro, por dono — chama
 * `can()` dentro de `run` normalmente. O portão é o piso, não o teto.
 *
 * ## A ordem das checagens não é cosmética
 *
 * Sessão → permissão → entrada. Validar a entrada antes da permissão devolveria
 * a quem não pode chamar o serviço um mapa dos campos que ele aceita, que é
 * informação sobre o desenho interno do App para quem não tem acesso a ele.
 *
 * ## Erro interno não conta o que aconteceu
 *
 * A exceção que escapar de `run` é registrada com `console.error` (o provedor de
 * deploy coleta) e devolvida como `internal` com mensagem genérica. A mensagem do
 * driver de banco carrega host, porta e configuração de conexão, e o resultado do
 * serviço chega a quem chamou de fora.
 */

import type { z } from "zod";

import { can } from "../auth/permissions";
import type { Session } from "../auth/session";
import { isPublicService } from "./policy";
import {
  fail,
  formatIssues,
  type Service,
  type ServiceDefinition,
  type ServiceResult,
} from "./types";

/**
 * O formato das chaves de permissão e dos nomes de serviço, igual ao que a
 * plataforma exige no catálogo do App.
 *
 * Não é preciosismo: a chave vira namespaced (`app:<id>:<chave>`) do lado da
 * plataforma, e um `:` ou um espaço no meio corrompe o namespace. O efeito de um
 * namespace corrompido é uma permissão que nunca casa com nada — isto é, uma
 * ação que ninguém consegue executar e cuja causa não aparece em lugar nenhum.
 */
const CHAVE_VALIDA = /^[a-z][a-z0-9_.-]{0,62}$/;

/**
 * Transforma a definição no serviço pronto.
 *
 * Os erros de definição são lançados **na importação do módulo**, e isso é
 * deliberado: uma permissão escrita como `"Fechar Mês"` não daria erro nenhum —
 * ela simplesmente nunca casaria com a permissão concedida, e a ação ficaria
 * bloqueada para todo mundo sem nenhuma pista do motivo. Falhar alto, na hora, é
 * mais barato.
 */
export function defineService<Schema extends z.ZodType, Output>(
  definition: ServiceDefinition<Schema, Output>,
): Service<Schema, Output> {
  const { name, permission } = definition;

  if (!CHAVE_VALIDA.test(name)) {
    throw new Error(
      `serviço "${name}": o nome precisa casar com ${String(CHAVE_VALIDA)} — minúsculas, começando por letra.`,
    );
  }

  if (!definition.summary.trim()) {
    throw new Error(
      `serviço "${name}": falta o resumo. Ele vira a descrição da tool, e uma tool sem descrição o agente não sabe quando usar.`,
    );
  }

  if (permission === null) {
    if (!isPublicService(name)) {
      throw new Error(
        `serviço "${name}" não exige permissão, mas não está declarado em PUBLIC_SERVICES (lib/services/policy.ts). ` +
          `Ou declare o nome lá, com o motivo ao lado, ou informe a permissão que ele exige.`,
      );
    }
  } else {
    if (!CHAVE_VALIDA.test(permission)) {
      throw new Error(
        `serviço "${name}": a permissão "${permission}" não casa com ${String(CHAVE_VALIDA)}. ` +
          `Chave sem namespace, minúscula (ex.: "fechar_mes").`,
      );
    }
    if (isPublicService(name)) {
      throw new Error(
        `serviço "${name}" exige a permissão "${permission}" e ao mesmo tempo está em PUBLIC_SERVICES. ` +
          `As duas declarações se contradizem: remova o nome da lista ou tire a permissão.`,
      );
    }
  }

  return {
    name,
    summary: definition.summary,
    kind: definition.kind,
    permission,
    input: definition.input,

    async execute(
      session: Session | null,
      input: unknown,
    ): Promise<ServiceResult<Output>> {
      if (!session) {
        return fail("unauthenticated", "É preciso estar autenticado.");
      }

      if (permission !== null && !can(session, permission)) {
        return fail("forbidden", "Você não tem permissão para esta ação.", {
          permission,
        });
      }

      const parsed = definition.input.safeParse(input);
      if (!parsed.success) {
        // `formatIssues` é o mesmo formato de `lib/validation.ts` (caminho +
        // mensagem por campo), escrito aqui em vez de importado dali porque
        // aquele módulo é a fronteira HTTP, e esta camada não depende dela — é o
        // que mantém o serviço utilizável por qualquer porta.
        return fail("invalid_input", "Dados inválidos.", {
          issues: formatIssues(parsed.error),
        });
      }

      try {
        return await definition.run(session, parsed.data as z.output<Schema>);
      } catch (erro) {
        console.error(`[serviço ${name}] falhou:`, erro);
        return fail("internal", "Não foi possível concluir a operação.");
      }
    },
  };
}
