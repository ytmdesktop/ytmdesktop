export function getYTMTextRun(runs: { text: string }[]) {
  let final = "";
  for (const run of runs) {
    final += run.text;
  }
  return final;
}
