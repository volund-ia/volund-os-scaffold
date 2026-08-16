/**
 * Configuração da autenticação — os três valores que a plataforma injeta, e os
 * caminhos que o contrato do scaffold fixa.
 *
 * Os caminhos são constantes e não configuráveis de propósito. O `redirect_uri`
 * registrado no provedor é derivado pela plataforma a partir dos endereços que
 * ela controla, sempre com este caminho no fim, e a conferência do lado de lá é
 * por **igualdade exata** (RFC 9700). Um callback em outro caminho não dá erro
 * de compilação: dá `invalid redirect_uri` na primeira tentativa de entrar, que
 * é bem mais caro de diagnosticar.
 */

/** Onde o provedor devolve o usuário. Fixo por contrato — não mova. */
export const AUTH_CALLBACK_PATH = "/api/auth/callback";

/** Início do fluxo. Público: quem chega aqui ainda não tem sessão. */
export const AUTH_LOGIN_PATH = "/api/auth/login";

/** Encerramento. NÃO é público: sem sessão não há o que encerrar. */
export const AUTH_LOGOUT_PATH = "/api/auth/logout";

/** O endpoint MCP deste App. É ele o "recurso" que o metadado abaixo descreve. */
export const MCP_PATH = "/api/mcp";

/**
 * Onde este App descreve a si mesmo como recurso protegido (RFC 9728).
 *
 * É o começo do fluxo padrão de autorização do MCP: o cliente bate no endpoint,
 * toma 401, lê o `resource_metadata` do `WWW-Authenticate`, busca este documento
 * e descobre por ele qual é o servidor de autorização. Sem este caminho — ou com
 * ele atrás do portão de cookie — o cliente não descobre nada, e o erro que ele
 * mostra fala do App em vez da descoberta.
 *
 * Fixo por contrato, como os caminhos de autenticação acima: quem o define é a
 * spec, não nós.
 */
export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

/** Cookie da sessão selada. */
export const SESSION_COOKIE = "volund_session";

/**
 * Cookie efêmero do aperto de mão: guarda `state`, `nonce`, o verificador do
 * PKCE e para onde voltar. Vive entre o `/api/auth/login` e o callback, e é
 * apagado assim que o código é trocado.
 */
export const HANDSHAKE_COOKIE = "volund_auth_handshake";

/** Dez minutos: o tempo de completar um login, não o de uma sessão. */
export const HANDSHAKE_TTL_SECONDS = 10 * 60;

/**
 * Escopos pedidos. `openid` é obrigatório no provedor; `volund.permissions` é o
 * que traz os claims de autorização (`roles`/`permissions`) do catálogo do App.
 * `profile` e `email` são o que fazem `session.name` e `session.email` chegarem
 * preenchidos — o provedor usa o escopo como portão, e sem eles os claims não
 * saem.
 */
export const AUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "volund.permissions",
] as const;

export interface AuthConfig {
  /** Origem do provedor de identidade, sem barra final. */
  issuer: string;
  clientId: string;
  /** **Exclusivo do servidor.** Nunca prefixe com `NEXT_PUBLIC_`, nunca logue. */
  clientSecret: string;
  /**
   * Quem é ESTE App, como recurso (contrato 6).
   *
   * Não é segredo — é o mesmo id que viaja no claim `app_id` de todo token. O
   * que ele tem de especial é vir de **fora do token**: é sobre ele que a
   * audiência do access token é conferida, e sem ele a conferência só podia ser
   * feita contra o próprio token, o que não separa nada. Ver `verifyAccessToken`
   * em `./jwt.ts`.
   */
  appId: string;
}

/**
 * Falta de configuração é erro nomeado, não erro genérico.
 *
 * O requisito é explícito: sem as variáveis o App falha dizendo **qual** falta,
 * e não degrada para acesso aberto. Uma classe própria permite ao `proxy.ts`
 * distinguir "não está configurado" (responde 503 explicando) de "deu ruim"
 * (responde 500 sem detalhe).
 */
export class MissingAuthEnvError extends Error {
  readonly variable: string;

  constructor(variable: string) {
    super(
      `Variável de ambiente ${variable} não definida. No VolundOS ela é injetada pela plataforma quando o App é criado; se você está rodando fora dele, copie .env.example para .env.local e preencha.`,
    );
    this.name = "MissingAuthEnvError";
    this.variable = variable;
  }
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value || value.trim() === "") throw new MissingAuthEnvError(name);
  return value.trim();
}

/**
 * Lê e valida a configuração. Preguiçosa (não roda no import) pelo mesmo motivo
 * de `lib/env.ts`: durante o `next build` as variáveis podem não existir ainda,
 * e um módulo que estoura no import quebraria o build antes de a aplicação
 * existir.
 *
 * O issuer é normalizado para a **origem** porque ele entra no claim `iss` e é
 * comparado por igualdade exata: `https://x` e `https://x/` seriam dois
 * emissores diferentes, e a divergência só apareceria como token recusado.
 */
export function readAuthConfig(
  env: Record<string, string | undefined> = process.env,
): AuthConfig {
  const rawIssuer = required(env, "VOLUND_OIDC_ISSUER");

  let issuerUrl: URL;
  try {
    issuerUrl = new URL(rawIssuer);
  } catch {
    throw new Error(`VOLUND_OIDC_ISSUER não é uma URL válida: ${rawIssuer}`);
  }

  const isLocal =
    issuerUrl.hostname === "localhost" || issuerUrl.hostname === "127.0.0.1";
  if (issuerUrl.protocol !== "https:" && !isLocal) {
    // Emissor em texto claro permitiria interceptar a descoberta e apontar o App
    // para outro provedor — o token viria assinado por quem interceptou.
    throw new Error(
      `VOLUND_OIDC_ISSUER precisa ser https (exceto localhost): ${rawIssuer}`,
    );
  }

  return {
    issuer: issuerUrl.origin,
    clientId: required(env, "VOLUND_OIDC_CLIENT_ID"),
    clientSecret: required(env, "VOLUND_OIDC_CLIENT_SECRET"),
    // Obrigatória como as outras, e pela mesma razão: sem ela não há como
    // conferir a audiência do token, e a alternativa seria conferi-la contra o
    // próprio token — que é o que não separava um App do outro.
    appId: required(env, "VOLUND_APP_ID"),
  };
}

/**
 * Audiência do **access token** deste App.
 *
 * Forma canônica combinada com o provedor e derivada do id do agente. O JWKS é
 * compartilhado por todos os Apps da plataforma: validar só a assinatura faria
 * este App aceitar como seu um token legítimo de outro. É esta string que
 * separa um do outro.
 */
export function resourceIdForApp(appId: string): string {
  return `volund:app:${appId}`;
}
