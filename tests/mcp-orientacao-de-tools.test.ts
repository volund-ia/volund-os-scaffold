// O texto que instrui o agente é código de produção — e neste repositório isso
// já falhou uma vez de forma caríssima: dois agentes leram um comentário
// desatualizado sobre permissões e construíram um controle de acesso paralelo
// dentro do banco do App (ver `tests/auth-orientacao-de-permissoes.test.ts`).
//
// A orientação de tools tem o mesmo risco, e o defeito seria mais silencioso: um
// exemplo que ensine a decidir DENTRO da tool produz uma segunda implementação da
// regra, e duas implementações da mesma decisão divergem sem dar erro — apenas
// respondendo diferente para a mesma pergunta.
//
// Este teste não avalia prosa. Ele verifica que os dois textos lidos antes de
// escrever uma tool continuam apontando para o caminho certo, e que **os exemplos
// não ensinam o contrário do que a prosa diz** — porque o agente copia o exemplo.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * O diretório deste arquivo, derivado da URL do módulo.
 *
 * `aquiDir` só existe a partir do Node 20.11, e o `.nvmrc` fixa
 * 20.9.0 — nele o valor é `undefined` e o `path.join` estoura. Isso nunca
 * apareceu porque o CI rodava ZERO testes (o glob padrão do Node 20 não casa
 * `tests/*.test.ts`); quando ele passou a rodá-los, cinco arquivos quebraram
 * de uma vez. Esta forma funciona em qualquer versão.
 */
const aquiDir = path.dirname(fileURLToPath(import.meta.url));

const raiz = path.join(aquiDir, "..");
const ler = (rel: string) => readFileSync(path.join(raiz, rel), "utf8");

/** Os dois lugares que o agente lê antes de expor uma capacidade a um agente. */
const ORIENTACOES = ["AGENTS.md", "lib/mcp/tools.ts"] as const;

test("o anti-padrão é nomeado, não só descrito", () => {
  // Descrever o caminho certo não basta: o errado precisa estar nomeado, porque é
  // ele que o agente reconhece quando está a ponto de segui-lo.
  for (const arquivo of ORIENTACOES) {
    assert.match(
      ler(arquivo),
      /não reimplemente a regra na tool/i,
      `${arquivo} precisa nomear o caminho errado com todas as letras`,
    );
  }
});

test("a ordem de construir está escrita", () => {
  // Serviço primeiro. Escrever a tool antes é o caminho pelo qual a regra nasce
  // dentro dela — e aí o conserto é reescrever, não mover.
  assert.match(
    ler("AGENTS.md"),
    /serviço\s*→\s*rota\s*→\s*tool/i,
    "AGENTS.md precisa dizer a ordem, e não só que existem três portas",
  );
});

test("a orientação diz que a tool recebe o serviço, não um corpo", () => {
  // É a frase que explica por que não HÁ onde escrever a regra de novo.
  for (const arquivo of ORIENTACOES) {
    assert.match(
      ler(arquivo),
      /recebe o \*\*serviço\*\*/,
      `${arquivo} precisa dizer que defineTool recebe o serviço`,
    );
  }
});

test("a separação entre ler e gravar está dita nos dois textos", () => {
  // Sem isto, a tool "gerenciar_X" parece conveniente — e destrói a
  // granularidade de aprovação de quem opera o agente.
  for (const arquivo of ORIENTACOES) {
    assert.match(
      ler(arquivo),
      /nunca mistura leitura e escrita/i,
      `${arquivo} precisa dizer que ler e gravar são tools separadas`,
    );
  }
});

/** Blocos de código de um markdown, na ordem em que aparecem. */
function blocosDeCodigo(markdown: string): string[] {
  // Um bloco começa numa cerca ``` e termina na próxima: os índices pares são
  // texto, os ímpares são código.
  return markdown.split("```").filter((_, indice) => indice % 2 === 1);
}

/**
 * Texto com o conteúdo das strings apagado, preservando o comprimento.
 *
 * Existe porque a contagem de parênteses abaixo é sintática: o exemplo de
 * serviço tem um SQL com `(org_id, ...)` dentro de uma string, e contar aqueles
 * parênteses faria a chamada "fechar" no lugar errado.
 */
function semStrings(codigo: string): string {
  let fora = "";
  let aspa: string | null = null;
  for (const caractere of codigo) {
    if (aspa) {
      fora += caractere === aspa ? caractere : " ";
      if (caractere === aspa) aspa = null;
      continue;
    }
    if (caractere === '"' || caractere === "'" || caractere === "`") aspa = caractere;
    fora += caractere;
  }
  return fora;
}

