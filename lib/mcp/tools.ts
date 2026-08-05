/**
 * O registro das tools de MCP — o que um agente pode pedir a este App.
 *
 * ## A tool não decide nada
 *
 * Uma tool é um **adaptador**: ela dá nome e descrição a uma capacidade,
 * traduz a entrada que o agente mandou e chama um serviço de `lib/services/`.
 * Toda a regra — quem pode, o que é válido, o que acontece — está no serviço, e
 * é a mesma regra que a tela e a rota HTTP usam.
 *
 * O anti-padrão, dito com todas as letras porque é o risco central desta
 * arquitetura:
 *
 * > **Não reimplemente a regra na tool.** Nada de consultar o banco aqui, nada
 * > de conferir permissão aqui, nada de "só uma validação a mais" aqui. Uma tool
 * > com regra própria vira uma segunda implementação da mesma decisão, e as duas
 * > divergem na terceira mudança — sem dar erro, respondendo diferente para a
 * > mesma pergunta. Numa aplicação de reservas, é a tool marcar uma sala que a
 * > tela não deixaria marcar.
 *
 * Por isso `defineTool` não recebe um corpo para executar: recebe o **serviço**.
 * Não há onde escrever a regra de novo.
 *
 * ## Permissão e `kind` são do serviço, não da tool
 *
 * As duas coisas são **derivadas** do serviço, e não declaradas aqui. Declarar de
 * novo abriria a única porta que faltava para divergir: uma tool anunciada como
 * `read` que alcança um serviço que grava é exatamente a deriva que a governança
 * teria de descobrir depois. Derivando, ela não tem como existir.
 *
 * ## Uma tool nunca mistura leitura e escrita
 *
 * Quem opera o agente autoriza e pede aprovação **por tool**. Uma tool que
 * lesse e gravasse destruiria essa granularidade: liberar a leitura liberaria a
 * escrita junto, e nenhuma configuração de aprovação conseguiria separar depois.
 * Uma capacidade que lê e outra que grava são **duas** tools, sobre dois
 * serviços.
 */

import type { z } from "zod";

import type { Session } from "../auth/session";
import { ecoar } from "../services/eco";
import { getService } from "../services/index";
import { verDiagnostico, verPerfil } from "../services/painel";
import type { AnyService, ServiceKind, ServiceResult } from "../services/types";

/**
 * Marca de fábrica. Só `defineTool` a coloca, e o teste do registro exige que
 * ela esteja em toda tool registrada — é o que impede alguém de escrever um
 * objeto com a forma de tool, e um corpo próprio dentro, e registrá-lo aqui.
 */
export const TOOL_MARK: unique symbol = Symbol("volund.mcp.tool");

/** O que o autor de uma tool escreve. */
export interface ToolDefinition {
  /**
   * Nome pelo qual o agente chama a tool. Minúsculas com `_`, no vocabulário do
   * domínio (`publicar_aviso`), porque é isto que o agente lê para decidir.
   */
  name: string;
  /**
   * Descrição em português, para o agente — não para quem lê o código. Diga o
   * que a tool faz, quando usar e o que ela recusa. É o texto que decide se o
   * agente vai escolher esta tool ou tentar outra coisa.
   */
  description: string;
  /** O serviço que atende. É onde a regra mora. */
  service: AnyService;
  /**
   * Schema da entrada da TOOL, quando ela for diferente da do serviço — para
   * receber uma forma mais conversável e traduzir. Omitido, vale o schema do
   * próprio serviço, que é o caso comum.
   *
   * Traduzir a forma da entrada é trabalho de adaptador e pode acontecer aqui.
   * Decidir com base nela, não: quem decide é o serviço.
   */
  input?: z.ZodType;
  /**
   * Tradução da entrada da tool para a entrada do serviço. Só existe com
   * `input` próprio, e só pode **remapear** — nada de consultar banco, conferir
   * permissão ou escolher caminho por regra de negócio.
   */
  mapInput?: (input: unknown) => unknown;
}

