// A seleção de elemento para comentar com o agente do VolundOS (contrato 10).
//
// O que é exercitado sem subir o Next: o CONTRATO das mensagens (o arquivo que
// as duas pontas leem), a conferência do pedido do painel e as regras que o
// componente e o seletor aplicam antes de agir. A regressão que importa é a de
// alguém afrouxar uma dessas conferências, ou fazer o seletor (pesado) entrar
// no carregamento de toda página.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  FRAME_SOURCE_APP,
  FRAME_SOURCE_PANEL,
  PICK_READY_MESSAGE,
  readPanelPickMessage,
} from "../lib/volund/element-picker-gate";

const raiz = process.cwd();
const ler = (rel: string) => readFileSync(path.join(raiz, rel), "utf8");

// ---------------------------------------------------------------------------
// 1. O contrato
// ---------------------------------------------------------------------------

test("o contrato descreve as mensagens que o componente e o seletor falam", () => {
  const c = JSON.parse(ler("contracts/frame-protocol.json"));
  const manifest = JSON.parse(ler("volund-scaffold.json")) as { contract: number };
  assert.equal(c.contract, manifest.contract);
  assert.ok(manifest.contract >= 10, "a seleção de elemento é o contrato 10");

  assert.equal(c.panelToAppPick.source, FRAME_SOURCE_PANEL);
  assert.equal(c.panelToAppPick.type, "pick");
  assert.deepEqual(Object.keys(c.panelToAppPick.fields), ["active"]);
  assert.equal(c.appToPanelPickReady.source, PICK_READY_MESSAGE.source);
  assert.equal(c.appToPanelPickReady.type, PICK_READY_MESSAGE.type);
  for (const [chave, tipo] of [
    ["appToPanelPicked", "picked"],
    ["appToPanelPickCancel", "pick-cancel"],
  ] as const) {
    assert.equal(c[chave].source, FRAME_SOURCE_APP, chave);
    assert.equal(c[chave].type, tipo, chave);
  }

  const seletor = ler("lib/volund/element-picker.ts");
  assert.match(seletor, /type: "picked"/);
  assert.match(seletor, /type: "pick-cancel"/);
});

// ---------------------------------------------------------------------------
// 2. O pedido do painel
// ---------------------------------------------------------------------------

const PAINEL = "https://painel.exemplo.test";
const pai = { nome: "a janela que emoldura" };
const irmao = { nome: "outro quadro do mesmo painel" };
const pedido = (active: unknown) => ({ source: "volund-panel", type: "pick", active });

test("o pedido é aceito da origem e da janela certas", () => {
  assert.equal(
    readPanelPickMessage(
      { origin: PAINEL, source: pai, data: pedido(true) },
      PAINEL,
      pai,
    ),
    true,
  );
  assert.equal(
    readPanelPickMessage(
      { origin: PAINEL, source: pai, data: pedido(false) },
      PAINEL,
      pai,
    ),
    false,
  );
});

test("e recusado de qualquer outra origem, janela ou forma", () => {
  // Cada caso tem UMA coisa errada; o caso certo acima prova que o resto
  // passaria.
  const casos: Array<
    [string, { origin: string; source: unknown; data: unknown }, string | null]
  > = [
    [
      "outra origem",
      { origin: "https://outro.test", source: pai, data: pedido(true) },
      PAINEL,
    ],
    ["outra janela", { origin: PAINEL, source: irmao, data: pedido(true) }, PAINEL],
    ["sem origem conhecida", { origin: PAINEL, source: pai, data: pedido(true) }, null],
    [
      "outro remetente",
      { origin: PAINEL, source: pai, data: { ...pedido(true), source: "volund-app" } },
      PAINEL,
    ],
    [
      "outro tipo",
      { origin: PAINEL, source: pai, data: { ...pedido(true), type: "theme" } },
      PAINEL,
    ],
    [
      "active que não é booleano",
      { origin: PAINEL, source: pai, data: pedido("true") },
      PAINEL,
    ],
    ["corpo que não é objeto", { origin: PAINEL, source: pai, data: "pick" }, PAINEL],
  ];
  for (const [nome, evento, origem] of casos) {
    assert.equal(readPanelPickMessage(evento, origem, pai), null, nome);
  }
});

// ---------------------------------------------------------------------------
// 3. O componente
// ---------------------------------------------------------------------------

test("o componente fala só com a origem do painel e não duplica o seletor", () => {
  const fonte = ler("components/volund/element-picker.tsx");
  assert.doesNotMatch(fonte, /postMessage\([^)]*,\s*["']\*["']\s*\)/);
  assert.match(fonte, /postMessage\(PICK_READY_MESSAGE, parentOrigin\)/);
  assert.match(fonte, /readPanelPickMessage\(event, parentOrigin, window\.parent\)/);
  // Fora do quadro, nada.
  assert.match(fonte, /window\.parent === window\) return/);
  // O proxy do ambiente de Desenvolvimento já injeta o seletor.
  assert.match(fonte, /__volundPickerStarted\s*\)\s*return/);
});

test("o seletor pesado só é baixado quando pedem, e o layout monta o componente", () => {
  const componente = ler("components/volund/element-picker.tsx");
  const layout = ler("app/layout.tsx");
  // Import dinâmico, e nenhum estático do seletor em quem toda página carrega.
  assert.match(componente, /import\("@\/lib\/volund\/element-picker"\)/);
  assert.doesNotMatch(componente, /from "@\/lib\/volund\/element-picker"/);
  assert.doesNotMatch(layout, /lib\/volund\/element-picker"/);
  assert.match(layout, /<ElementPicker parentOrigin=\{origin\} \/>/);
});

// ---------------------------------------------------------------------------
// 4. O seletor
// ---------------------------------------------------------------------------

test("o seletor endereça a origem do painel e confere origem e janela do pedido", () => {
  const fonte = ler("lib/volund/element-picker.ts");
  assert.doesNotMatch(fonte, /postMessage\([^)]*,\s*["']\*["']\s*\)/);
  assert.match(
    fonte,
    /window\.parent\.postMessage\(\{ source: SOURCE_APP, \.\.\.message \}, panelOrigin\)/,
  );
  assert.match(fonte, /event\.origin !== panelOrigin/);
  assert.match(fonte, /event\.source !== window\.parent/);
  // O clique é capturado antes da aplicação.
  assert.match(fonte, /addEventListener\("click", onClick, true\)/);
  assert.match(fonte, /stopImmediatePropagation/);
  // Sem início automático: quem decide é o componente.
  assert.doesNotMatch(fonte, /document\.currentScript/);
});
