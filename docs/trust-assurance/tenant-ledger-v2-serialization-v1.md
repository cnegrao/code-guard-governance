# Tenant ledger V2 — serialization version 1

Frozen by M17.5-V1-S1A1-1, implementing the accepted tenant-ledger ADR §5.
Algorithm version **2** means SHA-256 with these V2 domains; serialization
version **1** identifies the following bytes. No activation is authorized here.

Each value is `tag:u8 || payload_length:u64be || payload`. The length counts
bytes, excludes the nine-byte header, and is never a character count. Values
accepted by PostgreSQL fit within its bytea limit, hence within unsigned u64.
Concatenation below joins already framed values; it adds no delimiter.

| Tag (hex) | Value | Payload |
|---|---|---|
| 00 | SQL null or JSON null | zero bytes, always length zero |
| 01 | text / JSON string / object key / domain | UTF-8, without Unicode normalization |
| 02 | UUID | 16 bytes, in UUID network order |
| 03 | integer / container count / version | ASCII signed decimal, no plus or leading zeros |
| 04 | timestamp | ASCII signed integer UTC microseconds since Unix epoch |
| 05 | predecessor hash | exactly 32 raw bytes |
| 06 | JSON number | exact canonical ASCII decimal |
| 07 | JSON false | zero bytes |
| 08 | JSON true | zero bytes |
| 09 | JSON object | framed count (03), followed by framed key/value pairs |
| 0a | JSON array | framed count (03), followed by framed values in array order |
| 0b | IP | family byte 04/06, 4/16 address bytes, one prefix-length byte |

IPv4 and IPv6 retain the actual address bits, including host bits when a prefix
is supplied. They are neither printed strings nor IPv4-mapped conversions.
Equivalent IPv6 spellings produce identical bytes. Timestamps are finite,
within signed 64-bit Unix microseconds, and retain all six fractional digits
as integer arithmetic. Timezone rendering and DateStyle do not affect them.

JSON object keys sort lexicographically by **unsigned UTF-8 bytes** (bytea
comparison), independently of database collation. Counts precede recursively
framed members. PostgreSQL jsonb input semantics apply before serialization:
duplicate input keys have already resolved to the last value; original JSON
whitespace and exponent spellings are not retained. JSON strings must be
representable by PostgreSQL UTF-8 text; NUL and invalid surrogate input reject.
SQL null and JSON null share tag 00, but non-null entry payload is mandatory.

Decimal canonicalization is exact: finite numeric arithmetic, no binary float,
no exponent, no insignificant fractional zeros, zero for negative zero. For
example `1.2300e2` → `123`, `-0.000` → `0`, `0.00120` → `0.0012`.
Implementation extracts digits by exact quotient/remainder arithmetic, without
numeric textual formatting. JSON numeric extraction is parsed back to numeric;
its intermediate scalar spelling is never the preimage. Integer text uses the
same arithmetic. UUID/IP wire primitives supply fixed binary bytes only.

The numbered **genesis** field order is:

1. text domain `GOVIA_LEDGER_TENANT_GENESIS_V2`
2. integer algorithm version (2)
3. integer serialization version (1)
4. UUID organisation
5. UUID chain
6. UUID activation
7. timestamp activated_at

The numbered **entry** field order is:

1. text domain `GOVIA_LEDGER_TENANT_V2`
2. integer algorithm version (2)
3. integer serialization version (1)
4. UUID organisation
5. UUID chain
6. UUID activation
7. integer tenant sequence (positive bigint)
8. UUID tenant entry
9. raw predecessor hash
10. UUID source entry
11. text event type
12. text event description
13. text subject type
14. UUID subject
15. nullable UUID actor
16. nullable IP actor address
17. nullable UUID actor session
18. timestamp event_timestamp
19. timestamp recorded_at
20. JSON payload

All fields except actor/address/session are mandatory in the entry helper.
The legacy source currently requires actor; nullable actor framing is frozen
for the ADR's nullable actor contract and tested independently. No source global
sequence, hash, predecessor or QES anchor enters either preimage. SHA-256 is
applied to the complete preimage; hashes are stored as bytea of length 32.

Unknown tags/versions, nonfinite numbers/times, invalid identities, nonpositive
order and malformed hash lengths raise errors. No helper writes data. Database
input errors and constraint failures roll back the enclosing statement or
transaction. Exact supported scalar/container cases are pinned as serialized
hex **and** SHA-256 in the test fixture. The independent Python generator uses
arbitrary-precision integers and Decimal, never JavaScript floating point, and
is not run by tests to regenerate expectations.

Version 1 must never be changed in place once activated. A new encoding requires
a new serialization version and separately authorized epoch/version contract.
