import { Pool, type QueryResult, type QueryResultRow } from "pg";

/**
 * Acesso ao Postgres provisionado pela capability de deploy do VolundOS. A
 * `DATABASE_URL` é injetada no ambiente pelo host (`deploy_provision`) — nunca
 * a escreva em arquivo nem a versione.
 *
 * Pool em singleton pendurado no `globalThis`: em serverless cada invocação
 * pode reusar o mesmo processo, e sem o singleton o hot-reload do `next dev` e
 * os re-imports de rota abrem um pool novo a cada vez até estourar o limite de
 * conexões do banco.
 */
declare global {
  var __volundPgPool: Pool | undefined;
}

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL não definida. Rode `deploy_provision` antes de acessar o banco.",
    );
  }

  if (!globalThis.__volundPgPool) {
    // Postgres gerenciado exige TLS. Quando a própria URL já traz `sslmode`,
    // deixamos o `pg` resolver a partir dela; caso contrário ligamos TLS
    // explicitamente — exceto em localhost, onde não há TLS.
    //
    // ATENÇÃO ao `sslmode`: diferente do libpq, o `pg` VERIFICA a cadeia de
    // certificados com `sslmode=require` (medido: provedor com CA própria
    // falha com "self-signed certificate in certificate chain"). Provedores de
    // certificado público (o Postgres provisionado pela plataforma) passam. Se
    // o seu banco usa CA privada, troque para `sslmode=no-verify` na URL —
    // ainda criptografa, só não valida a cadeia.
    const hasSslMode = /[?&]sslmode=/.test(connectionString);
    const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);
    globalThis.__volundPgPool = new Pool({
      connectionString,
      // Serverless: muitas instâncias pequenas, cada uma com pool enxuto.
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ssl: hasSslMode || isLocal ? undefined : { rejectUnauthorized: true },
    });
  }

  return globalThis.__volundPgPool;
}

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}