export interface Tool {
  readonly [TOOL_MARK]: true;
  readonly name: string;
  readonly description: string;
  /** Derivado do serviço. A tool não tem opinião própria sobre isto. */
  readonly kind: ServiceKind;
  /** Derivada do serviço. `null` é "não exige permissão", declarado. */
  readonly permission: string | null;
  /** O schema que o agente vê. */
  readonly input: z.ZodType;
  readonly service: AnyService;
  /** Chama o serviço. Não há mais nada aqui, e é esse o ponto. */
  call(session: Session | null, input: unknown): Promise<ServiceResult<unknown>>;
}

const NOME_VALIDO = /^[a-z][a-z0-9_.-]{0,62}$/;

/**
 * Monta a tool a partir da definição.
 *
 * As recusas acontecem na importação do módulo, e não em tempo de chamada: uma
 * tool malformada descoberta pelo agente no meio de uma conversa é bem mais
 * caro de diagnosticar do que um erro na subida.
 */
export function defineTool(definition: ToolDefinition): Tool {
  const { name, description, service } = definition;

  if (!NOME_VALIDO.test(name)) {
    throw new Error(
      `tool "${name}": o nome precisa casar com ${String(NOME_VALIDO)} — minúsculas, começando por letra.`,
    );
  }
  if (description.trim().length < 10) {
    throw new Error(
      `tool "${name}": a descrição é para o agente decidir quando usar a tool. Uma linha de verdade, não um rótulo.`,
    );
  }
  // A identidade importa: um serviço equivalente mas não registrado ficaria fora
  // do inventário, e a superfície declarada descreveria um App que não é este.
  if (getService(service.name) !== service) {
    throw new Error(
      `tool "${name}": o serviço "${service.name}" não é o que está registrado em lib/services/index.ts. ` +
        `Registre o serviço lá — é de onde a superfície declarada sai.`,
    );
  }
  if (definition.mapInput && !definition.input) {
    throw new Error(
      `tool "${name}": mapInput só faz sentido com um schema de entrada próprio.`,
    );
  }

  const input = definition.input ?? service.input;
  const mapInput = definition.mapInput;

  return {
    [TOOL_MARK]: true,
    name,
    description,
    kind: service.kind,
    permission: service.permission,
    input,
    service,

    call(session, raw) {
      // Sem `try`, sem checagem de permissão, sem consulta ao banco: o serviço
      // faz tudo isso, e é o mesmo caminho da tela e da rota. Se algum dia
      // aparecer um `if` aqui decidindo alguma coisa, ele está no lugar errado.
      return service.execute(session, mapInput ? mapInput(raw) : raw);
    },
  };
}

/**
 * Tools de EXEMPLO, uma de cada serviço do painel.
 *
 * As duas são `read` porque os serviços de exemplo são de leitura. Numa
 * aplicação de verdade, `ler_avisos` e `publicar_aviso` são tools separadas,
 * sobre serviços separados — ver o comentário no topo do arquivo.
 */
export const TOOLS: Readonly<Record<string, Tool>> = Object.freeze(
  Object.fromEntries(
    [
      defineTool({
        name: "ver_perfil",
        description:
          "Mostra quem está falando com este App: nome, e-mail, papéis e permissões concedidas. Use para saber em nome de quem você está agindo antes de tentar uma ação restrita.",
        service: verPerfil,
      }),
      defineTool({
        name: "ver_diagnostico",
        description:
          "Mostra os detalhes técnicos da instalação deste App (identificadores e se o banco está configurado). Exige permissão; use quando precisar conferir o ambiente antes de investigar um problema.",
        service: verDiagnostico,
      }),
      defineTool({
        name: "ecoar",
        description:
          "Repete de volta a mensagem que você mandar, até cinco vezes. Serve para conferir que a conexão com este App está funcionando antes de tentar algo que muda dado.",
        service: ecoar,
      }),
    ].map((tool) => [tool.name, tool]),
  ),
);

/**
 * A tool com este nome, ou `undefined`.
 *
 * `Object.hasOwn` pelo mesmo motivo de `getService`: o nome vem de fora — é o
 * agente quem manda —, e sem a checagem `getTool("toString")` devolveria a
 * função herdada do protótipo, que passa por qualquer teste de "achou?".
 */
export function getTool(name: string): Tool | undefined {
  return Object.hasOwn(TOOLS, name) ? TOOLS[name] : undefined;
}
