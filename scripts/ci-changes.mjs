// Reads the changed file names (one a line) on stdin and prints what CI needs to know, as `name=value` lines for $GITHUB_OUTPUT. Plain Node with no
// dependencies: the job that runs it has installed nothing. Anything it cannot be sure of means "run everything".
//   docs_only  every changed file is a Markdown file or under docs/ (the tests that read the docs still run: see ci.yml)
//   docker     the image can have changed: the Dockerfile, .dockerignore, package files, next.config.ts, or CI itself
//   deps       package.json or package-lock.json changed (the dependency audit is worth running)
export function classify(files) {
  const list = files.map((f) => f.trim()).filter(Boolean);
  const known = list.length > 0 && !list.includes("(unknown)");
  const docsOnly = known && list.every((f) => /\.md$/i.test(f) || f.startsWith("docs/")) && !list.some((f) => f.startsWith(".github/"));
  const docker = !known || list.some((f) => ["Dockerfile", ".dockerignore", "package.json", "package-lock.json", "next.config.ts"].includes(f) || f.startsWith(".github/"));
  const deps = !known || list.some((f) => f === "package.json" || f === "package-lock.json");
  return { docs_only: docsOnly, docker, deps, count: list.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (input += d));
  process.stdin.on("end", () => { for (const [k, v] of Object.entries(classify(input.split("\n")))) console.log(`${k}=${v}`); });
}
