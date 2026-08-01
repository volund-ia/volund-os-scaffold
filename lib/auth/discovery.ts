/**
 * Descoberta OIDC e JWKS, com cache.
 *
 * Os endereços dos endpoints **não** são escritos à mão aqui: vêm do documento
 * de descoberta do provedor. É o que permite a plataforma mudar um endpoint sem
 * quebrar todo App já publicado.
 *
 * O cache é de processo, sem coordenação entre instâncias. É proposital: cada
 * instância que esquenta paga uma requisição, e o custo de errar para o lado da
 * simplicidade aqui é baixo — o documento e as chaves mudam raramente e o
 * provedor manda `cache-control` compatível.
 */

import type { PublicJwk } from "./jwt";

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  revocation_endpoint?: string;
}

/** Cinco minutos, o mesmo que o provedor anuncia no `cache-control`. */
const DISCOVERY_TTL_MS = 5 * 60 * 1000;
/** Chaves mudam por rotação, e a chave nova é publicada antes de ser usada. */
const JWKS_TTL_MS = 10 * 60 * 1000;
/**
 * Piso entre buscas forçadas por `kid` desconhecido. Sem ele, um token com
 * `kid` inventado viraria uma requisição ao provedor **por tentativa** — quem
 * quisesse derrubar a autenticação de um App teria como.
 */
const JWKS_REFETCH_FLOOR_MS = 30 * 1000;

interface Cached<T> {
  value: T;
  fetchedAt: number;
}

const discoveryCache = new Map<string, Cached<Discovery>>();
const jwksCache = new Map<string, Cached<PublicJwk[]>>();

async function fetchJson(url: string, what: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${what} respondeu ${response.status} em ${url}`);
  }
  return response.json();
}

/**
 * Documento de descoberta do provedor.
 *
 * O `issuer` que volta é conferido contra o configurado: se um DNS
 * comprometido apontasse a descoberta para outro provedor, o documento traria
 * outro emissor — e aceitar isso significaria validar tokens contra as chaves
 * de quem interceptou.
 */
export async function loadDiscovery(
  issuer: string,
  now = Date.now(),
): Promise<Discovery> {
  const cached = discoveryCache.get(issuer);
  if (cached && now - cached.fetchedAt < DISCOVERY_TTL_MS) return cached.value;

  const doc = (await fetchJson(
    `${issuer}/.well-known/openid-configuration`,
    "descoberta OIDC",
  )) as Discovery;

  if (doc.issuer !== issuer) {
    throw new Error(`descoberta declara emissor ${doc.issuer}, esperado ${issuer}`);
  }
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new Error("descoberta OIDC incompleta: falta endpoint obrigatório");
  }

  discoveryCache.set(issuer, { value: doc, fetchedAt: now });
  return doc;
}

/**
 * Chaves públicas do provedor.
 *
 * `wantedKid` força a rebusca quando o token traz uma chave que o cache não
 * conhece — é o que faz a rotação chegar sem esperar o TTL expirar.
 */
export async function loadJwks(
  issuer: string,
  options: { wantedKid?: string; now?: number } = {},
): Promise<PublicJwk[]> {
  const now = options.now ?? Date.now();
  const cached = jwksCache.get(issuer);

  const fresh = cached && now - cached.fetchedAt < JWKS_TTL_MS;
  const missingWanted =
    options.wantedKid !== undefined &&
    cached !== undefined &&
    !cached.value.some((key) => key.kid === options.wantedKid);
  const mayRefetch = !cached || now - cached.fetchedAt >= JWKS_REFETCH_FLOOR_MS;

  if (cached && fresh && !(missingWanted && mayRefetch)) return cached.value;

  const discovery = await loadDiscovery(issuer, now);

  let keys: PublicJwk[];
  try {
    const body = (await fetchJson(discovery.jwks_uri, "JWKS")) as {
      keys?: PublicJwk[];
    };
    keys = Array.isArray(body.keys) ? body.keys : [];
  } catch (err) {
    // Provedor fora do ar com cache quente: seguir com as chaves antigas é
    // melhor que derrubar todas as sessões do App. Sem cache, não há o que
    // servir e o erro sobe.
    if (cached) return cached.value;
    throw err;
  }

  jwksCache.set(issuer, { value: keys, fetchedAt: now });
  return keys;
}

/** Só para teste: zera o cache entre casos. */
export function resetDiscoveryCacheForTests(): void {
  discoveryCache.clear();
  jwksCache.clear();
}
