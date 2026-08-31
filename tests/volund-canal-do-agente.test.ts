// O canal de agentes do App (contrato 8): a travessia da identidade de quem usa
// a aplicação até a plataforma, e o roteiro do que este App oferece.
//
// O que estes casos protegem, em uma frase cada:
//
//  - O pedido de troca é conferido contra `contracts/agent-channel.json`, e não
//    contra literais repetidos aqui. Um valor mudado no código sem mudar o
//    contrato falha; mudado nos dois, passa — que é exatamente a coordenação que
//    o arquivo de contrato existe para forçar.
//  - O token trocado é reaproveitado, MAS nunca entre pessoas. O caso da troca de
//    usuário está armado: ele confere QUAL `subject_token` foi enviado na segunda
//    ida, e não só que houve uma segunda ida.
//  - O identificador do agente é recebido e RETIDO. Conferir só que ele não
//    aparece na lista mediria o próprio silêncio — o caso também prova que ele
//    chegou, pedindo a resolução pelo apelido logo em seguida.
//  - "Este app não oferece agente nenhum" é um estado, não um defeito, e sai com
//    409 em vez de 5xx.
//
// O provedor é de mentira, com `globalThis.fetch` trocado — mesmo harness de
// `tests/auth-session.test.ts`, repetido de propósito: cada teste deste scaffold
// roda sozinho.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";

import type { AuthConfig } from "../lib/auth/config";
import { base64UrlEncode } from "../lib/auth/crypto";
import { resetDiscoveryCacheForTests } from "../lib/auth/discovery";
import type { Session } from "../lib/auth/session";
import {
  ACCESS_TOKEN_TYPE,
  AGENTS_RUN_SCOPE,
  AgentChannelError,
  PLATFORM_API_PATH,
  TOKEN_EXCHANGE_GRANT,
  exchangeForPlatformToken,
  listAppAgents,
  platformApiResource,
  resetAgentChannelCacheForTests,
  resolveAgentId,
  selectAgent,
  type AppAgent,
} from "../lib/volund/agents";
import { agentChannelResponse } from "../lib/volund/channel-http";

const ISSUER = "https://provedor.exemplo.test";
const APP_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/** Com `:` de propósito: é o caractere que quebra o `Basic` sem percent-encoding. */
const SEGREDO = "seg:redo com espaço";

const config: AuthConfig = {
  issuer: ISSUER,
  clientId: "client-do-app",
  clientSecret: SEGREDO,
  appId: APP_ID,
};

const contrato = JSON.parse(
  readFileSync(new URL("../contracts/agent-channel.json", import.meta.url), "utf8"),
) as {
  contract: number;
  exchange: Record<string, string>;
  roster: { path: string; fields: string[]; serverOnlyFields: string[] };
};

function sessao(userId: string, accessToken: string): Session {
  return {
    userId,
    orgId: "org-1",
    appId: APP_ID,
    email: null,
    name: null,
    roles: [],
    permissions: [],
    accessToken,
  };
}

/** Um token cujo `exp` é lido sem verificação — é assim que o cache decide. */
function tokenComExp(exp: number): string {
  const parte = (o: unknown) =>
    base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)));
  return `${parte({ alg: "none" })}.${parte({ exp })}.assinatura`;
}

const AGORA = Math.floor(Date.now() / 1000);

interface Pedido {
  url: string;
  authorization: string;
  form: URLSearchParams;
}

/** Cada ida ao token endpoint, na ordem. */
let trocas: Pedido[] = [];
/** Cada ida ao roteiro. */
let leiturasDoRoteiro = 0;
/** O que o token endpoint responde AGORA. */
let respostaDaTroca: { status: number; body: unknown } = {
  status: 200,
  body: { access_token: tokenComExp(AGORA + 600), expires_in: 600 },
};
/** O que o roteiro responde AGORA. */
let respostaDoRoteiro: { status: number; body: unknown } = {
  status: 200,
  body: {
    agents: [
      {
        key: "suporte",
        agent_id: "agente-suporte-1",
        name: "Suporte",
        description: "Tira dúvidas de quem usa o app.",
        avatar: null,
        is_default: true,
      },
      {
        key: "cobranca",
        agent_id: "agente-cobranca-2",
        name: "Cobrança",
        description: null,
        avatar: "https://exemplo.test/avatar.png",
        is_default: false,
      },
    ],
  },
};

