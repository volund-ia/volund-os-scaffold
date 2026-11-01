// O vínculo de rota com o painel que emoldura esta aplicação (contrato 7), o
// tema que o painel manda (contrato 9), e a entrada pela raiz quando já existe
// sessão.
//
// Os dois assuntos moram no mesmo arquivo porque são o mesmo defeito visto de
// dois lados: abrir a aplicação dentro do painel era uma experiência que mentia.
// Ela mostrava "Entrar" para quem já tinha sessão, e o endereço do painel
// congelava na página de entrada por mais que a pessoa navegasse aqui dentro.
//
// O que é exercitado sem subir o Next: o CONTRATO das mensagens (o arquivo que
// as duas pontas leem) e as regras que o componente aplica antes de agir. O
// componente em si é React e depende de janela; o que ele tem de decisão está
// aqui em forma conferível — e a regressão que importa é justamente a de alguém
// afrouxar uma dessas conferências.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

import { APP_HOME_PATH, AUTH_LOGIN_PATH } from "../lib/auth/config";
import { isPublicRoute } from "../lib/auth/route-policy";
import {
  THEME_ATTRIBUTE,
  THEME_BEFORE_PAINT_SCRIPT,
  THEME_LIGHT_VALUE,
  readPanelThemeMessage,
} from "../lib/volund/theme";

const raiz = process.cwd();
const ler = (rel: string) => readFileSync(path.join(raiz, rel), "utf8");

// ---------------------------------------------------------------------------
// 1. O contrato, e a igualdade de número entre os arquivos
// ---------------------------------------------------------------------------

test("o protocolo do quadro declara o mesmo contrato do manifest", () => {
  const manifest = JSON.parse(ler("volund-scaffold.json")) as { contract: number };
  const protocolo = JSON.parse(ler("contracts/frame-protocol.json")) as {
    contract: number;
    appToPanel: { source: string; type: string };
    panelToApp: { source: string; type: string };
    panelToAppTheme: { source: string; type: string; fields: Record<string, string> };
  };
  const claims = JSON.parse(ler("contracts/auth-claims.json")) as { contract: number };

  // Os três números são o MESMO contrato. Um deles ficando para trás é o modo
  // de falhar que o diretório `contracts/` existe para pegar: a plataforma
  // recusa por um número e as duas pontas divergem pelo outro.
  assert.equal(protocolo.contract, manifest.contract);
  assert.equal(claims.contract, manifest.contract);

  // Os nomes são o contrato de verdade — renomear qualquer um deles faz o outro
  // lado simplesmente parar de ouvir, sem erro e sem log.
  assert.equal(protocolo.appToPanel.source, "volund-app");
  assert.equal(protocolo.appToPanel.type, "route");
  assert.equal(protocolo.panelToApp.source, "volund-panel");
  assert.equal(protocolo.panelToApp.type, "navigate");
  // Contrato 9: o tema que o painel manda.
  assert.equal(protocolo.panelToAppTheme.source, "volund-panel");
  assert.equal(protocolo.panelToAppTheme.type, "theme");
  assert.deepEqual(Object.keys(protocolo.panelToAppTheme.fields), ["mode"]);
});

// ---------------------------------------------------------------------------
// 2. O componente endereça a origem, nunca "*"
// ---------------------------------------------------------------------------

