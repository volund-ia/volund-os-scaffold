import { NextResponse } from "next/server";

import { readAuthConfig } from "@/lib/auth/config";
import { TOOLS } from "@/lib/mcp/tools";
import {
  INTROSPECTION_PATH,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySignature,
} from "@/lib/volund/introspection";

/**
 * `GET /api/_volund/surface` — a superfície deste App, **sem filtro** (contrato 4).
 *
 * Quem chama é a PLATAFORMA, para conferir se o que este App declarou é o que
 * ele de fato expõe. Nenhum agente e nenhuma pessoa usam esta rota.
 *
 * ## Sem filtro é o ponto inteiro
 *
 * O `tools/list` do endpoint MCP é filtrado por `can()`, com o sujeito de quem
 * pergunta. Comparar o snapshot declarado contra uma lista filtrada acusaria
 * deriva falsa — e esconderia justamente a deriva real, porque uma tool que
 * exige chave fora do catálogo continuaria filtrada. Aqui a lista sai inteira.
 *
 * É por isso que esta rota não é para gente: a lista completa entrega o desenho
 * interno do App, e o `tools/list` filtrado existe exatamente para não fazer
 * isso. Quem passa é quem prova posse do segredo compartilhado.
 *
 * ## `endpoints: null` é uma resposta, não um esquecimento
 *
 * As tools têm registro (`lib/mcp/tools.ts`), então saem daqui com nome,
 * natureza e permissão DERIVADOS do serviço — os mesmos valores que o reporte
 * declara. Os endpoints HTTP **não têm registro** neste contrato: eles são
 * arquivos de rota, e a permissão que cada um exige vive dentro do serviço que
 * ele chama.
 *
 * Devolver `[]` seria pior que não responder: a plataforma leria "este App não
 * expõe endpoint nenhum" e marcaria como deriva todo endpoint declarado. Deriva
 * falsa é o modo de falhar que a verificação inteira existe para evitar.
 *
 * Então `null` diz "esta versão não introspecta endpoints", e a plataforma pula
 * essa metade da comparação em vez de inventar um veredito sobre ela. Um
 * registro de rotas — que tornaria o endpoint derivável como a tool — é assunto
 * de um contrato futuro.
 *
 * ## Enumerada em `PUBLIC_ROUTES`, e por quê
 *
 * "Pública" ali significa dispensada do portão de **cookie**: quem chama é a
 * plataforma, servidor a servidor, e não tem cookie nenhum. O portão continua
 * existindo e é a assinatura conferida abaixo — um portão trocado por outro,
 * não removido.
 *
 * OpenSpec (VolundOS): add-app-api-and-mcp · Fase 4 (4.3)
 */

export const dynamic = "force-dynamic";

/** O número desta forma de resposta. Ver o uso na plataforma. */
const CONTRACT = 4;

/**
 * Recusa única, com o motivo só no log.
 *
 * A resposta não distingue "faltou assinatura" de "assinatura não confere": quem
 * conseguisse separar os casos ganharia um oráculo sobre a própria assinatura. O
 * `contract` VAI no corpo de propósito — é ele que permite à plataforma
 * distinguir "este App tem a rota e recusou" de "este App nem tem a rota", que é
 * o 401 do portão de um App em contrato anterior.
 */
function recusa() {
  return NextResponse.json(
    { error: "invalid_signature", contract: CONTRACT },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  let secret: string;
  try {
    secret = readAuthConfig().clientSecret;
  } catch (err) {
    // Sem a configuração não há como conferir nada. É falha nossa, e degradar
    // para acesso aberto seria trocar um problema de configuração por um
    // vazamento do desenho interno.
    console.error("[volund] introspecção sem configuração de autenticação:", err);
    return NextResponse.json(
      { error: "not_configured", contract: CONTRACT },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const outcome = verifySignature({
    secret,
    path: INTROSPECTION_PATH,
    timestampHeader: request.headers.get(TIMESTAMP_HEADER),
    signatureHeader: request.headers.get(SIGNATURE_HEADER),
  });

  if (!outcome.ok) {
    console.warn(`[volund] introspecção recusada: ${outcome.reason}`);
    return recusa();
  }

  // A lista INTEIRA, na ordem do registro. `kind` e `permission` vêm do serviço,
  // como em todo o resto — a tool não tem opinião própria sobre eles, e é isso
  // que faz esta resposta ser comparável com o que foi declarado.
  const tools = Object.values(TOOLS).map((tool) => ({
    name: tool.name,
    kind: tool.kind,
    permission: tool.permission,
  }));

  return NextResponse.json(
    { contract: CONTRACT, tools, endpoints: null },
    { headers: { "cache-control": "no-store" } },
  );
}
