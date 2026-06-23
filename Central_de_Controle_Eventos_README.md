# Central de Controle de Eventos — Takeda

Arquivo: **`Central_de_Controle_Eventos_Takeda.xlsx`**

Central de controle única para gestão dos eventos **FY24, FY25, FY26 e futuros**,
construída a partir do modelo de dados existente e seguindo o **branding Takeda 2026**
(vermelho `#E1242A`, carvão `#34373F`, fontes Aptos).

## Arquitetura

O arquivo aplica uma **arquitetura Big Data Lakehouse (Medallion)** combinada ao
modelo **Deloitte Insight-Driven Organization (IDO)** e aos pilares de
**governança de dados**:

| Camada | Conteúdo | Grão |
|--------|----------|------|
| 🥉 **Bronze** | Dados brutos de origem (planilhas FY24–FY26, NFs, POs, GEARS) | linha-fonte |
| 🥈 **Silver** | Registro mestre de eventos + dimensões normalizadas e bridges | 1 entidade |
| 🥇 **Gold** | Fato única de pagamentos + painéis e indicadores | 1 pagamento / KPI |

## Abas (21)

1. **CAPA** — navegação rápida com hyperlinks
2. **ARQUITETURA** — modelo Deloitte IDO + Medallion + 5 V's do Big Data + governança
3. **PAINEL EXECUTIVO** — KPIs e gráficos consolidados (atualização automática)
4. **PAINEL FINANCEIRO** — top fornecedores, produto, BU, ticket médio
5. **CENTRAL DE EVENTOS** — registro mestre operacional com colunas automáticas
   (Realizado, Dias p/ Close-Out, Situação), listas suspensas e faróis de status
6. **GESTÃO DE DESPESAS** — fato consolidada (488 pagamentos · R$ 31,5 mi)
7. **ALERTAS & COMPLIANCE** — faróis automáticos (close-outs vencidos, POs sem NF, etc.)
8. **NOVO EVENTO** — formulário de entrada padronizado
9. **DICIONÁRIO & GOVERNANÇA** — catálogo de tabelas, campos e regras (LGPD/GEARS)
10–20. **Dimensões** (`DM_CALENDARIO`, `DM_FORNECEDORES`, `DM_CONTA_CONTABIL`,
    `DM_CENTRO_CUSTO`, `DM_STATUS`, `DM_BU_PRODUTO`, `DM_TIPO_SERVICO`,
    `DM_EVENT_XREF`, `DM_EM_GEARS`, `SPEAKERS`) + **PARAMETROS**

## Automação

- KPIs e alertas são **fórmulas vivas** (SUMIF/COUNTIF/SUMPRODUCT) — recalculam
  sozinhos ao atualizar eventos ou despesas; zero retrabalho manual.
- Listas suspensas padronizadas (aba `PARAMETROS`) evitam divergência de nomes.
- Formatação condicional aplica faróis de status e de prazo de close-out.

> Uso interno · Confidencial · Contém dados pessoais de HCPs (LGPD).
