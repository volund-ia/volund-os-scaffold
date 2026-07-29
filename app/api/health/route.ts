import { query } from "@/lib/db";

/**
 * Health check da aplicação + do Postgres. Serve como a primeira validação
 * end-to-end depois do deploy: se retorna `ok: true`, o app subiu E a
 * `DATABASE_URL` está válida no runtime do provedor.
 *
 * `force-dynamic` é obrigatório: sem isso o Next tenta pré-renderizar a rota
 * durante o `next build`, quando a `DATABASE_URL` pode ainda não existir, e o
 * build quebra.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await query<{ now: string }>("select now() as now");
    return Response.json({ ok: true, db: res.rows[0]?.now ?? null });
  } catch (err) {
    // O detalhe do erro vai para o log do provedor (visível junto do deploy) e
    // NÃO para a resposta: a rota é pública e a mensagem do driver expõe host,
    // porta e pedaços da configuração de conexão.
    console.error("[health] falha ao consultar o banco:", err);
    return Response.json({ ok: false, error: "banco indisponível" }, { status: 500 });
  }
}
