import { minify } from "uglify-js";

const DIR = `${import.meta.dir}/../lib/`;

const sizes: {
  entry: string;
  size: number;
  minified: number;
  gzip: number;
  minifiedGzip: number;
}[] = [];

const toByte = (num: number) => (num >= 1e3 ? `${(num / 1e3).toFixed(2)}KB` : `${num}B`);

for await (const path of new Bun.Glob("**/*.js").scan(DIR)) {
  const file = Bun.file(DIR + path);

  const stat = await file.stat();
  if (!stat.isFile()) continue;

  const code = await file.text();
  const minfiedCode = minify(code).code;

  sizes.push({
    entry: path,
    size: file.size,
    minified: Buffer.from(minfiedCode).byteLength,
    gzip: Bun.gzipSync(code).byteLength,
    minifiedGzip: Bun.gzipSync(minfiedCode).byteLength,
  });
}

sizes.sort((a, b) => a.size - b.size);

// Convert to table columns
console.table(
  sizes.map((val) => ({
    Entry: val.entry,
    Size: toByte(val.size),
    Minify: toByte(val.minified),
    GZIP: toByte(val.gzip),
    "Minify GZIP": toByte(val.minifiedGzip),
  }))
);
