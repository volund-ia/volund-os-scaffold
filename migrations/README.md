# Migrações

**Todo SQL aplicado ao banco vira um arquivo aqui.** Sem isso o schema existe só
dentro do Postgres: clonar este repositório e apontar para um banco novo não
reconstrói a aplicação, e ninguém consegue revisar uma mudança de schema.

## Convenção de nome

```
0001_criar_tabela_clientes.sql
0002_adicionar_indice_email.sql
```

Numeração sequencial de quatro dígitos + descrição em snake_case. A ordem do
nome é a ordem de aplicação.

## Regras

- **Um arquivo por mudança.** Não edite um arquivo já aplicado: a plataforma
  guarda o checksum de cada migração e recusa conteúdo divergente — o que é
  proteção, não obstáculo. Mudou de ideia? Crie a próxima migração.
- **Idempotente onde der** (`create table if not exists`, `add column if not
exists`): a mesma migração pode ser tentada de novo depois de uma falha
  parcial.
- **Sem dado sensível** em `insert` de exemplo. Este repositório é público se
  for um fork do oficial.

## Como aplicar

No VolundOS, o agente aplica pela ferramenta de migração da plataforma, que
registra `migration_id` + checksum. O arquivo aqui é a fonte revisável do que
foi aplicado; o registro no banco é o controle de o que já rodou.

Fora do VolundOS, aplique na ordem com o cliente de sua preferência.
