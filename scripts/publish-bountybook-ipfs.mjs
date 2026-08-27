import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [jobId, sourcePath] = process.argv.slice(2);
if (!jobId || !sourcePath) {
  throw new Error(
    "Usage: node scripts/publish-bountybook-ipfs.mjs <job-id> <source-file>",
  );
}

const resolvedSource = path.resolve(sourcePath);
const fileName = path.basename(resolvedSource);
const source = await readFile(resolvedSource, "utf8");
if (source.trim().split("\n").length < 10) {
  throw new Error("Refusing to publish a code deliverable shorter than 10 lines");
}

const response = await fetch(
  `https://api.bountybook.ai/jobs/${encodeURIComponent(jobId)}`,
  { signal: AbortSignal.timeout(30_000) },
);
if (!response.ok) throw new Error(`BountyBook returned HTTP ${response.status}`);
const job = await response.json();
const requiredFiles = job.spec?.success_condition?.required_files ?? [];
if (requiredFiles.length > 0 && !requiredFiles.includes(fileName)) {
  throw new Error(`Deliverable name must be one of: ${requiredFiles.join(", ")}`);
}

const artifact = {
  schemaVersion: 1,
  jobId,
  title: job.title,
  fileName,
  content: source,
  code: source,
  files: { [fileName]: source },
  file_contents: { [fileName]: source },
  artifacts: [{ name: fileName, path: fileName, content: source }],
  results: [{ fileName, content: source }],
  summary: `Complete implementation of ${fileName} for the requested specification.`,
};
const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
const artifactDir = path.resolve(".bountybook/artifacts");
const artifactPath = path.join(artifactDir, `${jobId}.json`);
await mkdir(artifactDir, { recursive: true, mode: 0o700 });
await writeFile(artifactPath, serialized, { mode: 0o600 });
await chmod(artifactPath, 0o600);

const ipfsPath = path.resolve(".bountybook/bin/ipfs");
const cid = execFileSync(
  ipfsPath,
  ["add", "-Q", "--cid-version=1", "--pin=true", artifactPath],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      IPFS_PATH: path.resolve(".bountybook/ipfs-repo"),
    },
  },
).trim();
if (!/^baf[a-z2-7]{20,}$/i.test(cid)) {
  throw new Error("Kubo returned an invalid CID");
}

const gatewayResponse = await fetch(`https://ipfs.io/ipfs/${cid}`, {
  signal: AbortSignal.timeout(45_000),
});
if (!gatewayResponse.ok) {
  throw new Error(`Public IPFS gateway returned HTTP ${gatewayResponse.status}`);
}
const gatewayBytes = Buffer.from(await gatewayResponse.arrayBuffer());
const expectedHash = createHash("sha256").update(serialized).digest("hex");
const publicHash = createHash("sha256").update(gatewayBytes).digest("hex");
if (publicHash !== expectedHash) {
  throw new Error("Public IPFS content hash does not match the local artifact");
}

console.log(
  JSON.stringify(
    {
      publishedAt: new Date().toISOString(),
      jobId,
      fileName,
      cid,
      sha256: expectedHash,
      publicGatewayVerified: true,
      sourceLines: source.trim().split("\n").length,
    },
    null,
    2,
  ),
);
