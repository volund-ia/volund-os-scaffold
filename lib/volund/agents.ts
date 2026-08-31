/**
 * O canal com os agentes que ESTE App oferece a quem usa a aplicação
 * (contrato 8).
 *
 * ## O que muda em relação a guardar uma chave de API
 *
 * O jeito antigo de um App conversar com um agente era guardar uma chave
 * `vos_live_…` no ambiente e chamar a plataforma com ela. O custo é invisível
 * até doer: **toda** conversa de **todo** usuário roda em nome do dono da chave.
 * A conversa é dele, o consumo é dele, e o histórico diz que foi ele — não a
 * pessoa que digitou.
 *
 * Aqui não há chave. Quem está usando a aplicação entrou com uma sessão que a
 * própria plataforma emitiu, e é essa identidade que segue adiante: o servidor
 * deste App **troca** o token da sessão por um token de plataforma que continua
 * dizendo quem é a pessoa, e acrescenta "através deste App". A conversa nasce
 * dela, o consumo é dela, e o histórico conta a verdade.
 *
 * A troca é a RFC 8693, e ela é um ato do SERVIDOR: acontece autenticada com o
 * segredo do App, que nunca sai daqui.
 *
 * ## Três regras que não valem a pena descobrir de novo
 *
 * 1. **O token trocado nunca chega ao navegador.** Ele autoriza disparar
 *    agentes na plataforma; entregá-lo ao cliente seria entregar essa
 *    autorização a quem abrir o inspetor. Por isso as telas falam com as rotas
 *    de `app/api/volund/`, e são elas que falam com a plataforma.
 * 2. **O roteiro vem em tempo de execução, não de variável de ambiente.**
 *    Variável só muda no próximo deploy; vincular um agente no painel precisa
 *    aparecer aqui sem republicar nada. É por isso que o contrato 8 não
 *    acrescenta nenhuma variável obrigatória.
 * 3. **O endereço é o apelido, não o identificador.** A aplicação diz
 *    `"suporte"`, e não um identificador que muda entre ambientes e que ninguém
 *    consegue ler.
 */

import { VolundOS } from "@volund-ia/sdk";
import { z } from "zod";

import { readAuthConfig, type AuthConfig } from "@/lib/auth/config";
import { loadDiscovery } from "@/lib/auth/discovery";
import { readExpiryWithoutVerifying } from "@/lib/auth/jwt";
import { basicAuthHeader, type Session } from "@/lib/auth/session";

/**
 * Os quatro valores do pedido de troca. São contrato com a plataforma, e estão
 * espelhados em `contracts/agent-channel.json` — mudar um aqui sem mudar lá
 * derruba o teste antes de derrubar o chat de alguém.
 */
export const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
export const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
export const AGENTS_RUN_SCOPE = "volund.agents.run";
export const PLATFORM_API_PATH = "/api/v1";

/**
 * Builds the platform API resource URL for token exchange.
 *
 * @param issuer - The platform issuer URL
 * @returns The issuer URL with the platform API path appended
 */
export function platformApiResource(issuer: string): string {
  return new URL(PLATFORM_API_PATH, issuer).toString();
}

/** Um agente ofertado, como a aplicação o enxerga. */
export interface AppAgent {
  /** O endereço estável. É por ele que a tela e o código pedem o agente. */
  key: string;
  name: string;
  description: string | null;
  /**
   * O **slug** da ilustração (`"assistant"`), e não um endereço de imagem. Quem
   * sabe desenhá-lo é o painel do VolundOS; aqui ele não resolve para nada.
   * Tratá-lo como URL rende uma imagem quebrada.
   */
  avatar: string | null;
  isDefault: boolean;
}

/**
 * Falha do canal, com o motivo separado da mensagem.
 *
 * `sem_agente` não é defeito: é o App que ainda não teve nenhum agente
 * vinculado, e a tela precisa dizer isso com todas as letras em vez de mostrar
 * "algo deu errado". Confundir os dois faz quem configurou procurar erro onde
 * não há.
 */
