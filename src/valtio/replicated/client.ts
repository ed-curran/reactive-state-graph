export interface Client {
  seed: Uint8Array;
  latestOffset: number;
}

function randomSeed(): Uint8Array {
  const seed = new Uint8Array(6);
  crypto.getRandomValues(seed);
  return seed;
}

export function makeClient(): Client {
  return {
    seed: randomSeed(),
    latestOffset: 0,
  };
}