test("o aviso de rota é endereçado à origem do painel, e não a qualquer um", () => {
  const fonte = ler("components/volund/frame-binding.tsx");

  // `postMessage(msg, "*")` publicaria a navegação de quem usa a aplicação para
  // QUALQUER página que resolvesse emoldurá-la. É uma linha, e some numa
  // refatoração de "simplificar".
  assert.doesNotMatch(fonte, /postMessage\([^)]*,\s*["']\*["']\s*\)/);
  assert.match(fonte, /postMessage\(\s*\{[^}]*\},\s*parentOrigin,?\s*\)/s);

  // E o que CHEGA é conferido nas duas dimensões que o remetente não controla.
  assert.match(fonte, /event\.origin !== parentOrigin/);
  assert.match(fonte, /event\.source !== window\.parent/);
});

test("caminho que sairia do site não é aceito como rota", () => {
  const fonte = ler("components/volund/frame-binding.tsx");
  // `//outro.site` e `/\outro.site` são endereços absolutos para o navegador, e
  // o roteador os levaria a sério — o painel mandaria a aplicação para fora dela
  // mesma.
  assert.match(fonte, /\[\/\\\\\]\{2\}/);
  assert.match(fonte, /startsWith\("\/"\)/);
});

// ---------------------------------------------------------------------------
// 2b. O tema que o painel manda (contrato 9)
// ---------------------------------------------------------------------------

const PAINEL = "https://painel.exemplo.test";
const pai = { nome: "a janela que emoldura" };
const irmao = { nome: "outro quadro do mesmo painel" };
const tema = (mode: unknown) => ({ source: "volund-panel", type: "theme", mode });

test("o tema do painel é aceito da origem e da janela certas", () => {
  assert.equal(
    readPanelThemeMessage(
      { origin: PAINEL, source: pai, data: tema("light") },
      PAINEL,
      pai,
    ),
    "light",
  );
  assert.equal(
    readPanelThemeMessage(
      { origin: PAINEL, source: pai, data: tema("dark") },
      PAINEL,
      pai,
    ),
    "dark",
  );
});

test("e recusado de qualquer outra origem, janela ou forma", () => {
  // Cada caso tem UMA coisa errada, e o caso certo acima prova que o resto
  // passaria — sem ele, uma função que recusasse tudo passaria aqui também.
  const casos: Array<[string, { origin: string; source: unknown; data: unknown }]> = [
    [
      "outra origem",
      { origin: "https://intruso.test", source: pai, data: tema("light") },
    ],
    ["quadro irmão", { origin: PAINEL, source: irmao, data: tema("light") }],
    [
      "outro tipo",
      { origin: PAINEL, source: pai, data: { ...tema("light"), type: "navigate" } },
    ],
    [
      "outra fonte",
      { origin: PAINEL, source: pai, data: { ...tema("light"), source: "volund-app" } },
    ],
    [
      "system não vem nesta direção",
      { origin: PAINEL, source: pai, data: tema("system") },
    ],
    ["valor inventado", { origin: PAINEL, source: pai, data: tema("sepia") }],
    ["sem corpo", { origin: PAINEL, source: pai, data: null }],
  ];
  for (const [nome, evento] of casos) {
    assert.equal(readPanelThemeMessage(evento, PAINEL, pai), null, nome);
  }
  // Sem origem do painel conhecida (ambiente não injetado), nada é aceito.
  assert.equal(
    readPanelThemeMessage(
      { origin: PAINEL, source: pai, data: tema("light") },
      null,
      pai,
    ),
    null,
  );
});

test("o vínculo de tema usa a regra conferida, e escuta antes do aviso de rota", () => {
  const fonte = ler("components/volund/theme-binding.tsx");
  assert.match(fonte, /readPanelThemeMessage\(event, parentOrigin, window\.parent\)/);
  // Fora do painel, o aparelho manda, ao vivo.
  assert.match(fonte, /prefers-color-scheme: light/);
  assert.match(fonte, /addEventListener\("change"/);

  // O painel responde ao PRIMEIRO `route`; o ouvinte de tema precisa estar
  // montado antes do componente que manda o `route`.
  const layout = ler("app/layout.tsx");
  const tema = layout.indexOf("<ThemeBinding");
  const rota = layout.indexOf("<FrameBinding");
  assert.ok(tema > 0 && rota > 0, "o layout não monta os dois vínculos");
  assert.ok(tema < rota, "o ThemeBinding tem de vir antes do FrameBinding");
});

test("o script de antes da pintura aplica o mesmo atributo que o painel do VolundOS", () => {
  assert.equal(THEME_ATTRIBUTE, "data-tema");
  assert.equal(THEME_LIGHT_VALUE, "claro");
  assert.ok(THEME_BEFORE_PAINT_SCRIPT.includes('"data-tema"'));
  assert.ok(THEME_BEFORE_PAINT_SCRIPT.includes('"claro"'));
  assert.ok(THEME_BEFORE_PAINT_SCRIPT.includes("prefers-color-scheme: light"));
  // Ele vai inline no <head>: não pode fechar a tag em que está.
  assert.ok(!THEME_BEFORE_PAINT_SCRIPT.includes("</"));
});

/**
 * Roda o script de antes da pintura numa janela de mentira e devolve o
 * atributo que ele deixou no <html>. Rodar, e não só ler o texto: um script com
 * a lógica invertida conteria as mesmas palavras.
 */
function temaAplicado(opts: {
  aparelhoClaro: boolean;
  emoldurado: boolean;
  guardado?: string | null;
  inicial?: string | null;
}): string | null {
  const attrs = new Map<string, string>();
  if (opts.inicial) attrs.set(THEME_ATTRIBUTE, opts.inicial);
  const janela: Record<string, unknown> = {
    matchMedia: (q: string) => ({ matches: q.includes("light") && opts.aparelhoClaro }),
  };
  janela.parent = opts.emoldurado ? {} : janela;
  vm.runInNewContext(THEME_BEFORE_PAINT_SCRIPT, {
    window: janela,
    sessionStorage: { getItem: () => opts.guardado ?? null },
    document: {
      documentElement: {
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        removeAttribute: (k: string) => attrs.delete(k),
      },
    },
  });
  return attrs.get(THEME_ATTRIBUTE) ?? null;
}

test("antes da pintura: fora do painel vale o aparelho; dentro, o último tema do painel", () => {
  assert.equal(temaAplicado({ aparelhoClaro: true, emoldurado: false }), "claro");
  assert.equal(
    temaAplicado({ aparelhoClaro: false, emoldurado: false, inicial: "claro" }),
    null,
  );
  // Dentro do painel, o que ele mandou da última vez vence o aparelho...
  assert.equal(
    temaAplicado({ aparelhoClaro: false, emoldurado: true, guardado: "light" }),
    "claro",
  );
  assert.equal(
    temaAplicado({ aparelhoClaro: true, emoldurado: true, guardado: "dark" }),
    null,
  );
  // ...e sem nada guardado (primeira abertura), o aparelho até o painel responder.
  assert.equal(temaAplicado({ aparelhoClaro: true, emoldurado: true }), "claro");
  // O guardado só vale emoldurado: numa aba solta quem manda é o aparelho.
  assert.equal(
    temaAplicado({ aparelhoClaro: true, emoldurado: false, guardado: "dark" }),
    "claro",
  );
});

// ---------------------------------------------------------------------------
// 3. A raiz deixa de mentir para quem tem sessão
// ---------------------------------------------------------------------------

test("a vitrine continua pública — é o endereço que qualquer visitante abre", () => {
  assert.equal(isPublicRoute("/"), true);
});

test("a raiz manda quem tem sessão para a home, em vez de oferecer Entrar", () => {
  const fonte = ler("app/page.tsx");

  // O ponto inteiro da mudança: com sessão, a raiz REDIRECIONA. Sem esta linha
  // a vitrine volta a aparecer para quem já entrou — e a sessão de trinta dias
  // volta a parecer expirada toda vez que o App é aberto no painel.
  assert.match(fonte, /if \(temSessao\) redirect\(APP_HOME_PATH\)/);

  // E ela precisa ser dinâmica para poder ler cookie.
  assert.match(fonte, /export const dynamic = "force-dynamic"/);

  // O selo basta: validar o token contra o JWKS aqui poria uma ida à rede na
  // página pública, e quem confere de verdade é o portão no destino.
  assert.match(fonte, /readSealedPayload/);
  assert.doesNotMatch(fonte, /readSession\(/);
});

test("o botão Entrar e o redirecionamento apontam para a MESMA home", () => {
  const fonte = ler("app/page.tsx");
  // Duas cópias do caminho divergem na primeira vez que a home mudar, e o
  // sintoma é um 404 logo depois do login.
  assert.match(
    fonte,
    /AUTH_LOGIN_PATH\}\?returnTo=\$\{encodeURIComponent\(APP_HOME_PATH\)\}/,
  );
  // O caminho escrito à mão que existia aqui antes é o que não pode voltar.
  assert.doesNotMatch(fonte, /returnTo=%2Fpainel/);
  assert.ok(AUTH_LOGIN_PATH.startsWith("/"), "o início do login é um caminho interno");
});

test("a home autenticada não é a vitrine", () => {
  // Se `APP_HOME_PATH` virar "/", o redirecionamento da raiz vira um laço.
  assert.notEqual(APP_HOME_PATH, "/");
  assert.equal(isPublicRoute(APP_HOME_PATH), false);
});
