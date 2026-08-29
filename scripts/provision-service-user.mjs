#!/usr/bin/env node
/**
 * Cria o usuário de serviço do MCP no DeuxOrders.
 *
 * O backend em PROD só deixa um Administrator autenticado registrar usuários,
 * então este script pede as credenciais de uma sócia, faz login, registra a
 * conta do MCP com a senha que já está no .env e informa o passo final.
 *
 * As credenciais da sócia são lidas do ambiente, usadas uma vez e nunca
 * gravadas, ecoadas ou registradas.
 *
 *   ADMIN_EMAIL=socia@deuxcerie.com.br ADMIN_PASSWORD='...' npm run provision
 */
import "../dist/env.js";

const backendUrl = (process.env.BACKEND_URL ?? "")
  .replace(/\/+$/, "")
  .replace(/\/api\/v1$/, "");
const serviceEmail = process.env.BACKEND_SERVICE_EMAIL ?? "";
const servicePassword = process.env.BACKEND_SERVICE_PASSWORD ?? "";
const adminEmail = process.env.ADMIN_EMAIL ?? "";
const adminPassword = process.env.ADMIN_PASSWORD ?? "";

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const missing = [
  ["BACKEND_URL", backendUrl],
  ["BACKEND_SERVICE_EMAIL", serviceEmail],
  ["BACKEND_SERVICE_PASSWORD", servicePassword],
  ["ADMIN_EMAIL", adminEmail],
  ["ADMIN_PASSWORD", adminPassword],
].filter(([, value]) => value === "");

if (missing.length > 0) {
  die(
    `Faltam variáveis: ${missing.map(([name]) => name).join(", ")}.\n` +
      `Uso: ADMIN_EMAIL=... ADMIN_PASSWORD='...' npm run provision`,
  );
}

process.stdout.write(`Backend: ${backendUrl}\n`);

const loginResponse = await fetch(`${backendUrl}/api/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: adminEmail, password: adminPassword }),
}).catch(() => null);

if (loginResponse === null) die("Não foi possível alcançar o backend.");
if (loginResponse.status === 401) die("Credenciais da administradora recusadas.");
if (loginResponse.status === 429) die("Limite de tentativas atingido. Aguarde um minuto.");
if (!loginResponse.ok) die(`Login falhou com status ${loginResponse.status}.`);

const { token } = await loginResponse.json();
if (typeof token !== "string" || token === "") die("O backend não devolveu um token.");
process.stdout.write("Login da administradora: ok\n");

const registerResponse = await fetch(`${backendUrl}/api/v1/auth/register`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({
    name: "MCP",
    username: "mcp",
    email: serviceEmail,
    password: servicePassword,
  }),
});

if (registerResponse.status === 409) {
  process.stdout.write(
    `\nO usuário ${serviceEmail} já existe.\n` +
      `Se a senha do .env não for a dele, troque uma das duas para que batam.\n`,
  );
} else if (registerResponse.status === 403) {
  die("A conta usada não é Administrator, então não pode registrar usuários.");
} else if (!registerResponse.ok) {
  const detail = await registerResponse.text().catch(() => "");
  die(`Registro falhou com status ${registerResponse.status}. ${detail.slice(0, 300)}`);
} else {
  process.stdout.write(`Usuário ${serviceEmail} criado.\n`);
}

process.stdout.write(
  `\nFalta promover a conta a Administrator. Não existe endpoint para trocar papel,\n` +
    `então isso precisa ser feito direto no banco:\n\n` +
    `  UPDATE users SET "Role" = 1 WHERE "Email" = '${serviceEmail}';\n\n` +
    `  -- Role: 1 = Administrator, 2 = User. Confira antes com:\n` +
    `  -- SELECT "Email", "Role" FROM users WHERE "Email" = '${serviceEmail}';\n\n` +
    `Sem isso, orders.mark-paid, orders.reverse-payment, as escritas de cash.* e as\n` +
    `exclusões de cliente e produto respondem 403.\n\n` +
    `Depois: npm run smoke\n`,
);
