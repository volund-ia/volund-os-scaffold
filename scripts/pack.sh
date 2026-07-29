#!/usr/bin/env bash
# Monta o artefato de release: o projeto INTEIRO com `node_modules` instalado,
# num zip que o VolundOS extrai no ambiente do agente.
#
# Por que o artefato carrega `node_modules`: é o que faz o primeiro prompt de um
# App novo não pagar instalação de dependências. Medido no ambiente da
# plataforma: `npm ci` custa ~13s (mais a dependência do registry estar de pé),
# contra ~5s para baixar o zip e ~5s para extrair.
#
# Uso: scripts/pack.sh [saída.zip]
set -euo pipefail

OUT="${1:-scaffold.zip}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -d node_modules ]; then
  echo "[pack] ERRO: node_modules ausente — rode 'npm ci' antes." >&2
  exit 1
fi

# O `.next` de um build local não entra: o agente reescreve a aplicação, então o
# artefato ficaria obsoleto na hora e só engordaria o download. Medido: levar o
# `.next` pronto não acelera o servidor de desenvolvimento (3,9s com ou sem).
rm -rf .next

rm -f "$OUT"
echo "[pack] compactando…"
# -y preserva symlink COMO symlink: `node_modules/.bin/*` são links relativos e,
# sem isso, viram cópias — o layout deixa de refletir o que o npm cria.
#
# Ficam fora a infraestrutura DO SCAFFOLD, que não faz sentido no app gerado:
# histórico git, o CI deste repositório e este próprio script.
zip -q -y -r "$OUT" . \
  -x '.git/*' '.github/*' 'scripts/*' '.next/*' "$OUT"

# Validação do artefato: falhar aqui é muito mais barato que descobrir no
# primeiro App criado a partir desta release.
for entry in package.json .gitignore volund-scaffold.json node_modules/next/package.json node_modules/.bin/next; do
  if ! unzip -l "$OUT" "$entry" >/dev/null 2>&1; then
    echo "[pack] ERRO: entrada ausente no artefato: $entry" >&2
    exit 1
  fi
done

# E o oposto: a infraestrutura DESTE repositório não pode viajar para o app
# gerado. Sem esta guarda, mexer no `-x` acima faria todo App nascer com o CI do
# scaffold dentro — e o padrão só casa na raiz, então `node_modules/*/scripts/`
# (que pacotes de verdade usam) continua intacto.
#
# `grep -c` em vez de `grep -q` de propósito: com `pipefail`, o `-q` sai no
# primeiro match, o `unzip` morre de SIGPIPE e o pipeline inteiro devolve erro —
# o que num `if` vira "condição falsa" e a guarda NUNCA dispara. Descoberto
# testando por mutação, com a guarda já escrita e passando de mentira.
INFRA_NO_ARTEFATO=$(unzip -l "$OUT" | awk '{print $4}' | grep -cE '^(\.github|scripts)/' || true)
if [ "$INFRA_NO_ARTEFATO" -gt 0 ]; then
  echo "[pack] ERRO: o artefato levou a infraestrutura do scaffold (.github/ ou scripts/): ${INFRA_NO_ARTEFATO} entrada(s)." >&2
  exit 1
fi

# O extrator do VolundOS renomeia o pacote a partir deste nome sentinela; se ele
# mudar sem o outro lado saber, todo app gerado nasce chamado "volund-app".
if ! grep -q '"name": "volund-app"' package.json; then
  echo "[pack] ERRO: package.json sem o nome sentinela 'volund-app'." >&2
  exit 1
fi

SIZE_MB=$(( $(stat -c '%s' "$OUT") / 1048576 ))
echo "[pack] OK: $OUT (${SIZE_MB} MiB, $(unzip -l "$OUT" | tail -1 | awk '{print $2}') arquivos)"
