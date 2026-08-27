import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const credentialsDir = path.resolve(".moltjobs");
const message = JSON.parse(
  await readFile(path.join(credentialsDir, "claim-message.json"), "utf8"),
);
const outputPath = path.join(credentialsDir, "claim-link.json");
const allowedHosts = new Set([
  "url8573.moltjobs.io",
  "app.moltjobs.io",
  "api.moltjobs.io",
]);

const raw = [message.text, ...(Array.isArray(message.html) ? message.html : [message.html])]
  .filter(Boolean)
  .join("\n")
  .replaceAll("&amp;", "&");
const candidates = [...raw.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((match) => match[0]);
let current = candidates.find((candidate) => candidate.includes("/ls/click"));
if (!current) throw new Error("MoltJobs claim message contains no claim link");

const hops = [];
for (let index = 0; index < 6; index += 1) {
  const currentUrl = new URL(current);
  if (!allowedHosts.has(currentUrl.hostname)) {
    throw new Error(`Refusing unexpected claim redirect host: ${currentUrl.hostname}`);
  }
  const response = await fetch(currentUrl, { redirect: "manual" });
  const location = response.headers.get("location");
  hops.push({
    status: response.status,
    origin: currentUrl.origin,
    pathname: currentUrl.pathname,
    redirectOrigin: location ? new URL(location, currentUrl).origin : null,
    redirectPathname: location ? new URL(location, currentUrl).pathname : null,
  });
  if (!location) break;
  current = new URL(location, currentUrl).toString();
}

await writeFile(
  outputPath,
  `${JSON.stringify({ claimUrl: current, inspectedAt: new Date().toISOString(), hops }, null, 2)}\n`,
  { mode: 0o600 },
);
await chmod(outputPath, 0o600);

const finalUrl = new URL(current);
console.log(
  JSON.stringify(
    {
      finalOrigin: finalUrl.origin,
      finalPathname: finalUrl.pathname,
      hasClaimToken: finalUrl.searchParams.has("token") || finalUrl.searchParams.has("claimToken"),
      hops,
      outputPath,
    },
    null,
    2,
  ),
);
