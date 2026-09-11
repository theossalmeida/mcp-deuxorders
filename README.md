# DeuxOrders MCP

Camada MCP do DeuxOrders. Expõe as operações do sistema como capabilities de domínio para agentes de IA.

```text
Claude Desktop ──(stdio)──┐
                          ├──> DeuxOrders MCP ──> DeuxOrders Backend ──> Services / Database
Hermes ──(HTTP + bearer)──┘
```

Todo cliente consome exatamente as mesmas capabilities — não existe implementação por canal.

O MCP **não** reimplementa regra de negócio. Toda validação de domínio, persistência e geração de documento continua no backend.

Construído com [Invokta](https://github.com/vinilana/invokta): a mesma capability é publicada por MCP HTTP, MCP stdio, CLI e chamada direta, sem código duplicado por canal.

## Instalação

```sh
npm install
cp .env.example .env   # preencha os valores
npm run check          # typecheck + testes + build + conformance MCP
```

Requer Node.js 22.20 ou superior.

## Configuração

| Variável | Obrigatória | Descrição |
|---|---|---|
| `BACKEND_URL` | sim | `https://deux-erp.deuxcerie.com.br/api/v1` (o sufixo `/api/v1` é opcional) |
| `BACKEND_SERVICE_EMAIL` | sim | usuário de serviço do MCP no backend |
| `BACKEND_SERVICE_PASSWORD` | sim | senha desse usuário |
| `MCP_AUTH_TOKEN` | sim | Bearer exigido no canal HTTP (mín. 32 caracteres) |
| `BACKEND_TIMEOUT_MS` | não | padrão `15000` |
| `BACKEND_RETRIES` | não | padrão `2`, só para leituras |
| `BACKEND_MAX_EXPORT_BYTES` | não | padrão `4194304`, teto do arquivo de exportação |
| `INVOKTA_HTTP_HOST` | não | padrão `127.0.0.1` |
| `INVOKTA_HTTP_PORT` | não | padrão `3000` |
| `INVOKTA_HTTP_ALLOWED_HOSTS` | condicional | obrigatória quando o bind não é loopback |
| `INVOKTA_HTTP_ALLOWED_ORIGINS` | não | allowlist de origem para clientes de browser |

Gere o token do MCP com `openssl rand -base64 48`. `.env` não é versionado.

## Autenticação

São duas, distintas e independentes:

**Cliente → MCP.** Todo `POST /mcp` exige `Authorization: Bearer <MCP_AUTH_TOKEN>`. A comparação é em tempo constante; sem token válido, 401. É o canal do Hermes.

O Claude Desktop conecta por **stdio**, onde não há bearer: quem inicia o processo já provou ser o dono da máquina.

ChatGPT web não é suportado — conectores remotos do ChatGPT exigem OAuth e o Authorization Server não foi construído. É aditivo depois, sem mexer em capability nenhuma.

**MCP → Backend.** O connector faz login com o usuário de serviço, guarda o JWT em memória e o renova sozinho. A credencial do backend nunca aparece em prompt, description de tool, resposta ou log — há um teste que verifica isso.

Full access no MVP: cliente autenticado alcança todas as capabilities. Não há RBAC por capability.

## Executando

```sh
npm run mcp:stdio     # Claude Desktop (ou npm run mcp:install para registrar)
npm run mcp:http      # Hermes
npm run devtools      # UI de desenvolvimento: invoca capabilities por qualquer canal
npm run smoke         # varredura de leitura contra o backend real
```

O passo a passo de lançamento está em [`DEPLOY.md`](./DEPLOY.md).

### Testando sem agente nenhum

O CLI executa pelo mesmo pipeline (`engine.invoke`) que o MCP — mesma validação, mesma autorização, mesmo connector:

```sh
npm run cli -- list
npm run cli -- describe orders.search
npm run cli -- run clients.search --input '{"search":"maria"}'
```

## Capabilities

### Datas, receita e Hermes

Pedidos, métricas do dashboard, rankings e exportações recebem `from`/`to` como
dias inclusivos (`AAAA-MM-DD`, fuso `America/Sao_Paulo`) e `dateField`:
`DeliveryDate` é o padrão; `CreatedAt` seleciona a criação quando solicitada.
Os filtros opcionais `clientId`, `status` e `isPaid` podem ser combinados.
`orders.search` também aceita `productId` para pedidos que contêm um item ativo
do produto. `products.stats` aceita `month` e `dateField`.

Receita segue `totalRevenue`, após descontos e sem pedidos cancelados; omitir
`isPaid` inclui pedidos pagos e não pagos. Caixa mantém a data de competência
dos lançamentos. As regras de escrita e os cálculos continuam no backend.

O prompt do bot está em [HERMES_SOUL.md](./HERMES_SOUL.md). No Hermes, use o
provedor nativo `gemini`, modelo `gemini-3.5-flash-lite`, raciocínio `low` e
endpoint `https://generativelanguage.googleapis.com/v1beta`. A chave pertence ao
`.env` do Hermes (`GOOGLE_API_KEY`), não ao código ou ao prompt.

Publique primeiro o backend com suporte a `from/to/dateField`, depois reconstrua
e reinicie MCP e Hermes. Os antigos campos de tools `createdAtFrom/To` e
`deliveryFrom/To` são rejeitados para evitar consultas sem o filtro pretendido.
O backend preserva os parâmetros `deliveryDateFrom/To` usados pelo SaaS.

53 capabilities em 7 domínios. O mapeamento completo com os endpoints de origem está em [`MCP_CAPABILITY_MAP.md`](./MCP_CAPABILITY_MAP.md).

| Domínio | Capabilities |
|---|---|
| Clientes | `search`, `list-options`, `get`, `stats`, `list-orders`, `create`, `update`, `set-status`, `delete` |
| CRM | `list` |
| Pedidos | `search`, `get`, `create`, `update`, `complete`, `cancel`, `cancel-item`, `adjust-item-quantity`, `mark-paid`, `reverse-payment`, `remove-reference` |
| Produtos | `search`, `list-options`, `get`, `stats`, `create`, `update`, `set-status`, `delete`, `get-recipe`, `set-recipe`, `list-recipe-options`, `set-recipe-option`, `list-order-options` |
| Estoque | `search`, `list-options`, `get`, `create`, `update`, `restock`, `set-status` |
| Caixa | `search`, `get`, `summary`, `create`, `update`, `delete`, `audit` |
| Dashboard | `summary`, `revenue-over-time`, `top-products`, `top-clients`, `export-orders` |

Um cliente MCP vê cada uma como uma tool (`orders.create` → `orders_create`). Não existe tool genérica de HTTP ou de banco: o agente só alcança o backend pelas operações declaradas aqui.

Tarefas compostas são composição de primitivas. "Cria um pedido igual ao último da cliente X" é `clients.search` → `clients.list-orders` → `orders.get` → `orders.create`.

## Arquitetura

```text
Capability (src/capabilities/)      contrato de domínio, schemas de entrada e saída
     ↓
BackendGateway (src/application/)   port
     ↓
connector (src/infrastructure/)     BACKEND_URL, login, headers, timeout, retry, erros
     ↓
DeuxOrders Backend
```

O connector é o único lugar que conhece o `BACKEND_URL` e a credencial. Retries acontecem só em `GET`, e só para falha de rede, 429 ou 5xx — escritas nunca são repetidas.

Erros do backend chegam ao agente traduzidos: uma violação de regra de negócio vira `INPUT_INVALID` com a mensagem original, que o agente consegue corrigir; um 5xx vira uma mensagem genérica que não vaza nada.

## Auditoria

Toda invocação emite em stderr, como JSON de uma linha: timestamp, `requestId`, capability, canal (`mcp-http`, `mcp-stdio`, `cli`, `direct`), identidade do chamador, duração e código de erro. Segredos nunca são registrados.

## Testes

```sh
npm test
```

Cobrem operação válida, entrada inválida, recurso inexistente, erro do backend, backend indisponível, resposta inesperada, retry, exportação grande demais, não vazamento de credencial e a ausência de tool genérica. O MCP é testável sem Hermes nem Claude.

`npm test` roda contra dublês. `npm run smoke` roda contra o backend de produção e é o que valida os contratos de saída contra respostas reais — rode antes de cada lançamento.
