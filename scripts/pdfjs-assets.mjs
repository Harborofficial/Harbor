import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve("node_modules/pdfjs-dist");
const out = resolve("public/pdfjs");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(resolve(root, "cmaps"), resolve(out, "cmaps"), { recursive: true });
await cp(resolve(root, "standard_fonts"), resolve(out, "standard_fonts"), { recursive: true });
await mkdir(dirname(resolve(out, "pdf.worker.min.mjs")), { recursive: true });
await cp(resolve(root, "legacy/build/pdf.worker.min.mjs"), resolve(out, "pdf.worker.min.mjs"));
