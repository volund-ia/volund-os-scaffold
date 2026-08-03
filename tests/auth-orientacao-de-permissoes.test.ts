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

/**
 * O primeiro argumento de `can()` é a sessão inteira — `session` ou
 * `gate.session` —, e nada mais: a vírgula fecha o argumento.
 */
const PRIMEIRO_ARGUMENTO_E_A_SESSAO = /^(?:\w+\.)?session\s*,/;

test("a regra do primeiro argumento não afrouxa", () => {
  // O padrão é a regra; sem estes casos, um afrouxamento nele passaria calado e
  // levaria junto o teste abaixo, que é quem vigia o texto de verdade.
  for (const aceito of [
    'session, "fechar_mes"',
    'gate.session, "fechar_mes"',
    "session , x",
  ]) {
    assert.match(
      aceito,
      PRIMEIRO_ARGUMENTO_E_A_SESSAO,
      `deveria aceitar: can(${aceito})`,
    );
  }
  for (const recusado of [
    '"fechar_mes"', // o caso real que motivou este teste
    'session.permissions, "fechar_mes"', // um array não é uma Session
    'gate.session.permissions, "fechar_mes"',
    'sessionId, "fechar_mes"', // parecido de menos
  ]) {
    assert.doesNotMatch(
      recusado,
      PRIMEIRO_ARGUMENTO_E_A_SESSAO,
      `deveria recusar: can(${recusado})`,
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
    // O `(?<!function\s)` exclui a DECLARAÇÃO de `can()`, que vive neste mesmo
    // arquivo de orientação: seus parâmetros são `session: Session | null, …`, e
    // ela não é um exemplo de chamada. Sem a exclusão, o teste reprovaria a
    // própria assinatura que ele existe para defender.
    const chamadas = [...ler(arquivo).matchAll(/(?<!function\s)\bcan\(([^)]*)\)/g)]
      .map((m) => (m[1] ?? "").trim())
      .filter((args) => args !== "");

    for (const args of chamadas) {
      // A regra é "a sessão é passada", não "a variável se chama session".
      // `gate.session` é o idioma que o próprio AGENTS.md ensina para rota de
      // API, e exigir o nome cru reprovava exemplo correto — foi o que
      // aconteceu ao documentar o inverso de "esconder não é proteger".
      //
      // A vírgula no fim é o que impede o padrão de afrouxar demais: sem ela,
      // `\b` casa também ANTES do ponto, e `can(session.permissions, …)` — que
      // devolve `false` sempre, porque um array não é uma `Session` — passaria.
      // Aqui isso não é hipótese de estilo: em Markdown não há compilador para
      // reprovar o exemplo, e o agente copia o que lê.
      assert.match(
        args,
        PRIMEIRO_ARGUMENTO_E_A_SESSAO,
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
