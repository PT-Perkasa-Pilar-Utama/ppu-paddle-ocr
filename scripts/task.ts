const task = process.argv[2];
if (task == null) throw new Error("A task must be specified!");

await Bun.$`bun ${{
  raw: import.meta.dir + "/" + task + ".ts",
}} ${process.argv.slice(3)}`;