beforeEach(() => {
  resetDiscoveryCacheForTests();
  resetAgentChannelCacheForTests();
  trocas = [];
  leiturasDoRoteiro = 0;
  respostaDaTroca = {
    status: 200,
    body: { access_token: tokenComExp(AGORA + 600), expires_in: 600 },
  };
  respostaDoRoteiro = {
    status: 200,
    body: {
      agents: [
        {
          key: "suporte",
          agent_id: "agente-suporte-1",
          name: "Suporte",
          description: "Tira dúvidas de quem usa o app.",
          avatar: null,
          is_default: true,
        },
        {
          key: "cobranca",
          agent_id: "agente-cobranca-2",
          name: "Cobrança",
          description: null,
          avatar: "https://exemplo.test/avatar.png",
          is_default: false,
        },
      ],
    },
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth/authorize`,
        token_endpoint: `${ISSUER}/oauth/token`,
        userinfo_endpoint: `${ISSUER}/oauth/userinfo`,
        jwks_uri: `${ISSUER}/oauth/jwks`,
      });
    }

    if (url === `${ISSUER}/oauth/token`) {
      const headers = new Headers(init?.headers);
      trocas.push({
        url,
        authorization: headers.get("authorization") ?? "",
        form: new URLSearchParams(String(init?.body ?? "")),
      });
      return Response.json(respostaDaTroca.body, { status: respostaDaTroca.status });
    }

    if (url === `${ISSUER}${contrato.roster.path}`) {
      leiturasDoRoteiro += 1;
      return Response.json(respostaDoRoteiro.body, {
        status: respostaDoRoteiro.status,
      });
    }

    throw new Error(`fetch inesperado: ${url}`);
  }) as typeof fetch;
});

/**
 * O pedido de troca na posição pedida.
 *
 * Existe porque indexar um array devolve `T | undefined` neste projeto, e a
 * saída fácil (`!`) transformaria "não houve pedido nenhum" num erro de
 * propriedade três linhas abaixo, em vez da frase que diz o que faltou.
 */
function troca(i: number): Pedido {
  const pedido = trocas[i];
  assert.ok(pedido, `esperava um pedido de troca na posição ${i}`);
  return pedido;
}

/** O agente na posição pedida, pelo mesmo motivo. */
function agenteEm(lista: AppAgent[], i: number): AppAgent {
  const agente = lista[i];
  assert.ok(agente, `esperava um agente na posição ${i}`);
  return agente;
}

test("o recurso nomeado no pedido é derivado do emissor, não escrito à mão", () => {
  assert.equal(platformApiResource(ISSUER), `${ISSUER}${PLATFORM_API_PATH}`);
  // Um segundo emissor mata a versão que devolvesse a produção fixa: em prévia e
  // no ambiente local o `resource` tem de acompanhar, senão a plataforma recusa
  // com `invalid_target` e a mensagem fala do app errado.
  assert.equal(
    platformApiResource("https://outro.exemplo.test"),
    "https://outro.exemplo.test/api/v1",
  );
});

test("o pedido de troca leva exatamente o que o contrato descreve", async () => {
  await exchangeForPlatformToken(sessao("pessoa-1", "token-da-sessao-1"), config);

  assert.equal(trocas.length, 1);
  const { form } = troca(0);

  // Contra o CONTRATO, e não contra literais repetidos aqui: mudar o código sem
  // mudar `contracts/agent-channel.json` falha nesta linha.
  assert.equal(form.get("grant_type"), contrato.exchange.grant_type);
  assert.equal(form.get("subject_token_type"), contrato.exchange.subject_token_type);
  assert.equal(
    form.get("requested_token_type"),
    contrato.exchange.requested_token_type,
  );
  assert.equal(form.get("scope"), contrato.exchange.scope);
  assert.equal(form.get("resource"), `${ISSUER}${contrato.exchange.resource_path}`);

  // E o que o código exporta é o mesmo que o contrato diz — sem isto, o teste
  // acima poderia passar com o contrato descrevendo outra coisa.
  assert.equal(TOKEN_EXCHANGE_GRANT, contrato.exchange.grant_type);
  assert.equal(ACCESS_TOKEN_TYPE, contrato.exchange.subject_token_type);
  assert.equal(AGENTS_RUN_SCOPE, contrato.exchange.scope);

  // O sujeito é o token da SESSÃO de quem está usando a aplicação.
  assert.equal(form.get("subject_token"), "token-da-sessao-1");
});

test("o App se autentica com o próprio segredo, percent-encoded", async () => {
  await exchangeForPlatformToken(sessao("pessoa-1", "token-1"), config);

  const [tipo, valor] = troca(0).authorization.split(" ");
  assert.equal(tipo, "Basic");
  assert.ok(valor);
  const [id, segredo] = Buffer.from(valor, "base64").toString("utf8").split(":");
  assert.ok(id);
  assert.ok(segredo);
  assert.equal(decodeURIComponent(id), config.clientId);
  // Sem o percent-encoding, o `:` do segredo criaria um terceiro pedaço e a
  // decodificação do outro lado entregaria um segredo truncado — com o segredo
  // certo dos dois lados.
  assert.equal(decodeURIComponent(segredo), SEGREDO);
});

test("o token trocado é reaproveitado enquanto vale", async () => {
  const pessoa = sessao("pessoa-1", "token-1");
  const exp = 1_000_000;
  respostaDaTroca = { status: 200, body: { access_token: tokenComExp(exp) } };

  await exchangeForPlatformToken(pessoa, config, exp - 600);
  await exchangeForPlatformToken(pessoa, config, exp - 300);
  assert.equal(trocas.length, 1);
});

test("e é refeito quando falta pouco para o token vencer", async () => {
  const pessoa = sessao("pessoa-1", "token-1");
  const exp = 1_000_000;
  respostaDaTroca = { status: 200, body: { access_token: tokenComExp(exp) } };

  await exchangeForPlatformToken(pessoa, config, exp - 600);
  // Dentro da folga de 60s: usar o token aqui seria disparar uma conversa com
  // uma credencial que expira no meio dela.
  await exchangeForPlatformToken(pessoa, config, exp - 30);
  assert.equal(trocas.length, 2);
});

test("o token de uma pessoa nunca serve para outra", async () => {
  const exp = 1_000_000;
  respostaDaTroca = { status: 200, body: { access_token: tokenComExp(exp) } };

  await exchangeForPlatformToken(sessao("pessoa-1", "sessao-da-1"), config, exp - 600);
  await exchangeForPlatformToken(sessao("pessoa-2", "sessao-da-2"), config, exp - 600);

  assert.equal(trocas.length, 2);
  // O caso ARMADO: não basta ter havido uma segunda ida. A segunda tem de levar
  // o token da SEGUNDA pessoa — um cache com chave errada iria de novo e ainda
  // assim disparia a conversa dela no nome da primeira.
  assert.equal(troca(0).form.get("subject_token"), "sessao-da-1");
  assert.equal(troca(1).form.get("subject_token"), "sessao-da-2");
});

test("app sem agente vinculado é um estado, e é dito como tal", async () => {
  respostaDaTroca = { status: 400, body: { error: "invalid_target" } };

  const erro = await exchangeForPlatformToken(
    sessao("pessoa-1", "token-1"),
    config,
  ).then(
    () => null,
    (e: unknown) => e,
  );

  assert.ok(erro instanceof AgentChannelError);
  assert.equal(erro.code, "sem_agente");
  // 409, e não 5xx: "tente de novo" não resolve — o que resolve é alguém
  // vincular um agente no painel.
  assert.equal(agentChannelResponse(erro).status, 409);
});

test("qualquer outra recusa da troca é indisponibilidade", async (t) => {
  t.mock.method(console, "error", () => {});
  respostaDaTroca = { status: 400, body: { error: "invalid_grant" } };

  const erro = await exchangeForPlatformToken(
    sessao("pessoa-1", "token-1"),
    config,
  ).then(
    () => null,
    (e: unknown) => e,
  );

  assert.ok(erro instanceof AgentChannelError);
  assert.equal(erro.code, "indisponivel");
  assert.equal(agentChannelResponse(erro).status, 503);
});

test("o roteiro chega traduzido, e sem o identificador do agente", async () => {
  const pessoa = sessao("pessoa-1", "token-1");
  const agents = await listAppAgents(pessoa, config);

  assert.deepEqual(
    agents.map((a) => a.key),
    ["suporte", "cobranca"],
  );
  assert.equal(agenteEm(agents, 0).name, "Suporte");
  assert.equal(agenteEm(agents, 0).isDefault, true);
  assert.equal(agenteEm(agents, 1).description, null);
  assert.equal(agenteEm(agents, 1).avatar, "https://exemplo.test/avatar.png");

  // O identificador NÃO viaja para a tela.
  const serializado = JSON.stringify(agents);
  assert.ok(!serializado.includes("agente-suporte-1"));
  assert.ok(!serializado.includes("agent_id"));

  // E o caso está ARMADO: ele chegou de fato, e foi RETIDO. Sem esta linha, o
  // teste acima passaria também se o roteiro nunca tivesse trazido o campo — que
  // é o oposto do que se quer provar.
  const { agentId } = await resolveAgentId(pessoa, "suporte", config);
  assert.equal(agentId, "agente-suporte-1");
  assert.deepEqual(contrato.roster.serverOnlyFields, ["agent_id"]);
});

test("o roteiro é lido uma vez e reusado dentro da janela", async () => {
  const pessoa = sessao("pessoa-1", "token-1");
  await listAppAgents(pessoa, config);
  await listAppAgents(pessoa, config);
  await resolveAgentId(pessoa, null, config);
  assert.equal(leiturasDoRoteiro, 1);
});

test("sem apelido vale o padrão; sem padrão, o primeiro", async () => {
  const pessoa = sessao("pessoa-1", "token-1");
  const { agent } = await resolveAgentId(pessoa, null, config);
  assert.equal(agent.key, "suporte");

  const semPadrao: AppAgent[] = [
    { key: "b", name: "B", description: null, avatar: null, isDefault: false },
    { key: "c", name: "C", description: null, avatar: null, isDefault: false },
  ];
  // "Sem padrão" é um estado possível — a promoção pode ter falhado no painel —
  // e abrir sem agente nenhum seria pior que abrir com o primeiro.
  assert.equal(selectAgent(semPadrao, null)?.key, "b");
  assert.equal(selectAgent(semPadrao, "c")?.key, "c");
  assert.equal(selectAgent(semPadrao, "z"), null);
});

test("apelido que o app não oferece é recusado, e não cai no padrão", async () => {
  const pessoa = sessao("pessoa-1", "token-1");
  const erro = await resolveAgentId(pessoa, "inventado", config).then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(erro instanceof AgentChannelError);
  assert.equal(erro.code, "sem_agente");
});

test("roteiro vazio é o mesmo estado de app sem agente", async () => {
  respostaDoRoteiro = { status: 200, body: { agents: [] } };
  const erro = await listAppAgents(sessao("pessoa-1", "token-1"), config).then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(erro instanceof AgentChannelError);
  assert.equal(erro.code, "sem_agente");
});

test("roteiro em formato inesperado não vira agente sem nome na tela", async (t) => {
  t.mock.method(console, "error", () => {});
  respostaDoRoteiro = {
    status: 200,
    body: { agents: [{ key: "suporte", agent_id: "x", is_default: true }] },
  };
  const erro = await listAppAgents(sessao("pessoa-1", "token-1"), config).then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(erro instanceof AgentChannelError);
  assert.equal(erro.code, "indisponivel");
});

test("os três números de contrato andam juntos", () => {
  const manifesto = JSON.parse(
    readFileSync(new URL("../volund-scaffold.json", import.meta.url), "utf8"),
  ) as { contract: number };
  const claims = JSON.parse(
    readFileSync(new URL("../contracts/auth-claims.json", import.meta.url), "utf8"),
  ) as { contract: number };

  assert.equal(contrato.contract, manifesto.contract);
  assert.equal(claims.contract, manifesto.contract);
});