/**
 * Cada chamada de `fabrica(...)` do markdown, uma por item.
 *
 * Validar o bloco inteiro deixaria os campos de uma chamada satisfazerem as
 * asserções de outra: dois exemplos na mesma cerca, um deles sem `permission:`,
 * e o teste passaria porque o vizinho tem. É por chamada, então.
 */
function chamadas(markdown: string, fabrica: string): string[] {
  const encontradas: string[] = [];

  for (const bloco of blocosDeCodigo(markdown)) {
    const mascarado = semStrings(bloco);
    const marcador = `${fabrica}(`;
    let inicio = mascarado.indexOf(marcador);

    while (inicio !== -1) {
      let profundidade = 0;
      let fim = -1;
      for (let i = inicio + marcador.length - 1; i < mascarado.length; i += 1) {
        const caractere = mascarado[i];
        if (caractere === "(" || caractere === "{" || caractere === "[")
          profundidade += 1;
        else if (caractere === ")" || caractere === "}" || caractere === "]") {
          profundidade -= 1;
          if (profundidade === 0) {
            fim = i + 1;
            break;
          }
        }
      }
      if (fim === -1) break; // chamada não fechada: o markdown está truncado
      encontradas.push(bloco.slice(inicio, fim));
      inicio = mascarado.indexOf(marcador, fim);
    }
  }

  return encontradas;
}

test("a extração pega uma chamada por vez, e não o bloco inteiro", () => {
  // O teste do próprio instrumento: sem ele, uma extração quebrada faria os dois
  // testes abaixo passarem por vacuidade — o pior tipo de teste verde.
  const markdown = [
    "```ts",
    'defineService({ name: "a", permission: "a", input: z.object({}), kind: "read" });',
    'defineService({ name: "b" });',
    "```",
  ].join("\n");

  const achadas = chamadas(markdown, "defineService");
  assert.equal(achadas.length, 2, "duas chamadas, dois itens");
  assert.match(achadas[0] ?? "", /permission:/);
  assert.doesNotMatch(
    achadas[1] ?? "",
    /permission:/,
    "a segunda chamada não pode herdar os campos da primeira",
  );

  // E a máscara de strings: parêntese dentro de texto não fecha a chamada.
  const comSql = [
    "```ts",
    'defineService({ sql: "values (1, 2)", name: "c" });',
    "```",
  ].join("\n");
  assert.equal(chamadas(comSql, "defineService").length, 1);
  assert.match(chamadas(comSql, "defineService")[0] ?? "", /name: "c"/);
});

test("nenhum exemplo de tool declara kind ou permission", () => {
  // O exemplo é o que acaba copiado. `kind` e `permission` são DERIVADOS do
  // serviço justamente para não existirem duas declarações capazes de divergir —
  // um exemplo que os declarasse na tool ensinaria a criar a divergência que o
  // resto do desenho existe para impedir.
  const exemplos = chamadas(ler("AGENTS.md"), "defineTool");
  assert.ok(exemplos.length > 0, "AGENTS.md precisa ter um exemplo de defineTool");

  for (const exemplo of exemplos) {
    assert.match(exemplo, /service:/, "o exemplo precisa apontar para o serviço");
    for (const proibido of [/\bkind:/, /\bpermission:/]) {
      assert.doesNotMatch(
        exemplo,
        proibido,
        `exemplo de defineTool declarando ${String(proibido)} — isto sai do serviço`,
      );
    }
  }
});

test("todo exemplo de serviço declara a permissão", () => {
  // `permission` ausente não é "público": é erro de definição, e `defineService`
  // recusa. Um exemplo sem o campo ensinaria a esquecer justamente o campo que
  // separa público por decisão de público por descuido.
  const exemplos = chamadas(ler("AGENTS.md"), "defineService");
  assert.ok(exemplos.length > 0, "AGENTS.md precisa ter um exemplo de defineService");

  for (const exemplo of exemplos) {
    for (const campo of [/\bname:/, /\bpermission:/, /\binput:/, /\bkind:/]) {
      assert.match(
        exemplo,
        campo,
        `exemplo de defineService sem ${String(campo)} — o agente copia o que falta`,
      );
    }
  }
});

test("o mapa de pastas conhece as portas", () => {
  // Uma pasta que não está no mapa é uma pasta que o agente reinventa ao lado.
  const agents = ler("AGENTS.md");
  for (const pasta of ["lib/services/", "lib/mcp/", "lib/http/"]) {
    assert.ok(
      agents.includes(pasta),
      `AGENTS.md não menciona ${pasta} — o agente vai criar outro lugar para a mesma coisa`,
    );
  }
});
