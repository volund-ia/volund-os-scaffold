# Componentes

Componentes de interface reutilizáveis. A convenção:

- **Um componente por arquivo**, nome em `PascalCase` no arquivo e no export.
- **Página não vira componente**: o que é rota vive em `app/`.
- Componente que usa estado, efeito ou evento precisa de `"use client"` no topo.
  Sem isso ele é Server Component e quebra ao usar hook.
- Componente que só apresenta dado **não** busca dado: quem busca é a página (ou
  uma função em `lib/`) e passa por prop. Isso é o que mantém o componente
  testável e a página com uma única responsabilidade de dados.

Quando houver biblioteca de UI instalada, os componentes gerados por ela ficam
em `components/ui/` e os seus, em `components/`.
