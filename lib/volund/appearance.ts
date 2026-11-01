/**
 * A marca da organização (contrato 9): nome, logo, ícone e as cores do tema, do
 * jeito que o painel do VolundOS as usa.
 *
 * ## Por que o App busca, em vez de cada um escrever a sua
 *
 * Porque a marca é da ORGANIZAÇÃO, e muda no painel. Um App que copiasse o
 * logo e o crimson para o código ficaria com a marca do dia em que foi
 * construído — e a organização que trocou de cor descobriria isso App por App.
 * Aqui a plataforma entrega a marca pronta, e o App só aplica.
 *
 * ## O `css` vem pronto, e o App não monta cor nenhuma
 *
 * A resposta traz dois blocos (`html:root{...}` para o escuro e
 * `html:root[data-tema="claro"]{...}` para o claro) com os MESMOS nomes de
 * variável que `app/globals.css` já declara (`--primary`, `--ring`,
 * `--sidebar-*`, `--chart-1..5`...). O seletor `html:root` é mais forte que o
 * `:root` do tema padrão, então a marca vence sem depender da ordem do CSS.
 *
 * ## Falhar é seguir com o tema padrão
 *
 * Plataforma fora, timeout, resposta em formato estranho: tudo vira `null`, e o
 * App abre com o tema do scaffold. Marca é acabamento — derrubar a página por
 * ela seria trocar uma tela sem logo por tela nenhuma.
 */

import { cache } from "react";
import { z } from "zod";

import { readAuthConfig, type AuthConfig } from "@/lib/auth/config";
import { loadDiscovery } from "@/lib/auth/discovery";
import { basicAuthHeader } from "@/lib/auth/session";

/** O caminho quando a descoberta não anuncia `volund_appearance_endpoint`. */
export const APP_APPEARANCE_PATH = "/oauth/app-appearance";

/** Cinco minutos: a marca muda raramente, e o painel aceita esse atraso. */
export const APPEARANCE_REVALIDATE_SECONDS = 300;

/**
 * Curto de propósito: a marca está no caminho de TODA página (é o layout que a
 * busca), e uma plataforma lenta não pode virar um App lento.
 *
 * É o teto da busca INTEIRA — descoberta mais marca. A descoberta tem o teto
 * dela (5 s, o do login), e somar os dois faria a página esperar 7,5 s por um
 * acabamento com a plataforma pendurada.
 */
const APPEARANCE_TIMEOUT_MS = 2_500;

/** Teto do `css`. A resposta real tem poucos KB; 64 KB já é sinal de outra coisa. */
const CSS_MAX_BYTES = 64 * 1024;

export interface OrgAppearance {
  name: string | null;
  logoUrl: string | null;
  iconUrl: string | null;
  primaryColor: string | null;
  avatarBgColor: string | null;
  /** Já conferido por `safeBrandCss`: pode ir direto para um `<style>`. */
  css: string | null;
}

const appearanceSchema = z.object({
  name: z.string().nullable().optional(),
  logo_url: z.string().nullable().optional(),
  icon_url: z.string().nullable().optional(),
  primary_color: z.string().nullable().optional(),
  avatar_bg_color: z.string().nullable().optional(),
  css: z.unknown().optional(),
});

/**
 * O `css` só passa se for texto e não puder fechar a tag onde ele entra.
 *
 * Ele vai para dentro de um `<style>` no `<head>` de toda página. Um `</` ali
 * dentro encerraria o `<style>` e o resto seria HTML — um `<script>` da
 * plataforma, ou de quem a tivesse comprometido, rodando na origem do App. O
 * conteúdo é da plataforma e não de um cliente, mas a conferência não é sobre
 * confiança: é o que impede um defeito do outro lado de virar execução de
 * código aqui.
 */
