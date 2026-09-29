import { spawn } from "node:child_process";

export async function extractPdfText(req, binary = "pdftotext") {
  if (req.headers["content-type"] !== "application/pdf") throw Object.assign(new Error("Sube un PDF válido"), { status: 415 });
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw Object.assign(new Error("PDF demasiado grande (máximo 2 MB)"), { status: 413 });
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks);
  if (input.subarray(0, 5).toString() !== "%PDF-") throw Object.assign(new Error("El archivo no es un PDF"), { status: 400 });
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["-layout", "-", "-"], { stdio: ["pipe", "pipe", "ignore"], env: { PATH: process.env.PATH || "/usr/bin:/bin" } });
    const output = []; let outSize = 0; let settled = false;
    const fail = (message) => { if (!settled) { settled = true; reject(Object.assign(new Error(message), { status: 422 })); } };
    const timer = setTimeout(() => { child.kill(); fail("No se pudo leer el PDF en el tiempo permitido") }, 8000);
    child.stdout.on("data", (part) => { outSize += part.length; if (outSize > 40000) { child.kill(); fail("CV demasiado extenso") } else output.push(part); });
    child.on("error", () => fail("El lector PDF no está instalado. Pega el texto de tu CV o importa TXT/MD."));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      const text = Buffer.concat(output).toString("utf8").replace(/\s+/g, " ").trim().slice(0, 20000);
      if (code !== 0 || text.length < 40) fail("No se pudo extraer texto; si el PDF es una imagen, pega el contenido de tu CV.");
      else { settled = true; resolve(text); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
