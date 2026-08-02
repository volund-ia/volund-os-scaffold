// O texto que instrui o agente é código de produção — e já falhou como tal.
//
// Duas vezes, em Apps diferentes, o agente leu `lib/auth/permissions.ts`, viu
// escrito que o catálogo de permissões "ainda não existe" e que `can()` nega
// todo mundo, e concluiu o razoável: construiu uma lista de administradores
// dentro do banco do próprio App. Nas duas vezes o RBAC da plataforma ficou sem
// uso e o catálogo do App, vazio. Numa delas a lista era conferida contra um
// campo de sessão que vinha nulo, e o App inteiro ficou trancado — nem quem o
// criou executava a ação restrita.
//
// O comentário era verdadeiro quando foi escrito. Deixou de ser quando o
// catálogo entrou no ar, e ninguém o atualizou: nenhum teste olhava para ele.
// Este olha. Não verifica prosa — verifica que os dois textos que o agente lê
// antes de decidir continuam apontando para o caminho certo.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const raiz = path.join(import.meta.dirname, "..");
const ler = (rel: string) => readFileSync(path.join(raiz, rel), "utf8");

/** Os dois lugares que o agente lê antes de decidir como restringir uma ação. */
const ORIENTACOES = ["lib/auth/permissions.ts", "AGENTS.md"] as const;

test("a orientação aponta para a ferramenta que declara o catálogo", () => {
  // Sem este nome, o agente não tem como descobrir o passo 1 — e o passo 1 é o
  // que falta para o RBAC da plataforma sair do papel.
  for (const arquivo of ORIENTACOES) {
    assert.match(
      ler(arquivo),
      /report_app_permissions/,
      `${arquivo} precisa dizer COMO declarar o catálogo`,
    );
  }
});

test("a orientação diz que conceder é ato de uma pessoa, na interface", () => {
  // O segundo passo. Sem ele, "declarei e continua negando" parece defeito, e o
  // agente procura outro caminho — que foi exatamente o que aconteceu.
  for (const arquivo of ORIENTACOES) {
    assert.match(ler(arquivo), /Segurança/, `${arquivo} precisa dizer ONDE se concede`);
  }
});

test("a orientação desaconselha a lista de administradores dentro do App", () => {
  // O anti-padrão observado, dito com todas as letras nos dois arquivos.
  for (const arquivo of ORIENTACOES) {
    assert.match(
      ler(arquivo),
      /lista de administradores/i,
      `${arquivo} precisa nomear o caminho errado, não só descrever o certo`,
    );
  }
});

test("todo exemplo de `can()` na orientação passa a sessão", () => {
  // `can(session, permission)`. Um exemplo escrito como `can("fechar_mes")` não
  // compila em TypeScript e, em JavaScript, deixaria `permission` indefinida —
  // `can()` devolveria `false` e a ação ficaria bloqueada para todo mundo.
  //
  // Aqui isso é pior que um erro de digitação: este texto é INSTRUÇÃO, e o
  // agente copia o que lê. Um exemplo errado vira código errado no App de
  // alguém, com o sintoma "protegi a tela e ninguém entra" — a mesma frustração
  // que mandou dois agentes construírem um RBAC paralelo.
  for (const arquivo of ORIENTACOES) {
    const chamadas = [...ler(arquivo).matchAll(/\bcan\(([^)]*)\)/g)]
      .map((m) => (m[1] ?? "").trim())
      .filter((args) => args !== "");

    for (const args of chamadas) {
      // `^session\b` aceita tanto a chamada (`session, "x"`) quanto a própria
      // declaração da função (`session: Session | null, ...`), que também casa
      // com o padrão e é legítima.
      assert.match(
        args,
        /^session\b/,
        `${arquivo}: \`can(${args})\` — falta a sessão; a assinatura é can(session, permission)`,
      );
    }
  }
});

test("nenhuma orientação afirma, no presente, que o catálogo não existe", () => {
  // A frase que produziu os dois desvios. Pode voltar por descuido num merge ou
  // numa reescrita, e voltaria em silêncio — é comentário.
  //
  // O `(?![a-zà-ú])` distingue a afirmação do RELATO: "o catálogo não existe"
  // manda o agente para o caminho errado; "dizia que o catálogo não existia" é
  // a história de por que este arquivo é assim, e ela deve poder ser contada.
  //
  // Só isto é proibido. Dizer que `can()` nega todo mundo ENQUANTO ninguém
  // concedeu continua certo, e é o que evita que "declarei e continua negando"
  // pareça defeito — vigiar essa frase faria o teste brigar com a verdade.
  const AFIRMACOES_FALSAS = [
    /catálogo[^.]{0,80}não existe(?![a-zà-ú])/i,
    /não existe(?![a-zà-ú])[^.]{0,80}catálogo/i,
  ];

  for (const arquivo of ORIENTACOES) {
    const texto = ler(arquivo);
    for (const afirmacao of AFIRMACOES_FALSAS) {
      assert.doesNotMatch(
        texto,
        afirmacao,
        `${arquivo}: o catálogo existe — esta afirmação manda o agente para o caminho errado`,
      );
    }
  }
});
