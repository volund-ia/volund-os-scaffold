/**
 * Primitivas criptográficas da camada de autenticação — PKCE, valores aleatórios
 * e o selo do cookie.
 *
 * Tudo aqui usa **Web Crypto** (`globalThis.crypto.subtle`), nunca `node:crypto`.
 * O motivo é onde este código roda: o `proxy.ts` executa antes de qualquer rota,
 * e depender de um módulo do Node ali amarra a camada a um runtime específico.
 * Web Crypto existe nos dois lados e no Node 20 em diante.
 *
 * Zero dependência nova: `jose` e afins resolveriam o mesmo, mas este é o
 * repositório base de todo App do VolundOS — cada pacote aqui é um pacote em
 * todo app gerado, para sempre.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** base64url sem preenchimento, como manda a RFC 7515 §2. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * O parâmetro de `Uint8Array` é explícito porque a Web Crypto exige um array
 * apoiado em `ArrayBuffer` (e não em `SharedArrayBuffer`). Sem a anotação, o
 * TypeScript infere `ArrayBufferLike` e a recusa aparece em quem consome.
 */
export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Texto de um trecho base64url — usado para ler os claims de um JWT. */
export function base64UrlDecodeText(value: string): string {
  return decoder.decode(base64UrlDecode(value));
}

/** Aleatório criptográfico em base64url. Usado por `state`, `nonce` e verifier. */
export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64UrlEncode(buffer);
}

/**
 * `code_challenge` do PKCE no método S256 (RFC 7636 §4.2).
 *
 * O provedor só aceita `S256` — `plain` não protege contra interceptação, que é
 * a única razão de o PKCE existir.
 */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Chave de selagem derivada do `client_secret`.
 *
 * ## Por que derivar do segredo do client, e não de uma quarta variável
 *
 * O contrato do scaffold declara **três** variáveis. Uma quarta (um
 * `SESSION_SECRET`) seria mais uma coisa para a plataforma injetar, mais um
 * ponto onde esquecer quebra o App, e mais um segredo para rotacionar. O
 * `client_secret` já é exclusivo do servidor, já é único por App e já é
 * rotacionável pela plataforma.
 *
 * **Consequência aceita:** rotacionar o segredo do client invalida as sessões
 * seladas com o anterior — todo mundo refaz login. Para uma credencial que só se
 * rotaciona quando há suspeita de vazamento, derrubar as sessões é o
 * comportamento desejado, não o efeito colateral.
 *
 * O `purpose` entra no `info` do HKDF para que selos de finalidades diferentes
 * (sessão e aperto de mão) usem chaves diferentes: sem isso, um cookie de
 * handshake válido poderia ser apresentado como cookie de sessão.
 */
async function sealingKey(secret: string, purpose: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("volund-app-auth/v1"),
      info: encoder.encode(purpose),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const SEAL_VERSION = "v1";

/**
 * Sela um objeto em texto opaco e autenticado (AES-GCM).
 *
 * Autenticado é o que importa: o conteúdo do cookie decide quem o usuário é. Um
 * selo só cifrado — sem tag de integridade — permitiria adulterar bytes sem que
 * a leitura percebesse.
 */
export async function seal(
  payload: unknown,
  secret: string,
  purpose: string,
): Promise<string> {
  const key = await sealingKey(secret, purpose);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(payload)),
  );

  return `${SEAL_VERSION}.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

/**
 * Abre um selo. Devolve `null` em QUALQUER falha — formato errado, versão
 * desconhecida, chave diferente, byte adulterado, JSON inválido.
 *
 * Nunca lança: quem chama está sempre no caminho de "tem sessão ou não tem", e
 * uma exceção ali viraria erro 500 numa requisição que deveria simplesmente
 * pedir login.
 */
export async function unseal<T>(
  sealed: string | undefined | null,
  secret: string,
  purpose: string,
): Promise<T | null> {
  if (!sealed) return null;

  const [version, iv, ciphertext] = sealed.split(".");
  if (version !== SEAL_VERSION || !iv || !ciphertext) return null;

  try {
    const key = await sealingKey(secret, purpose);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlDecode(iv) },
      key,
      base64UrlDecode(ciphertext),
    );
    return JSON.parse(decoder.decode(plaintext)) as T;
  } catch {
    return null;
  }
}
