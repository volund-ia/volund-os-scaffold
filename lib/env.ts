/**
 * Leitura de variáveis de ambiente em UM lugar, validada na primeira vez que é
 * usada.
 *
 * O motivo de existir: `process.env.X` espalhado pelo código falha tarde e
 * fala pouco — a página quebra com "cannot read property of undefined" três
 * camadas abaixo, em produção, e ninguém liga o erro à variável que faltou.
 * Aqui a falta vira uma mensagem que diz o nome da variável e o que fazer.
 *
 * Validação preguiçosa (não no import) de propósito: durante o `next build` a
 * `DATABASE_URL` pode não existir ainda — o banco é provisionado pela
 * plataforma, e um build que exige a variável no import quebraria antes de a
 * aplicação existir.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Variável de ambiente ${name} não definida. No VolundOS ela é injetada pela plataforma; localmente, copie .env.example para .env.local e preencha.`,
    );
  }
  return value;
}

export const env = {
  /** Conexão com o Postgres da aplicação. Injetada pela plataforma. */
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },
  /** `true` quando roda em produção (build do provedor de deploy). */
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
};
