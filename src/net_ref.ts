// The reference forward pass: slow, obvious, in double precision throughout, and sharing no code with
// net.ts, which it judges. It reads the genome layout as net.ts's header documents it: per layer, the
// weights as rows [out][in], then the biases [out]. It imports nothing; the `net-ref` gate checks that.

export function referenceForward(sizes: readonly number[], genome: ArrayLike<number>, input: ArrayLike<number>): number[] {
  let x: number[] = [];
  for (let i = 0; i < input.length; i++) x.push(Number(input[i]));
  if (x.length !== sizes[0]) throw new Error(`REFERENCE-INPUT: expected ${sizes[0]} inputs, got ${x.length}`);
  let p = 0;
  for (let l = 0; l + 1 < sizes.length; l++) {
    const rows: number[][] = [];
    for (let j = 0; j < sizes[l + 1]; j++) {
      const row: number[] = [];
      for (let i = 0; i < sizes[l]; i++) row.push(Number(genome[p++]));
      rows.push(row);
    }
    const biases: number[] = [];
    for (let j = 0; j < sizes[l + 1]; j++) biases.push(Number(genome[p++]));
    const prev = x;
    x = rows.map((row, j) => {
      let sum = 0;
      for (let i = 0; i < row.length; i++) sum += row[i] * prev[i];
      return Math.tanh(sum + biases[j]);
    });
  }
  if (p !== genome.length) throw new Error(`REFERENCE-LENGTH: layout used ${p} numbers, genome has ${genome.length}`);
  return x;
}