export function safeBrandCss(css: unknown): string | null {
  if (typeof css !== "string") return null;
  if (css.trim() === "") return null;
  if (css.includes("</")) return null;
  if (Buffer.byteLength(css, "utf8") > CSS_MAX_BYTES) return null;
  return css;
}

/**
 * Endereço de imagem só se for http(s) absoluto. `javascript:` ou `data:` num
 * `href` de ícone não tem utilidade legítima aqui.
 */
function safeImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * A promessa, ou a recusa quando `signal` vence antes dela.
 *
 * `loadDiscovery` não recebe sinal (é a mesma do login, com o teto dela), então
 * o prazo da marca corre por fora: quem espera desiste, e a descoberta termina
 * sozinha em segundo plano — e ainda aquece o cache para a próxima página.
 */
function withinDeadline<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/**
 * De onde ler a marca: o anunciado na descoberta, se for do PRÓPRIO emissor;
 * senão o caminho padrão.
 *
 * A conferência de origem não é zelo: o pedido leva o segredo do App no
 * `Authorization`, e mandá-lo para um host que a descoberta apontasse por
 * engano seria entregar a credencial do App a quem responde nele.
 */
export async function appearanceEndpoint(
  config: AuthConfig,
  signal?: AbortSignal,
): Promise<string> {
  const fallback = new URL(APP_APPEARANCE_PATH, config.issuer).toString();
  try {
    const announced = (await withinDeadline(loadDiscovery(config.issuer), signal))
      .volund_appearance_endpoint;
    if (!announced) return fallback;
    const url = new URL(announced);
    return url.origin === new URL(config.issuer).origin ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A marca da organização dona deste App, ou `null` (tema padrão).
 *
 * Nunca lança. `config` ausente (App recém-criado, ou o `next build` sem as
 * variáveis) também é `null`: sem configuração não há organização a mostrar.
 */
export async function loadAppAppearance(
  config?: AuthConfig,
): Promise<OrgAppearance | null> {
  let cfg: AuthConfig;
  try {
    cfg = config ?? readAuthConfig();
  } catch {
    return null;
  }

  // Um prazo só, do começo da descoberta ao fim da resposta da marca.
  const deadline = AbortSignal.timeout(APPEARANCE_TIMEOUT_MS);
  try {
    const response = await fetch(await appearanceEndpoint(cfg, deadline), {
      headers: { authorization: basicAuthHeader(cfg), accept: "application/json" },
      // A resposta é da organização, igual para todo mundo que usa o App — não
      // carrega nada da pessoa. Por isso pode ficar em cache entre requisições.
      next: { revalidate: APPEARANCE_REVALIDATE_SECONDS },
      signal: deadline,
    });
    if (!response.ok) {
      console.error(`[volund] aparência da organização respondeu ${response.status}`);
      return null;
    }
    const parsed = appearanceSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      console.error("[volund] aparência da organização em formato inesperado");
      return null;
    }
    const a = parsed.data;
    const css = safeBrandCss(a.css);
    // `""` é a resposta normal de organização sem cor própria (valem os tokens
    // do App), e não recusa — só o que veio e não passou vai para o log.
    if (a.css != null && a.css !== "" && css === null) {
      console.error("[volund] css da marca recusado (não é texto, grande ou com `</`)");
    }
    return {
      name: a.name?.trim() || null,
      logoUrl: safeImageUrl(a.logo_url),
      iconUrl: safeImageUrl(a.icon_url),
      primaryColor: a.primary_color ?? null,
      avatarBgColor: a.avatar_bg_color ?? null,
      css,
    };
  } catch (err) {
    console.error("[volund] aparência da organização indisponível:", err);
    return null;
  }
}

/**
 * `loadAppAppearance` uma vez por requisição. O layout, os metadados e a página
 * que mostra o logo pedem a mesma marca; o `cache` do React faz deles UMA ida à
 * plataforma, que ainda fica no cache de dados do Next por cinco minutos.
 */
export const orgAppearance = cache(() => loadAppAppearance());
