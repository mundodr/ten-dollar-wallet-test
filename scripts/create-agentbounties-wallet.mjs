import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const privateDir = path.resolve(".agentbounties");
const walletPath = path.join(privateDir, "wallet.json");
const ethersPath = path.resolve(
  privateDir,
  "node_modules/ethers/lib.esm/index.js",
);

await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);

let saved;
try {
  saved = JSON.parse(await readFile(walletPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

if (!saved) {
  const { Wallet } = await import(pathToFileURL(ethersPath));
  const wallet = Wallet.createRandom();
  saved = {
    schemaVersion: "ten-dollar-agentbounties-wallet-v1",
    network: "base-mainnet",
    address: wallet.address,
    privateKey: wallet.privateKey,
    createdAt: new Date().toISOString(),
  };
  await writeFile(walletPath, `${JSON.stringify(saved, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

await chmod(walletPath, 0o600);
console.log(
  JSON.stringify(
    {
      address: saved.address,
      network: saved.network,
      privateFile: path.relative(process.cwd(), walletPath),
    },
    null,
    2,
  ),
);
