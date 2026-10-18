# Project Handoff — Widget Encontro Infield 2026 (clima · dias · trânsito) + Assistente Infield

Atualizado: 05/10/2026

## 1. Objetivo
Widget HTML embutido no app do Encontro Infield 2026 (Takeda): clima ao vivo do hotel, contagem de dias para o evento e trânsito aeroporto → hotel.

## 2. Estado atual
| Item | Estado |
|---|---|
| Projeto Netlify | **`infield2026-widgets`** → https://infield2026-widgets.netlify.app (antigo `infield2026-voo-transito`, renomeado) |
| Código | Esta pasta (`encontro-infield/`) no repo `Femartignon/Femartignon` |
| Chave TomTom | Env var `TOMTOM_API_KEY` no projeto `infield2026-widgets` (cadastrada; **marcar como secret pela interface**) |
| Deploy | **Pendente:** ligar o projeto ao GitHub (base directory `encontro-infield`) |
| App | **Pendente:** trocar o endereço do widget para https://infield2026-widgets.netlify.app |
| Projeto Vercel | **`encontro-Infield-2026`** · Root Directory = `encontro-infield` · hospeda o **Assistente Infield** (`/agente.html` + `/api/agente`) · **Pendente:** criar o projeto e cadastrar `ANTHROPIC_API_KEY` (Sensitive) |
| App — menu Mais | **Pendente:** item "Assistente Infield" → `https://<domínio-vercel>/agente.html`, ícone `public/img/agente-icone.png` |
| Projeto `polite-stroopwafel-cfdd45` | **Widget que está no app hoje** (clima · dias · faixa de voos AviationStack). Ver **`HANDOFF-WIDGET.md`** e pasta `site/` |

## 3. Estrutura
```
encontro-infield/
├─ package.json                    ai + @ai-sdk/anthropic + zod · npm test
├─ package-lock.json
├─ vercel.json                     inclui agente/** na função do Vercel
├─ netlify.toml                    publish=public · functions=netlify/functions
├─ public/index.html               widget (arquivo único, fontes embutidas)
├─ public/img/*.webp               6 fotos de clima
├─ public/agente.html              chat do Assistente Infield (Vercel)
├─ public/img/agente-icone.*       ícone do menu Mais (SVG + PNG 512)
├─ public/img/agente-fundo.webp    arte de fundo do chat (Takeda + assistente, Rio)
├─ public/fonts/gotham-bold.otf    Gotham da página do agente
├─ public/banners/*.webp           banners 1080×1080 do app (pré-evento, 02, 09, 15–19/11 + pós-evento); URLs via jsDelivr
├─ api/agente.mjs                  POST /api/agente (Vercel Function)
├─ agente/agente.mjs               instruções, validação, chamada ao Claude
├─ agente/ferramentas.mjs          clima · trânsito · data e contagem
├─ agente/conhecimento.md          FONTE ÚNICA do que o agente sabe do evento
├─ agente/faq.mjs                  modo sem chave: responde da base + ferramentas ao vivo
├─ agente/teste.mjs                teste sem chave e sem rede (npm test)
└─ netlify/functions/transito.mjs  GET /api/transito (TomTom, cache CDN 10 min)
```

## 4. Widget (public/index.html)
- Card ~403×214 px CSS; duas colunas independentes (flex), faixa vermelha no topo.
- **Esquerda — clima:** Open-Meteo, refresh 15 min, cache `localStorage`, retry 3 s; foto de fundo por condição (`photoFor`), tom claro/escuro em `#wxPane` + `#veil`. Params de URL `lat`, `lon`, `label`.
- **Direita — dias:** placa split-flap (Bebas Neue) com **dias de calendário** (fuso Brasília) até `EVENT_START = 2026-11-16T07:59-03:00`; véspera "01 dia"; dia 16 "É hoje!"; depois "Evento realizado".
- **Direita — trânsito:** `fetch('/api/transito')` a cada 5 min; GIG e SDU com barra por trechos (verde/âmbar/vermelho), minutos, nível e "+X min"; falha → "Trânsito indisponível no momento".

