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
  CARGA_INICIAL,
  FIM_DO_GESTO_MS,
  FRAME_SOURCE_APP,
  FRAME_SOURCE_PANEL,
  PICK_CANCEL_MESSAGE,
  PICK_READY_MESSAGE,
  aoCarregar,
  aoFalhar,
  aoPedido,
  decidirClique,
  mensagemDaTecla,
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
  assert.equal(c.appToPanelPickCancel.source, PICK_CANCEL_MESSAGE.source);
  assert.equal(c.appToPanelPickCancel.type, PICK_CANCEL_MESSAGE.type);
  for (const [chave, tipo] of [
    ["appToPanelPicked", "picked"],
    ["appToPanelPickCancel", "pick-cancel"],
  ] as const) {
    assert.equal(c[chave].source, FRAME_SOURCE_APP, chave);
    assert.equal(c[chave].type, tipo, chave);
  }

  const seletor = ler("lib/volund/element-picker.ts");
  assert.match(seletor, /type: "picked"/);
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
// 4. O clique, o Esc e o fim do gesto
// ---------------------------------------------------------------------------

test("clique sem nada escolhível sob o cursor segue no modo, sem desligar calado", () => {
  assert.equal(
    decidirClique({ escolhendo: false, temElemento: false }),
    "seguir-no-modo",
  );
});

test("clique num elemento escolhe; o segundo clique do gesto é engolido", () => {
  assert.equal(decidirClique({ escolhendo: false, temElemento: true }), "escolher");
  assert.equal(decidirClique({ escolhendo: true, temElemento: true }), "engolir");
  assert.equal(decidirClique({ escolhendo: true, temElemento: false }), "engolir");
});

test("o fim do gesto cobre o intervalo de um duplo clique", () => {
  // O segundo clique de um duplo clique chega uns 300 ms depois do primeiro.
  assert.ok(FIM_DO_GESTO_MS >= 350, `fim do gesto curto demais: ${FIM_DO_GESTO_MS} ms`);
  assert.ok(
    FIM_DO_GESTO_MS <= 1000,
    "a camada não pode prender a página por muito tempo",
  );
});

test("o Esc avisa o painel; outra tecla não", () => {
  assert.deepEqual(mensagemDaTecla("Escape"), {
    source: "volund-app",
    type: "pick-cancel",
  });
  assert.equal(mensagemDaTecla("Enter"), null);
  assert.equal(mensagemDaTecla("Esc"), null);
});

// ---------------------------------------------------------------------------
// 5. A carga sob demanda do componente
// ---------------------------------------------------------------------------

test("o primeiro pedido de ligar baixa o seletor; desligar não baixa nada", () => {
  assert.equal(aoPedido(CARGA_INICIAL, false).carregar, false);
  const ligar = aoPedido(CARGA_INICIAL, true);
  assert.equal(ligar.carregar, true);
  // Um segundo pedido enquanto baixa não baixa de novo.
  assert.equal(aoPedido(ligar.carga, true).carregar, false);
});

test("o seletor nasce no estado do ÚLTIMO pedido, inclusive o que chegou enquanto baixava", () => {
  const ligou = aoPedido(CARGA_INICIAL, true).carga;
  assert.equal(aoCarregar(ligou).initialActive, true);
  const desligouNoMeio = aoPedido(ligou, false).carga;
  assert.equal(aoCarregar(desligouNoMeio).initialActive, false);
});

test("se o seletor não baixa com o modo pedido, o painel sai do modo; o próximo pedido tenta de novo", () => {
  const ligou = aoPedido(CARGA_INICIAL, true).carga;
  const falha = aoFalhar(ligou);
  assert.deepEqual(falha.avisar, PICK_CANCEL_MESSAGE);
  assert.equal(aoPedido(falha.carga, true).carregar, true);
  // Falhou depois de a pessoa já ter desligado: nada a avisar.
  assert.equal(aoFalhar(aoPedido(ligou, false).carga).avisar, null);
});

// ---------------------------------------------------------------------------
// 6. Quem executa as decisões
// ---------------------------------------------------------------------------

test("o seletor e o componente executam as decisões do gate, e só falam com o painel", () => {
  const seletor = ler("lib/volund/element-picker.ts");
  const componente = ler("components/volund/element-picker.tsx");
  for (const fonte of [seletor, componente]) {
    assert.doesNotMatch(fonte, /postMessage\([^)]*,\s*["']\*["']\s*\)/);
    assert.match(fonte, /readPanelPickMessage\(event, \w+, window\.parent\)/);
  }
  assert.match(seletor, /decidirClique\(/);
  assert.match(seletor, /mensagemDaTecla\(event\.key\)/);
  assert.match(seletor, /\}, FIM_DO_GESTO_MS\);/);
  assert.match(seletor, /window\.parent\.postMessage\(aviso, panelOrigin\)/);
  assert.match(componente, /initialActive: aoCarregar\(carga\)\.initialActive/);
  assert.match(componente, /aoFalhar\(carga\)/);
  // O clique é capturado antes da aplicação, e não há início automático.
  assert.match(seletor, /addEventListener\("click", onClick, true\)/);
  assert.match(seletor, /stopImmediatePropagation/);
  assert.doesNotMatch(seletor, /document\.currentScript/);
  // Cor do tema, não literal.
  assert.match(seletor, /var\(--primary/);
});
