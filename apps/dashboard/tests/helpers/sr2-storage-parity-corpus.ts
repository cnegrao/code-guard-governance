/** Frozen read/storage parity examples, not SAFE writer admissions. Never normalize these values. */
export const storageTextCorpus: readonly { name: string; value: string; a2: boolean; a3: boolean }[] = [
  { name: 'empty', value: '', a2: false, a3: false },
  ...[9, 10, 11, 12, 13, 32].map(cp => ({ name: `ASCII whitespace U+${cp.toString(16)}`, value: String.fromCodePoint(cp), a2: false, a3: false })),
  { name: 'all ASCII whitespace', value: '\t\n\v\f\r ', a2: false, a3: false },
  ...[0xa0, 0x1680, ...Array.from({ length: 11 }, (_, i) => 0x2000 + i), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]
    .map(cp => ({ name: `Unicode whitespace/format U+${cp.toString(16)}`, value: String.fromCodePoint(cp), a2: true, a3: true })),
  // Include every C0/C1 value both alone and embedded: a nonblank test alone does not exclude controls.
  ...[...Array.from({ length: 32 }, (_, i) => i), ...Array.from({ length: 33 }, (_, i) => 0x7f + i)]
    .flatMap(cp => [false, true].map(embedded => ({ name: `control U+${cp.toString(16)}${embedded ? ' embedded' : ''}`,
      value: embedded ? `a${String.fromCodePoint(cp)}b` : String.fromCodePoint(cp),
      a2: cp !== 0 && (embedded || ![9, 10, 11, 12, 13].includes(cp)), a3: false }))),
  ...['ASCII', 'ação', '😀', '\u00a0 label \u3000', 'key:value', 'é', 'e\u0301', '\u00a0latest\u00a0', '\ufeffunknown\ufeff', 'UN\u212aNOWN']
    .map(value => ({ name: `exact UTF-8 ${JSON.stringify(value)}`, value, a2: true, a3: true })),
  ...[512, 513].map(size => ({ name: `${size} ASCII bytes`, value: 'x'.repeat(size), a2: size === 512, a3: size === 512 })),
  ...[256, 257].map(size => ({ name: `${size * 2} multibyte bytes`, value: 'é'.repeat(size), a2: size === 256, a3: size === 256 })),
];

/** Reserved identity tokens are checked against actual SQL, not a JS expectation table. */
export const reservedTokenCorpus = [
  'latest', 'default', 'unknown', 'LATEST', 'DeFaUlT', 'UNKNOWN',
  ' latest ', '  DEFAULT  ', ' unknown', 'latest ',
  '\u00a0latest\u00a0', '\ufeffunknown\ufeff', '\u3000default\u3000', '\u1680latest\u1680',
  'UN\u212aNOWN', 'latest\n', '\tdefault', 'UNKNOWN\t',
  '', ' ', '\t\n', 'latest:v1', 'v1', 'é', 'x'.repeat(512), 'x'.repeat(513),
] as const;

export const canonicalUuidCorpus = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', // v4
  '0192c510-7f40-7abc-8def-0123456789ab', // v7
  '0192c510-7f40-8abc-8def-0123456789ab', // v8
  '00000000-0000-0000-0000-000000000000', // nil
  'ffffffff-ffff-ffff-ffff-ffffffffffff', // unrestricted version and variant
] as const;
export const noncanonicalUuidCorpus = [
  '0192C510-7F40-7ABC-8DEF-0123456789AB', '0192c5107f407abc8def0123456789ab',
  '{0192c510-7f40-7abc-8def-0123456789ab}', '0192c510-7f40-7abc-8def-0123456789ag',
  '0192c510-7f40-7abc-8def-0123456789ab\n', '', 'not-a-uuid',
] as const;
