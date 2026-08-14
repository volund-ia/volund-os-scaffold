import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * O metadado de recurso protegido (RFC 9728) no caminho que a spec define.
   *
   * O handler mora em `app/api/oauth-protected-resource` porque pasta iniciada
   * por ponto dependeria de o scanner de rotas do Next não a ignorar — a mesma
   * aposta que já custou uma release quando `_volund` virou pasta privada. O
   * rewrite fixa o caminho público de forma determinística.
   */
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/oauth-protected-resource",
      },
    ];
  },

  // O app roda em modo de desenvolvimento DENTRO do sandbox e é exibido ao
  // usuário num iframe servido pelo proxy do ambiente (`<porta>-<id>.e2b.app`).
  //
  // Sem isto o Next devolve **403 em todo `/_next/*`**: ele bloqueia por padrão
  // requisições cross-origin a recursos de desenvolvimento
  // (`server/lib/router-utils/block-cross-site-dev.ts`). O HTML até carrega, mas
  // nenhum chunk de JS e nenhum WebSocket de recarga automática passam — a tela
  // fica em branco sem erro visível para o usuário.
  //
  // Só afeta `next dev`; o build de produção ignora esta chave.
  allowedDevOrigins: ["*.e2b.app"],
};

export default nextConfig;