export type AgentChannelErrorCode = "sem_agente" | "indisponivel";

export class AgentChannelError extends Error {
  readonly code: AgentChannelErrorCode;

  constructor(
    code: AgentChannelErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AgentChannelError";
    this.code = code;
  }
}

const NENHUM_AGENTE =
  "Este app ainda não oferece nenhum agente. Vincule um na aba Agentes do painel do app, no VolundOS.";
const INDISPONIVEL =
  "Não consegui falar com o VolundOS agora. Tente de novo em alguns instantes.";

/**
 * Teto de espera para as chamadas ao provedor. O mesmo valor de
 * `lib/auth/session.ts`, e pelo mesmo motivo: `fetch` não tem timeout por
 * default, e estas chamadas estão no caminho de uma tela que alguém está
 * olhando.
 *
 * Vale para a troca e para o roteiro — **não** para o streaming da conversa,
 * que dura o tempo do agente pensar e é governado pelo SDK.
 */
const PROVIDER_TIMEOUT_MS = 5_000;

/**
 * Renova a troca quando falta menos que isto. Mesma folga da sessão: sem ela,
 * uma conversa que começa no último segundo de vida do token seria disparada
 * com um token que expira no meio dela.
 */
const EXCHANGE_SKEW_SECONDS = 60;

/**
 * Quantos tokens trocados o processo guarda.
 *
 * Um mapa sem teto é um vazamento com passo lento: uma instância de vida longa
 * atendendo muita gente acumula uma entrada por pessoa e nunca devolve nada. O
 * teto transforma isso num custo fixo — e quando ele é atingido, o que sai é a
 * entrada mais antiga, que é a que tem mais chance de já estar vencida.
 */
const TOKEN_CACHE_MAX = 500;

interface CachedToken {
  token: string;
  /** Instante (em segundos) a partir do qual esta entrada não serve mais. */
  usableUntil: number;
}

const tokenCache = new Map<string, CachedToken>();

/** Clears the agent channel token and roster caches for test isolation. */
export function resetAgentChannelCacheForTests(): void {
  tokenCache.clear();
  rosterCache = null;
}

interface TokenExchangeResponse {
  access_token?: string;
  expires_in?: number;
  issued_token_type?: string;
  error?: string;
  error_description?: string;
}

/**
 * Exchanges the authenticated session token for a platform access token.
 *
 * @param session - The authenticated user session whose identity is preserved
 * @param config - Authentication configuration for the platform issuer
 * @returns The exchanged platform access token
 * @throws `AgentChannelError` if no agent is configured or the provider is unavailable
 */
