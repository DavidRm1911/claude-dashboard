import fs from "node:fs";
import path from "node:path";

export function validateRequest(req, port) {
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  if (!hosts.has(req.headers.host)) return 403;
  const origin = req.headers.origin;
  if (origin && ![...hosts].some((host) => origin === `http://${host}`)) return 403;
  if (req.headers["sec-fetch-site"] === "cross-site") return 403;
  if (!["GET", "HEAD", "POST"].includes(req.method)) return 405;
  // Local actions must originate in this UI, not cross-site forms or links.
  if (req.method === "POST" && req.headers["x-dashboard-request"] !== "1") return 403;
  return null;
}

export function resolveProject(root, name) {
  if (!root || typeof name !== "string" || !name || name === "." || name === ".." || /[/\\\x00-\x1f]/.test(name) || name.startsWith("-")) {
    throw Object.assign(new Error("Nombre de proyecto inválido"), { status: 400 });
  }
  try {
    const realRoot = fs.realpathSync(root);
    const candidate = fs.realpathSync(path.join(realRoot, name));
    if (path.dirname(candidate) !== realRoot || !fs.statSync(candidate).isDirectory()) throw new Error("outside root");
    return candidate;
  } catch {
    throw Object.assign(new Error("Proyecto inexistente o fuera de la carpeta configurada"), { status: 400 });
  }
}

export async function readJson(req, maxBytes = 65536) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("Solicitud demasiado grande"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw Object.assign(new Error("JSON inválido"), { status: 400 });
  }
}