## 5. Função (netlify/functions/transito.mjs)
- TomTom Routing `calculateRoute` com `traffic=true`, `computeTravelTimeFor=all`, `sectionType=traffic`.
- Nível do trajeto: tempo/tempo-sem-trânsito < 1,15 livre · < 1,4 moderado · ≥ 1,4 intenso.
- Trechos da barra: seções TRAFFIC (`magnitudeOfDelay` ≥3 intenso; ≥1 ou JAM moderado), proporcionais à distância.
- Cache: `Netlify-CDN-Cache-Control: durable, s-maxage=600` → ~290 chamadas/dia, independente do nº de participantes.
- Coordenadas: hotel −23.0045, −43.3187 (mesmas do widget original) · GIG −22.8099, −43.2506 · SDU −22.9105, −43.1631. **Conferir a coordenada do Grand Hyatt.**

## 5b. Assistente Infield (Vercel)
- **Página:** `public/agente.html` — chat mobile (tela cheia, claro/escuro, sugestões, "Nova conversa"). Fundo = `img/agente-fundo.webp` com véu e superfícies translúcidas; no celular o recorte mostra o assistente, em telas largas a arte inteira com a coluna do chat entre o logo e o assistente. Conversa guardada só na aba (`sessionStorage`). Texto da IA é escapado antes de formatar (sem HTML injetado).
- **Rota:** `POST /api/agente` · corpo `{ mensagens: [{ role, content }] }` · resposta em texto streaming. Limites: 20 mensagens, 2.000 caracteres cada.
- **Dois modos (automático):** sem `ANTHROPIC_API_KEY` no Vercel, a rota responde direto da base (`agente/faq.mjs`, por palavras-chave, mesmas ferramentas ao vivo). Com a chave cadastrada + redeploy, passa a responder com o Claude.
- **Modelo:** Claude Opus 5.5 (`claude-opus-5-5`) via Vercel AI SDK · `effort: low` · `fallbacks: default` (recusa de classificador → modelo de fallback) · cache de prompt automático.
- **Ferramentas:** `clima` (Open-Meteo, até 14 dias) · `transito` (reusa `infield2026-widgets.netlify.app/api/transito`; trocar por env `TRANSITO_URL`) · `data_e_contagem` (fuso Brasília).
- **Regras:** responde só com a base de conhecimento; "A CONFIRMAR" = não inventa. Sem tema médico/produto, sem dados pessoais.
- **Alterar respostas:** editar `agente/conhecimento.md` → commit no `main` → deploy automático.
- **Risco aberto:** rota pública sem autenticação nem limite por usuário. Monitorar uso no console da Anthropic; se preciso, ativar Firewall/rate limit do Vercel.

## 6. Decisões tomadas
- Sem conteúdo de lazer/praia (evento corporativo). Relógio split-flap só com dias. Foto de clima só à esquerda.
- Plataforma do app posiciona widgets **lado a lado** (não empilha) → tudo no mesmo card.
- Voo do participante: **em espera**. Merge tags com 3 colchetes: `[[[activatedPerson.voo_ida_partida]]]`, `[[[activatedPerson.horario_ida]]]` (formato dos valores ainda não verificado).

## 7. Pendências
1. Ligar `infield2026-widgets` ao GitHub (Base directory `encontro-infield`, branch `main`).
2. Marcar `TOMTOM_API_KEY` como secret (Netlify UI → Environment variables → editar).
3. Validar trânsito real após o deploy (este ambiente não alcança a TomTom).
4. Trocar o endereço do widget no app.
5. Data de encerramento do evento ("Evento realizado" aparece a partir de 17/11).
6. Confirmar coordenada do Grand Hyatt.

## 8. Alterações rápidas no evento
- Data alvo → `EVENT_START` em `public/index.html`.
- Trajetos/coordenadas → `ROUTES` e `HOTEL` em `netlify/functions/transito.mjs`.
- Local do clima → params de URL `lat`, `lon`, `label` (sem editar código).
- Com o GitHub ligado, cada commit no `main` publica automaticamente.

## 9. Instruções críticas
- Perguntar antes de agir quando faltar informação; mostrar prévia e aguardar ok.
- Marca Takeda 2026 (`#E1242A`, Gotham). Logo não pode ser recolorido/distorcido.
- Este ambiente bloqueia `*.netlify.app`, Open-Meteo e TomTom: testar com dados simulados.
