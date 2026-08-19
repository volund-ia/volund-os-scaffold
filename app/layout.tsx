import type { Metadata } from "next";
import localFont from "next/font/local";

import "./globals.css";

/**
 * As fontes vivem NO PROJETO, e não em `next/font/google`.
 *
 * O `create-next-app` e o `shadcn init` importam a fonte do Google, e isso faz o
 * `next build` BAIXAR os arquivos de `fonts.gstatic.com` a cada build frio. Não é
 * teoria: um build da própria plataforma caiu com
 * `Can't resolve '@vercel/turbopack-next/internal/font/google/font'`, e o build de
 * um App é o caminho crítico entre o agente terminar e o usuário ver a tela.
 *
 * `next/font/local` sobre arquivos versionados em `public/fonts/` tem os dois
 * lados: a tipografia que o DESIGN.md pede e zero rede no build. São ~100 KB de
 * woff2 latino, ambos SIL Open Font License — os arquivos de licença estão ao
 * lado dos woff2.
 *
 * Inter é VARIÁVEL: um arquivo cobre 400 a 700. É por isso que há um arquivo de
 * texto e três de mono — DM Mono não é variável, então cada peso é um arquivo.
 *
 * Precisa de outra fonte? Ponha o arquivo em `public/fonts/` e carregue aqui do
 * mesmo jeito. O que não se faz é voltar a buscar fonte na rede durante o build.
 */
const sans = localFont({
  src: [
    {
      path: "../public/fonts/inter-latin-variable.woff2",
      weight: "400 700",
      style: "normal",
    },
  ],
  // `--font-sans-local`, e não `--font-sans`: quem monta o token final é o
  // `globals.css`, compondo esta variável com a pilha de fallback. Se as duas
  // tivessem o mesmo nome, a classe que o `next/font` põe no <html> e a regra
  // `:root` disputariam a mesma variável — e quem ganha depende da ordem em que
  // o CSS foi emitido, o que é o tipo de coisa que muda sozinha num upgrade.
  variable: "--font-sans-local",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});

const mono = localFont({
  src: [
    { path: "../public/fonts/dm-mono-300.woff2", weight: "300", style: "normal" },
    { path: "../public/fonts/dm-mono-400.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/dm-mono-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-mono-local",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  title: "App",
  description: "Aplicação criada no VolundOS.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${sans.variable} ${mono.variable} h-full font-sans antialiased`}
    >
      <body className="bg-background text-foreground flex min-h-full flex-col">
        {children}
      </body>
    </html>
  );
}
