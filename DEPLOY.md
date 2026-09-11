# Hermes com Gemini no Windows

O backend publica pelo workflow `DeuxERP CI`: push em `main`, testes de unidade
e integração com PostgreSQL e, se aprovados, deploy no Fly.io. Não é necessário
autenticar o Fly.io neste Windows.

O Hermes usa `%LOCALAPPDATA%\hermes\config.yaml`:

```yaml
model:
  default: gemini-3.5-flash-lite
  provider: gemini
  base_url: https://generativelanguage.googleapis.com/v1beta
agent:
  reasoning_effort: low
  max_turns: 40
auxiliary:
  compression:
    provider: gemini
    model: gemini-3.5-flash-lite
    reasoning_effort: low
platform_toolsets:
  whatsapp:
    - mcp-deuxorders
    - code_execution
    - file
    - terminal
```

Mescle esses campos na configuração existente, preservando MCP, WhatsApp e a
lista de administradores autorizados. Em `%LOCALAPPDATA%\hermes\.env`, configure
`GOOGLE_API_KEY` em uma linha ativa, sem `#`. A chave não pertence ao repositório.
Copie `HERMES_SOUL.md` para `%LOCALAPPDATA%\hermes\SOUL.md`.

O MCP lê seu próprio `.env` para autenticar no backend e atender o Hermes em
`http://127.0.0.1:3100/mcp`. O gateway mantém a configuração de bearer token
existente. O Ollama não é necessário para o Gemini.

Depois que o backend com os filtros atualizados estiver publicado:

```powershell
npm run typecheck
npm test
npm run build
npm run smoke
Start-ScheduledTask -TaskName 'DeuxOrders MCP'
Start-ScheduledTask -TaskName 'DeuxOrders Hermes Gateway'
```

As tarefas existentes executam `deploy/start-mcp.ps1` e
`deploy/start-gateway.ps1`, com logs no diretório `logs` de cada serviço. Para
instalação nova, execute `deploy/install-task.ps1 -Service all`; ele instala
somente MCP e Hermes. A opção `-Service ollama` permanece disponível para uso
local explícito. O WhatsApp deve estar pareado antes de iniciar o gateway.

O watchdog encerra a árvore do gateway se o WhatsApp invalidar a sessão; nesse
caso é necessário parear novamente. Ele não encerra outros processos Node.

Valide consultas de faturamento por entrega e por criação, comparando os
mesmos filtros do SaaS. Não crie pedidos reais apenas para testar a migração.