export async function exchangeForPlatformToken(
  session: Session,
  config: AuthConfig = readAuthConfig(),
  now: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const cacheKey = `${session.orgId}:${session.userId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.usableUntil > now) return cached.token;

  const discovery = await loadDiscovery(config.issuer);

  let response: Response;
  try {
    response = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: basicAuthHeader(config),
        accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: TOKEN_EXCHANGE_GRANT,
        subject_token: session.accessToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        requested_token_type: ACCESS_TOKEN_TYPE,
        resource: platformApiResource(config.issuer),
        scope: AGENTS_RUN_SCOPE,
      }).toString(),
      // Mesma razão do token endpoint da sessão: a resposta carrega credencial,
      // e qualquer camada que a guardasse entregaria a identidade ao próximo.
      cache: "no-store",
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AgentChannelError("indisponivel", INDISPONIVEL, { cause: err });
  }

  const data = (await response.json().catch(() => ({}))) as TokenExchangeResponse;

  if (!response.ok || data.error) {
    // `invalid_target` é a recusa NOMEADA de "este app não oferece agente
    // nenhum". Ela chega aqui na primeira tentativa, e não como um 403 sobre um
    // agente que a aplicação nunca escolheu — que é o que aconteceria se a
    // plataforma deixasse a troca passar com a lista vazia.
    if (data.error === "invalid_target") {
      throw new AgentChannelError("sem_agente", NENHUM_AGENTE);
    }
    // A descrição vem do provedor e não carrega o segredo (ele nunca aparece na
    // resposta). Vai para o log de quem opera; para a tela vai o genérico.
    console.error(
      `[volund] troca de token recusada: ${data.error ?? response.status} ${data.error_description ?? ""}`.trim(),
    );
    throw new AgentChannelError("indisponivel", INDISPONIVEL);
  }

  const token = data.access_token;
  if (!token) {
    console.error("[volund] troca de token respondeu sem `access_token`");
    throw new AgentChannelError("indisponivel", INDISPONIVEL);
  }

  // O `exp` do próprio token manda; `expires_in` é a estimativa do provedor e o
  // relógio daqui pode divergir do dele. Mesma decisão de `toPayload`.
  const exp = readExpiryWithoutVerifying(token) ?? now + (data.expires_in ?? 600);
  rememberToken(cacheKey, { token, usableUntil: exp - EXCHANGE_SKEW_SECONDS });
  return token;
}

/**
 * Stores a token in the cache and evicts the least recently used entry when the cache exceeds its limit.
 */
function rememberToken(key: string, entry: CachedToken): void {
  tokenCache.delete(key);
  tokenCache.set(key, entry);
  // `Map` itera na ordem de inserção, e o `delete` acima reinsere a entrada
  // renovada no fim — então o primeiro item é sempre o menos recente.
  while (tokenCache.size > TOKEN_CACHE_MAX) {
    const oldest = tokenCache.keys().next();
    if (oldest.done) break;
    tokenCache.delete(oldest.value);
  }
}

/**
 * A forma do roteiro, conferida em vez de presumida.
 *
 * Vem da plataforma e não de um cliente, mas a validação não é sobre confiança:
 * é sobre a divergência silenciosa entre as duas pontas de um contrato. Sem ela,
 * um campo renomeado do outro lado chega como `undefined` e a tela mostra um
 * agente sem nome, sem erro nenhum.
 */
const rosterSchema = z.object({
  agents: z.array(
    z.object({
      key: z.string().min(1),
      agent_id: z.string().min(1),
      name: z.string(),
      description: z.string().nullable().optional(),
      avatar: z.string().nullable().optional(),
      is_default: z.boolean(),
    }),
  ),
});

/**
 * Quanto tempo o roteiro fica em cache.
 *
 * Curto de propósito: vincular um agente no painel precisa aparecer na
 * aplicação sem republicar, e um minuto é o atraso máximo disso. Longo o
 * bastante para uma tela que recarrega não virar uma chamada por navegação.
 */
const ROSTER_TTL_MS = 60_000;

interface Roster {
  /** O que a tela recebe. Sem identificador — ver `identificadores` abaixo. */
  agents: AppAgent[];
  /** Apelido → identificador do agente. **Só do lado do servidor.** */
  ids: Map<string, string>;
}

interface CachedRoster extends Roster {
  fetchedAt: number;
}

/**
 * Cache do processo, e NÃO por usuário: o roteiro é do App, igual para todo
 * mundo. A plataforma o lê com a credencial dela justamente para que ele não
 * varie conforme quem pergunta — guardá-lo por pessoa multiplicaria as chamadas
 * sem mudar nenhuma resposta.
 */
let rosterCache: CachedRoster | null = null;

/**
 * Loads and caches the App's configured agent roster, including server-side platform identifiers.
 *
 * @returns The loaded roster of agents and their platform identifier mappings.
 */
async function loadRoster(
  session: Session,
  config: AuthConfig,
  now: number = Date.now(),
): Promise<Roster> {
  if (rosterCache && now - rosterCache.fetchedAt < ROSTER_TTL_MS) return rosterCache;

  const token = await exchangeForPlatformToken(session, config);

  let response: Response;
  try {
    response = await fetch(new URL("/api/v1/apps/me/agents", config.issuer), {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AgentChannelError("indisponivel", INDISPONIVEL, { cause: err });
  }

  if (!response.ok) {
    console.error(`[volund] roteiro de agentes respondeu ${response.status}`);
    throw new AgentChannelError("indisponivel", INDISPONIVEL);
  }

  const parsed = rosterSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    console.error("[volund] roteiro de agentes em formato inesperado");
    throw new AgentChannelError("indisponivel", INDISPONIVEL);
  }

  const agents: AppAgent[] = parsed.data.agents.map((a) => ({
    key: a.key,
    name: a.name,
    description: a.description ?? null,
    avatar: a.avatar ?? null,
    isDefault: a.is_default,
  }));

  // Lista vazia é o mesmo estado que a troca recusa com `invalid_target`, e
  // merece a mesma frase. Ela pode acontecer na janela entre desvincular o
  // último agente e o token em cache expirar.
  if (agents.length === 0) throw new AgentChannelError("sem_agente", NENHUM_AGENTE);

  const ids = new Map(parsed.data.agents.map((a) => [a.key, a.agent_id]));
  rosterCache = { agents, ids, fetchedAt: now };
  return { agents, ids };
}

/**
 * Lists the agents currently configured for the App.
 *
 * @returns The configured App agents.
 */
export async function listAppAgents(
  session: Session,
  config: AuthConfig = readAuthConfig(),
  now: number = Date.now(),
): Promise<AppAgent[]> {
  const { agents } = await loadRoster(session, config, now);
  return agents;
}

/**
 * Selects an App agent by key or chooses the configured default agent.
 *
 * @param agents - The available App agents
 * @param key - The requested agent key, or `null` or `undefined` to use the default
 * @returns The selected agent, or `null` when the requested key is unavailable or no agents exist
 */
export function selectAgent(agents: AppAgent[], key?: string | null): AppAgent | null {
  if (key) return agents.find((a) => a.key === key) ?? null;
  return agents.find((a) => a.isDefault) ?? agents[0] ?? null;
}

/**
 * Resolves an App-facing agent key to the platform identifier selected from the configured roster.
 *
 * @param key - The App-facing agent key to select, or `null` to use the default agent.
 * @returns The selected agent and its server-side platform identifier.
 * @throws `AgentChannelError` if no agent is available or the selected agent cannot be resolved.
 */
export async function resolveAgentId(
  session: Session,
  key: string | null,
  config: AuthConfig = readAuthConfig(),
): Promise<{ agent: AppAgent; agentId: string }> {
  const { agents, ids } = await loadRoster(session, config);
  const agent = selectAgent(agents, key);
  if (!agent) {
    throw new AgentChannelError(
      "sem_agente",
      `Este app não oferece nenhum agente chamado "${key}".`,
    );
  }
  const agentId = ids.get(agent.key);
  if (!agentId) throw new AgentChannelError("indisponivel", INDISPONIVEL);
  return { agent, agentId };
}

/**
 * Creates an SDK client authenticated as the current user.
 *
 * @param session - The authenticated user session
 * @param config - Authentication configuration used to exchange the session token and set the API base URL
 * @returns An authenticated `VolundOS` client
 */
export async function volundFor(
  session: Session,
  config: AuthConfig = readAuthConfig(),
): Promise<VolundOS> {
  return new VolundOS({
    apiKey: await exchangeForPlatformToken(session, config),
    baseUrl: config.issuer,
    // `run`/`continue` não são idempotentes: um 5xx pode ter criado a conversa
    // mesmo assim, e retentar duplicaria. O default do SDK já é 0; declarar
    // deixa a decisão visível para quem for mexer.
    maxRetries: 0,
  });
}
